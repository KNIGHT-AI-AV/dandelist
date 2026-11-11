export type DraftPlatform="ios"|"android"|"web";
export type AccessState="none"|"trialing"|"active"|"grace"|"expired"|"revoked";
/** Must come from an authoritative service. UI time never grants or renews access. */
export interface AccessSnapshot { state:AccessState; expiresAt:string|null; canStartPremium:boolean }
export type AppleOutcome="confirmed"|"cancelled"|"ineligible";
export interface DraftEntitlementClient {
  read():Promise<AccessSnapshot>;
  startTrial(platform:"web"|"android"):Promise<AccessSnapshot>;
  appleOffer():Promise<{outcome:AppleOutcome;snapshot:AccessSnapshot}>;
  admitPremium():Promise<{admitted:boolean;snapshot:AccessSnapshot}>;
}
export type FreeAction="signin"|"read"|"export"|"delete"|"privacy"|"cancel";
export const FREE_ACTIONS:readonly FreeAction[]=["signin","read","export","delete","privacy","cancel"];
export function journeyStage(enabled:boolean,signedIn:boolean,consented:boolean,snapshot:AccessSnapshot|undefined,firstValue:boolean,offer:boolean){
  if(!enabled)return "disabled";
  if(!signedIn)return "signin";
  if(!consented)return "consent";
  if(!snapshot)return "loading";
  if(["expired","revoked"].includes(snapshot.state))return "paywall";
  if(snapshot.state==="none")return "trial";
  if(!snapshot.canStartPremium)return "paywall";
  return offer&&firstValue?"paywall":"value";
}

/** Fixture service only: no persistence, network, purchase SDK, real account or product identifiers. */
export function fixtureEntitlements(clock:()=>number,apple:()=>Promise<AppleOutcome>){
  let started:number|undefined;
  const read=async():Promise<AccessSnapshot>=>{
    if(started===undefined)return {state:"none",expiresAt:null,canStartPremium:false};
    const end=started+14*86400000;
    return {state:clock()<end?"trialing":"expired",expiresAt:new Date(end).toISOString(),canStartPremium:clock()<end};
  };
  const start=async()=>{started??=clock();return read();};
  const client:DraftEntitlementClient={read,startTrial:async()=>start(),appleOffer:async()=>{const outcome=await apple();return {outcome,snapshot:outcome==="confirmed"?await start():await read()};},admitPremium:async()=>{const snapshot=await read();return {admitted:snapshot.canStartPremium,snapshot};}};
  return client;
}
