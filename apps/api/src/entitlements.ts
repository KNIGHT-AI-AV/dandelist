import { createHash } from "node:crypto";
import type { Db } from "./db";
import type { JWSTransactionDecodedPayload } from "@apple/app-store-server-library";
import { AppleVerifier } from "./billing/apple";
import type { GooglePlayClient,GooglePushAuthenticator,GoogleRTDN } from "./billing/google";

export const PRODUCTS={monthly:"com.knightaiav.dandelist.premium.monthly",annual:"com.knightaiav.dandelist.premium.annual"}as const;
export const PROVISIONAL_PRICES={monthlyUsdCents:999,annualUsdCents:7999,trialDays:14,paidHunts:20,trialHunts:10}as const;
export type EntitlementState="none"|"trialing"|"active"|"grace"|"expired"|"revoked";
export interface Entitlement {user_id:string;state:EntitlementState;platform:"web"|"android"|"ios"|null;product:string|null;original_transaction_id:string|null;expires_at:string|Date|null;trial_started_at:string|Date|null;trial_ends_at:string|Date|null;cancel_at_period_end:boolean}
interface Purchase {platform:"ios"|"android";key:string;original:string;product:string;state:EntitlementState;expires:Date;eventAt:Date;cancel?:boolean;trialStart?:Date;trialEnd?:Date}
export interface EntitlementOptions {enabled?:boolean;apple?:AppleVerifier;google?:GooglePlayClient;googlePush?:GooglePushAuthenticator;packageName?:string}
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
export const googleAccountId=(userId:string)=>hash(userId);
const allowedProducts=new Set<string>(Object.values(PRODUCTS));
/** No routes or app UI use this module. All mutations require the explicit, default-off service flag. */
export class EntitlementService {
  constructor(private db:Db,private opts:EntitlementOptions={}){}
  private enabled(){if(!this.opts.enabled)throw new Error("Entitlement feature disabled");}
  private async clock(){return new Date((await this.db.query<{time:string|Date}>("select clock_timestamp() as time")).rows[0]!.time);}
  private product(product:unknown):string {if(typeof product!=="string"||!allowedProducts.has(product))throw new Error("Unknown product");return product;}
  async read(userId:string):Promise<Entitlement>{this.enabled();return (await this.db.query<Entitlement>("select * from entitlement_refresh($1)",[userId])).rows[0]!;}
  async startTrial(userId:string,platform:"web"|"android"):Promise<Entitlement>{this.enabled();return (await this.db.query<Entitlement>("select * from entitlement_start_trial($1,$2)",[userId,platform])).rows[0]!;}
  /** Free account/data operations never consult entitlements, including after expiry or provider failure. */
  async authorize(userId:string,action:"signin"|"read"|"export"|"delete"|"privacy"|"cancel"|"premium-update"):Promise<boolean>{
    if(action!=="premium-update"||!this.opts.enabled)return true;
    return ["trialing","active","grace"].includes((await this.read(userId)).state);
  }
  async admitHunt(userId:string,requestId:string,requestFingerprint:string):Promise<"admitted"|"duplicate"|"quota"|"expired"|"disabled">{
    if(!this.opts.enabled)return "disabled";
    if(!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)||!/^[a-f0-9]{64}$/.test(requestFingerprint))throw new Error("Invalid hunt key");
    return (await this.db.query<{result:"admitted"|"duplicate"|"quota"|"expired"}>("select entitlement_admit_hunt($1,$2,$3) as result",[userId,requestId,requestFingerprint])).rows[0]!.result;
  }
  private async apply(userId:string,event:string,p:Purchase,transactionEvent?:string){
    this.product(p.product);
    if(!Number.isFinite(p.expires.getTime())||!Number.isFinite(p.eventAt.getTime()))throw new Error("Invalid store timestamp");
    if(p.eventAt.getTime()>(await this.clock()).getTime()+5*60_000)throw new Error("Future store event");
    return !!(await this.db.query<{applied:boolean}>("select entitlement_apply_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) as applied",[userId,p.platform,p.key,event,p.original,p.product,p.state,p.expires.toISOString(),p.eventAt.toISOString(),p.cancel??null,p.trialStart?.toISOString()??null,p.trialEnd?.toISOString()??null,transactionEvent??null])).rows[0]?.applied;
  }
  private applePurchase(tx:JWSTransactionDecodedPayload):Purchase {
    if(!tx.originalTransactionId||!tx.transactionId||!tx.expiresDate||!tx.signedDate||!tx.purchaseDate||tx.type!=="Auto-Renewable Subscription")throw new Error("Incomplete Apple subscription");
    if(tx.expiresDate<=tx.purchaseDate||tx.purchaseDate>tx.signedDate+5*60_000)throw new Error("Invalid Apple subscription dates");
    const trial=tx.offerType===1&&tx.offerDiscountType==="FREE_TRIAL";
    return {platform:"ios",key:tx.originalTransactionId,original:tx.originalTransactionId,product:this.product(tx.productId),state:tx.revocationDate?"revoked":trial?"trialing":"active",expires:new Date(tx.expiresDate),eventAt:new Date(tx.signedDate),...(trial?{trialStart:new Date(tx.purchaseDate),trialEnd:new Date(tx.expiresDate)}:{})};
  }
  async linkAppleTransaction(userId:string,signedTransaction:string){
    this.enabled();if(!this.opts.apple)throw new Error("Apple verifier unavailable");
    const tx=await this.opts.apple.transaction(signedTransaction);
    if(tx.appAccountToken?.toLowerCase()!==userId.toLowerCase())throw new Error("Apple account binding mismatch");
    return this.apply(userId,"transaction:"+tx.transactionId,this.applePurchase(tx));
  }
  async processAppleNotification(signedPayload:string){
    this.enabled();if(!this.opts.apple)throw new Error("Apple verifier unavailable");
    const {notification:n,transaction:tx,renewal}=await this.opts.apple.notification(signedPayload);
    if(!n.notificationUUID||!n.signedDate)throw new Error("Missing Apple notification identity");
    const p=this.applePurchase(tx);
    const linked=(await this.db.query<{user_id:string}>("select user_id from entitlement_purchases where platform='ios' and external_key=$1",[p.key])).rows[0];
    let userId=linked?.user_id;
    if(!userId&&n.notificationType==="SUBSCRIBED"&&tx.appAccountToken&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tx.appAccountToken)){
      // Both JWS layers have already passed verification. Only an existing account
      // named by the signed transaction may acquire an otherwise unlinked purchase.
      userId=(await this.db.query<{id:string}>("select id from users where id=$1",[tx.appAccountToken])).rows[0]?.id;
    }
    if(!userId)throw new Error("Unlinked Apple purchase");
    if(tx.appAccountToken?.toLowerCase()!==userId.toLowerCase())throw new Error("Apple account binding mismatch");
    p.eventAt=new Date(n.signedDate);p.cancel=renewal?renewal.autoRenewStatus===0:undefined;
    if(["REFUND","REVOKE"].includes(String(n.notificationType)))p.state="revoked";
    else if(["EXPIRED","GRACE_PERIOD_EXPIRED"].includes(String(n.notificationType)))p.state="expired";
    else if(n.notificationType==="REFUND_REVERSED")p.state="active";
    else if(n.notificationType==="DID_FAIL_TO_RENEW"){
      if(renewal?.gracePeriodExpiresDate){p.state="grace";p.expires=new Date(renewal.gracePeriodExpiresDate);}else p.state="expired";
    }else if(!["SUBSCRIBED","DID_RENEW","DID_CHANGE_RENEWAL_STATUS","DID_CHANGE_RENEWAL_PREF","OFFER_REDEEMED","REFUND_REVERSED"].includes(String(n.notificationType)))throw new Error("Unsupported Apple notification");
    return this.apply(userId,n.notificationUUID,p,n.notificationType==="SUBSCRIBED"?"transaction:"+tx.transactionId:undefined);
  }
  private async googlePurchase(userId:string,token:string,eventAt:Date):Promise<Purchase>{
    if(!this.opts.google||!this.opts.packageName)throw new Error("Play client unavailable");
    const g=await this.opts.google.getSubscription(this.opts.packageName,token);
    if(g.externalAccountIdentifiers?.obfuscatedExternalAccountId!==googleAccountId(userId))throw new Error("Play account binding mismatch");
    if(g.linkedPurchaseToken){const old=(await this.db.query<{user_id:string}>("select user_id from entitlement_purchases where platform='android' and external_key=$1",[hash(g.linkedPurchaseToken)])).rows[0];if(old&&old.user_id!==userId)throw new Error("Linked Play purchase belongs to another account");}
    if(g.lineItems.length!==1||!g.latestOrderId)throw new Error("Unsupported Play subscription shape");
    const line=g.lineItems[0]!;const state:EntitlementState=g.subscriptionState==="SUBSCRIPTION_STATE_ACTIVE"||g.subscriptionState==="SUBSCRIPTION_STATE_CANCELED"?"active":g.subscriptionState==="SUBSCRIPTION_STATE_IN_GRACE_PERIOD"?"grace":g.subscriptionState==="SUBSCRIPTION_STATE_EXPIRED"?"expired":g.subscriptionState==="SUBSCRIPTION_STATE_ON_HOLD"||g.subscriptionState==="SUBSCRIPTION_STATE_PAUSED"?"revoked":"none";
    return {platform:"android",key:hash(token),original:g.latestOrderId.split('..')[0]!,product:this.product(line.productId),state,expires:new Date(line.expiryTime),eventAt,cancel:line.autoRenewingPlan?.autoRenewEnabled===false};
  }
  async linkGooglePurchase(userId:string,token:string){
    this.enabled();const p=await this.googlePurchase(userId,token,await this.clock());
    return this.apply(userId,"purchase:"+hash(token)+":"+p.expires.toISOString()+":"+p.state,p);
  }
  async processGoogleRTDN(authorization:string,event:GoogleRTDN){
    this.enabled();if(!this.opts.googlePush)throw new Error("Pub/Sub verifier unavailable");await this.opts.googlePush.verify(authorization);
    if(event.packageName!==this.opts.packageName||!/^\d+$/.test(event.eventTimeMillis)||!event.subscriptionNotification?.purchaseToken)throw new Error("Invalid RTDN");
    const token=event.subscriptionNotification.purchaseToken,key=hash(token);
    const linked=(await this.db.query<{user_id:string}>("select user_id from entitlement_purchases where platform='android' and external_key=$1",[key])).rows[0];
    if(!linked)throw new Error("Unlinked Play purchase");
    // Purchase tokens persist through renewals. Dedupe the token + event, not every future use of the token.
    const p=await this.googlePurchase(linked.user_id,token,new Date(Number(event.eventTimeMillis)));
    return this.apply(linked.user_id,"rtdn:"+key+":"+event.eventTimeMillis+":"+event.subscriptionNotification.notificationType,p);
  }
}
