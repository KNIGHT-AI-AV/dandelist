import { createElement,type ReactNode } from "react";
import { create,act,type ReactTestRenderer } from "react-test-renderer";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { type as roles,THEMES } from "../../lib/palette";
import type { AccessSnapshot,DraftEntitlementClient,FreeAction } from "../../lib/drafts/entitlements";
import copy from "../../lib/drafts/copy.json";

(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
vi.mock("react-native",()=>Object.fromEntries(["Pressable","Text","View"].map(name=>[name,({children,...props}:{children?:ReactNode})=>createElement(name,props,children)])));
vi.mock("../../lib/theme",()=>({type:roles,space:{4:4,8:8,12:12,16:16,20:20,24:24},layout:{headerBar:44},radius:{control:16,lg:26},usePalette:()=>THEMES.emerald.palette,useType:()=>roles}));
const { EntitlementJourney }=await import("./entitlement-journey");
const none:AccessSnapshot={state:"none",expiresAt:null,canStartPremium:false};const trial:AccessSnapshot={state:"trialing",expiresAt:"2026-11-25T00:00:00Z",canStartPremium:true};const expired:AccessSnapshot={state:"expired",expiresAt:"2026-11-25T00:00:00Z",canStartPremium:false};
let root:ReactTestRenderer|undefined,client:DraftEntitlementClient,props:Parameters<typeof EntitlementJourney>[0];
beforeEach(()=>{
  client={read:vi.fn(async()=>none),startTrial:vi.fn(async()=>trial),appleOffer:vi.fn(async()=>({outcome:"confirmed" as const,snapshot:trial})),admitPremium:vi.fn(async()=>({admitted:true,snapshot:trial}))};
  props={enabled:true,platform:"web",signedIn:true,consentAccepted:true,client,onSignIn:vi.fn(),onConsent:vi.fn(),onFreeAction:vi.fn(),onPremiumWork:vi.fn()};
});
afterEach(async()=>{await act(async()=>root?.unmount());root=undefined;});
const render=async()=>{await act(async()=>{if(root)root.update(createElement(EntitlementJourney,props));else root=create(createElement(EntitlementJourney,props));});};
const press=async(label:string)=>{await act(async()=>{root!.root.findByProps({accessibilityLabel:label}).props.onPress();});};
const stage=(name:string)=>root!.root.findAllByProps({testID:"journey-"+name}).length>0;
it("off by default renders nothing and makes no service calls",async()=>{delete props.enabled;await render();expect(root?.toJSON()).toBe(null);expect(client.read).not.toHaveBeenCalled();});
it("does not consult entitlement before sign-in and account consent",async()=>{
  props.signedIn=false;await render();expect(stage("signin")).toBe(true);await press(copy.flow.signIn);expect(props.onSignIn).toHaveBeenCalledOnce();
  props.signedIn=true;props.consentAccepted=false;await render();expect(stage("consent")).toBe(true);await press(copy.flow.agree);expect(props.onConsent).toHaveBeenCalledOnce();expect(client.read).not.toHaveBeenCalled();
});
it.each(["web","android"] as const)("%s trial shows first value before an optional offer, with only pending prices",async platform=>{
  props.platform=platform;await render();expect(stage("trial")).toBe(true);expect(root!.root.findAllByProps({testID:"pending-prices"})).toHaveLength(0);
  await press(copy.flow.startTrial);expect(client.startTrial).toHaveBeenCalledWith(platform);expect(stage("value")).toBe(true);expect(root!.root.findAllByProps({testID:"saved-plan"})).not.toHaveLength(0);
  await press(copy.flow.options);expect(stage("paywall")).toBe(true);const prices=root!.root.findByProps({testID:"pending-prices"});expect(prices.findAll(n=>String(n.type)==="Text"&&n.children.join("")===copy.flow.pending)).toHaveLength(2);
  await press(copy.flow.continueTrial);expect(stage("value")).toBe(true);expect(client.appleOffer).not.toHaveBeenCalled();
});
it("iPhone waits for the injected Apple confirmation, never the no-card trial method",async()=>{
  props.platform="ios";await render();expect(JSON.stringify(root!.toJSON())).toContain("two-week introductory offer");await press(copy.flow.iosAction);expect(stage("value")).toBe(true);expect(client.appleOffer).toHaveBeenCalledOnce();expect(client.startTrial).not.toHaveBeenCalled();
});
it.each(["cancelled","ineligible"] as const)("Apple %s does not open first value",async outcome=>{
  props.platform="ios";client.appleOffer=vi.fn(async()=>({outcome,snapshot:none}));await render();await press(copy.flow.iosAction);expect(stage("trial")).toBe(true);expect(root!.root.findAllByProps({testID:"saved-plan"})).toHaveLength(0);expect(props.onPremiumWork).not.toHaveBeenCalled();
});
it("rechecks the service on new work and blocks when a previously valid trial expires",async()=>{
  client.read=vi.fn(async()=>trial);client.admitPremium=vi.fn(async()=>({admitted:false,snapshot:expired}));await render();await press(copy.flow.newHunt);expect(stage("paywall")).toBe(true);expect(props.onPremiumWork).not.toHaveBeenCalled();
});
it("starts premium work only after the service admits it",async()=>{
  client.read=vi.fn(async()=>trial);await render();await press(copy.flow.newHunt);expect(client.admitPremium).toHaveBeenCalledOnce();expect(props.onPremiumWork).toHaveBeenCalledOnce();
});
it("ignores an old account response after sign-out",async()=>{
  let complete!:(snapshot:AccessSnapshot)=>void;client.read=vi.fn(()=>new Promise<AccessSnapshot>(resolve=>{complete=resolve;}));
  await render();props.signedIn=false;await render();await act(async()=>complete(expired));
  expect(stage("signin")).toBe(true);expect(stage("paywall")).toBe(false);expect(props.onPremiumWork).not.toHaveBeenCalled();
});
it.each(["expired","unavailable"])("%s access preserves all six free actions without consulting billing",async state=>{
  client.read=vi.fn(async()=>{if(state==="unavailable")throw new Error("fixture unavailable");return expired;});await render();
  const labels:Record<FreeAction,string>={signin:copy.flow.signIn,read:copy.flow.read,export:copy.flow.export,delete:copy.flow.delete,privacy:copy.flow.privacy,cancel:copy.flow.cancel};
  for(const [action,label] of Object.entries(labels)){await press(label);expect(props.onFreeAction).toHaveBeenCalledWith(action);}
  expect(client.startTrial).not.toHaveBeenCalled();expect(client.appleOffer).not.toHaveBeenCalled();expect(client.admitPremium).not.toHaveBeenCalled();
});
