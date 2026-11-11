import { PGlite } from "@electric-sql/pglite";
import { createHash,randomUUID } from "node:crypto";
import { beforeAll,beforeEach,afterAll,expect,it,vi } from "vitest";
import { migrate,type Db } from "../src/db";
import { EntitlementService,PRODUCTS,googleAccountId } from "../src/entitlements";
import { AppleVerifier,Environment } from "../src/billing/apple";
import type { GoogleSubscription,GoogleRTDN } from "../src/billing/google";
import { testCertificates } from "./store-certificates";
import { readEnv } from "../src/env";
let lite:PGlite,db:Db,a:string,b:string,service:EntitlementService,apple:AppleVerifier,certs:ReturnType<typeof testCertificates>;
let google:GoogleSubscription;const token="fixture-play-purchase-"+randomUUID();
const getSubscription=vi.fn(async()=>structuredClone(google));const push=vi.fn(async(auth:string)=>{if(auth!=="fixture-authorized-push")throw new Error("Unauthorized push");});
const fingerprint=createHash("sha256").update("synthetic wish fixture").digest("hex");
let instant:number;
beforeAll(async()=>{
  certs=testCertificates();apple=new AppleVerifier({bundleId:"com.knightaiav.dandelist",environment:Environment.SANDBOX},[certs.root]);
  lite=new PGlite();db={query:(s,p)=>lite.query(s,p) as never,exec:s=>lite.exec(s)};await migrate(db);
  a=(await db.query<{id:string}>("insert into users(email)values('entitlement-a@example.invalid')returning id")).rows[0]!.id;
  b=(await db.query<{id:string}>("insert into users(email)values('entitlement-b@example.invalid')returning id")).rows[0]!.id;
});
beforeEach(async()=>{
  await db.exec("truncate entitlements,entitlement_purchases,entitlement_events,entitlement_hunts");instant=Date.now();getSubscription.mockClear();push.mockClear();
  google={subscriptionState:"SUBSCRIPTION_STATE_ACTIVE",latestOrderId:"GPA.FIXTURE.1234..0",externalAccountIdentifiers:{obfuscatedExternalAccountId:googleAccountId(a)},lineItems:[{productId:PRODUCTS.monthly,expiryTime:new Date(instant+30*86400000).toISOString(),autoRenewingPlan:{autoRenewEnabled:true}}]};
  service=new EntitlementService(db,{enabled:true,apple,google:{getSubscription},googlePush:{verify:push},packageName:"com.knightaiav.dandelist"});
});
afterAll(async()=>{await lite.close();});
const transaction=(patch:Record<string,unknown>={})=>({transactionId:"10000000001",originalTransactionId:"10000000000",webOrderLineItemId:"10000000002",bundleId:"com.knightaiav.dandelist",productId:PRODUCTS.monthly,subscriptionGroupIdentifier:"fixture-premium",purchaseDate:instant-1000,originalPurchaseDate:instant-1000,expiresDate:instant+14*86400000,quantity:1,type:"Auto-Renewable Subscription",inAppOwnershipType:"PURCHASED",signedDate:instant,environment:"Sandbox",appAccountToken:a,offerType:1,offerDiscountType:"FREE_TRIAL",...patch});
const notification=(type:string,patch:Record<string,unknown>={},txPatch:Record<string,unknown>={},renewal?:Record<string,unknown>)=>certs.jws({notificationType:type,notificationUUID:randomUUID(),version:"2.0",signedDate:instant+1000,data:{bundleId:"com.knightaiav.dandelist",environment:"Sandbox",signedTransactionInfo:certs.jws(transaction(txPatch)),...(renewal?{signedRenewalInfo:certs.jws({originalTransactionId:"10000000000",productId:PRODUCTS.monthly,autoRenewProductId:PRODUCTS.monthly,autoRenewStatus:1,signedDate:instant,environment:"Sandbox",...renewal})}:{})},...patch});
const rtdn=(offset=1000):GoogleRTDN=>({packageName:"com.knightaiav.dandelist",eventTimeMillis:String(instant+offset),subscriptionNotification:{purchaseToken:token,notificationType:2}});

it("feature defaults off, touches no DB/providers, and free account operations always pass",async()=>{
  const query=vi.fn(async()=>{throw new Error("DB must not run");});const off=new EntitlementService({query,exec:async()=>{}});
  expect(await off.admitHunt(a,"fixture_1",fingerprint)).toBe("disabled");
  await expect(off.startTrial(a,"web")).rejects.toThrow("disabled");await expect(off.processAppleNotification("fixture")).rejects.toThrow("disabled");
  for(const action of ["signin","read","export","delete","privacy","cancel","premium-update"]as const)expect(await off.authorize(a,action)).toBe(true);
  expect(query).not.toHaveBeenCalled();expect(readEnv({DATABASE_URL:"pglite:",JWT_SECRET:"fixture-secret-over-32-characters-long",CODE_PEPPER:"fixture-pepper-over-16"}).ENTITLEMENTS_ENABLED).toBe(false);
});
it("uses the database clock for one fixed 14-day web/Android trial, with no reset",async()=>{
  const first=await (service.startTrial as any)(a,"web",{clientNow:"2040-01-01"});
  const last=await service.startTrial(a,"android");
  expect(new Date(first.trial_ends_at).getTime()-new Date(first.trial_started_at).getTime()).toBe(14*86400000);
  expect(new Date(last.trial_ends_at!).getTime()).toBe(new Date(first.trial_ends_at).getTime());expect(last.platform).toBe("web");
  await expect(service.startTrial(a,"ios"as never)).rejects.toThrow("Apple trial");
});
it("10 trial hunts are admitted atomically under 30 simultaneous requests",async()=>{
  await service.startTrial(a,"android");
  const results=await Promise.all(Array.from({length:30},(_,i)=>service.admitHunt(a,"trial_"+String(i).padStart(8,'0'),fingerprint)));
  expect(results.filter(x=>x==="admitted")).toHaveLength(10);expect(results.filter(x=>x==="quota")).toHaveLength(20);
  expect(await service.admitHunt(a,"trial_00000000",fingerprint)).toBe("duplicate");
  await expect(service.admitHunt(a,"trial_00000000","a".repeat(64))).rejects.toThrow("Conflicting");
});
it("expiry blocks premium work without gating saved data, sign-in, privacy or deletion",async()=>{
  await service.startTrial(a,"web");await db.exec("update entitlements set trial_ends_at=clock_timestamp()-interval '1 second'");
  expect((await service.read(a)).state).toBe("expired");expect(await service.admitHunt(a,"expired_1",fingerprint)).toBe("expired");expect(await service.authorize(a,"premium-update")).toBe(false);
  for(const action of ["signin","read","export","delete","privacy","cancel"]as const)expect(await service.authorize(a,action)).toBe(true);
  expect((await service.startTrial(a,"android")).state).toBe("expired");
});
it("valid generated certificate chain and Apple transaction grant a linked introductory trial",async()=>{
  expect(await service.linkAppleTransaction(a,certs.jws(transaction()))).toBe(true);const e=await service.read(a);
  expect(e.state).toBe("trialing");expect(e.platform).toBe("ios");expect(e.original_transaction_id).toBe("10000000000");
  expect(await service.linkAppleTransaction(a,certs.jws(transaction()))).toBe(false);
});
it("rejects tampered payloads, wrong root chains, expired certificate dates and invalid algorithms",async()=>{
  const good=certs.jws(transaction());const parts=good.split('.');parts[1]=Buffer.from(JSON.stringify(transaction({productId:PRODUCTS.annual}))).toString("base64url");
  await expect(apple.transaction(parts.join('.'))).rejects.toThrow();
  await expect(new AppleVerifier({bundleId:"com.knightaiav.dandelist",environment:Environment.SANDBOX}).transaction(good)).rejects.toThrow();
  await expect(apple.transaction(certs.jws(transaction({signedDate:instant-10*86400000})))).rejects.toThrow();
  await expect(apple.transaction(certs.jws(transaction(),{alg:"none"}))).rejects.toThrow("header");
  expect(()=>new AppleVerifier({bundleId:"fixture",environment:Environment.XCODE as never})).toThrow("environment");
});
it("verifies both outer notification and nested transaction, bundle/environment/product/account binding",async()=>{
  await expect(service.linkAppleTransaction(b,certs.jws(transaction()))).rejects.toThrow("binding");
  await expect(apple.transaction(certs.jws(transaction({bundleId:"wrong.fixture"})))).rejects.toThrow();
  await expect(apple.transaction(certs.jws(transaction({environment:"Production"})))).rejects.toThrow();
  await expect(service.linkAppleTransaction(a,certs.jws(transaction({productId:"unapproved.product"})))).rejects.toThrow("product");
  await service.linkAppleTransaction(a,certs.jws(transaction()));
  const badNested=notification("DID_RENEW",{data:{bundleId:"com.knightaiav.dandelist",environment:"Sandbox",signedTransactionInfo:"unsigned.fixture"}});
  await expect(service.processAppleNotification(badNested)).rejects.toThrow();
});
it("Apple V2 notification UUIDs dedupe concurrently and older renewal cannot undo a refund",async()=>{
  await service.linkAppleTransaction(a,certs.jws(transaction()));const refund=notification("REFUND",{signedDate:instant+3000});
  expect((await Promise.all([service.processAppleNotification(refund),service.processAppleNotification(refund)])).filter(Boolean)).toHaveLength(1);
  expect((await service.read(a)).state).toBe("revoked");
  await service.processAppleNotification(notification("DID_RENEW",{signedDate:instant+2000},{offerType:undefined,offerDiscountType:undefined}));expect((await service.read(a)).state).toBe("revoked");
  await service.processAppleNotification(notification("REFUND_REVERSED",{signedDate:instant+4000}));expect((await service.read(a)).state).toBe("active");
});
it("cancellation retains access to expiry; grace uses the verified renewal expiry",async()=>{
  await service.linkAppleTransaction(a,certs.jws(transaction({offerType:undefined,offerDiscountType:undefined})));
  await service.processAppleNotification(notification("DID_CHANGE_RENEWAL_STATUS",{}, {offerType:undefined,offerDiscountType:undefined},{autoRenewStatus:0}));
  expect((await service.read(a)).state).toBe("active");expect((await service.read(a)).cancel_at_period_end).toBe(true);
  await service.processAppleNotification(notification("DID_FAIL_TO_RENEW",{signedDate:instant+2000},{},{gracePeriodExpiresDate:instant+20*86400000}));expect((await service.read(a)).state).toBe("grace");
});
it("paid monthly and annual users each get 20 hunts in the UTC month",async()=>{
  await service.linkAppleTransaction(a,certs.jws(transaction({offerType:undefined,offerDiscountType:undefined,productId:PRODUCTS.annual})));
  const results=await Promise.all(Array.from({length:30},(_,i)=>service.admitHunt(a,"paid_"+String(i).padStart(8,'0'),fingerprint)));
  expect(results.filter(x=>x==="admitted")).toHaveLength(20);expect(results.filter(x=>x==="quota")).toHaveLength(10);
});
it("verified store trial keeps the original trial quota across platforms",async()=>{
  await service.startTrial(a,"web");const before=await service.read(a);
  await service.admitHunt(a,"fixture_first_hunt",fingerprint);await service.linkAppleTransaction(a,certs.jws(transaction()));
  expect(new Date((await service.read(a)).trial_started_at!).getTime()).toBe(new Date(before.trial_started_at!).getTime());
  expect(await service.admitHunt(a,"fixture_first_hunt",fingerprint)).toBe("duplicate");
});
it("Play reads current Developer API status and binds the token hash to one account",async()=>{
  expect(await service.linkGooglePurchase(a,token)).toBe(true);expect(getSubscription).toHaveBeenCalledWith("com.knightaiav.dandelist",token);expect((await service.read(a)).state).toBe("active");
  await expect(service.linkGooglePurchase(b,token)).rejects.toThrow("binding");
  const rows=await db.query("select external_key from entitlement_purchases");expect(JSON.stringify(rows)).not.toContain(token);
});
it("Google RTDN authenticates before API access and does not trust the notification type to grant",async()=>{
  await service.linkGooglePurchase(a,token);getSubscription.mockClear();
  await expect(service.processGoogleRTDN("bad",rtdn())).rejects.toThrow("Unauthorized");expect(getSubscription).not.toHaveBeenCalled();
  google.subscriptionState="SUBSCRIPTION_STATE_EXPIRED";await service.processGoogleRTDN("fixture-authorized-push",rtdn());expect((await service.read(a)).state).toBe("expired");
});
it("same Play token can renew while duplicate events and out-of-order old events are harmless",async()=>{
  await service.linkGooglePurchase(a,token);google.lineItems[0]!.expiryTime=new Date(instant+60*86400000).toISOString();google.latestOrderId="GPA.FIXTURE.1234..1";
  const event=rtdn(2000);expect(await service.processGoogleRTDN("fixture-authorized-push",event)).toBe(true);expect(await service.processGoogleRTDN("fixture-authorized-push",event)).toBe(false);
  expect(new Date((await service.read(a)).expires_at!).getTime()).toBe(instant+60*86400000);
  google.subscriptionState="SUBSCRIPTION_STATE_EXPIRED";await service.processGoogleRTDN("fixture-authorized-push",rtdn(1000));expect((await service.read(a)).state).toBe("active");
});
it("Play grace and canceled periods retain access, pending purchases do not consume a server trial",async()=>{
  await service.startTrial(a,"android");google.subscriptionState="SUBSCRIPTION_STATE_PENDING";await service.linkGooglePurchase(a,token);expect((await service.read(a)).state).toBe("trialing");
  google.subscriptionState="SUBSCRIPTION_STATE_IN_GRACE_PERIOD";await service.processGoogleRTDN("fixture-authorized-push",rtdn());expect((await service.read(a)).state).toBe("grace");
  google.subscriptionState="SUBSCRIPTION_STATE_CANCELED";google.lineItems[0]!.autoRenewingPlan!.autoRenewEnabled=false;await service.processGoogleRTDN("fixture-authorized-push",rtdn(2000));expect((await service.read(a)).state).toBe("active");expect((await service.read(a)).cancel_at_period_end).toBe(true);
});
it("unlinked store notifications and unknown products cannot grant entitlement",async()=>{
  await expect(service.processAppleNotification(notification("DID_RENEW"))).rejects.toThrow("Unlinked");
  await expect(service.processGoogleRTDN("fixture-authorized-push",rtdn())).rejects.toThrow("Unlinked");
  google.lineItems[0]!.productId="unknown.fixture";await expect(service.linkGooglePurchase(a,token)).rejects.toThrow("product");expect((await service.read(a)).state).toBe("none");
});
it("deleting an account deletes entitlement records and usage without gating deletion",async()=>{
  const user=(await db.query<{id:string}>("insert into users(email)values('delete-entitlements@example.invalid')returning id")).rows[0]!.id;
  await service.startTrial(user,"web");await service.admitHunt(user,"fixture_delete_hunt",fingerprint);await db.query("delete from users where id=$1",[user]);
  expect((await db.query("select * from entitlements where user_id=$1",[user])).rows).toHaveLength(0);expect((await db.query("select * from entitlement_hunts where user_id=$1",[user])).rows).toHaveLength(0);
});
