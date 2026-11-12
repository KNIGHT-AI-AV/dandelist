/** Read-only Play Developer API boundary. Phase 2 supplies only mocked clients, never credentials or acknowledgements. */
export interface GoogleSubscription {
  startTime?:string;
  subscriptionState:string;
  latestOrderId:string;
  externalAccountIdentifiers?:{obfuscatedExternalAccountId?:string};
  linkedPurchaseToken?:string;
  lineItems:{productId:string;expiryTime:string;autoRenewingPlan?:{autoRenewEnabled?:boolean};offerPhase?:{freeTrial?:Record<string,never>;basePrice?:Record<string,never>;introductoryPrice?:Record<string,never>;prorationPeriod?:{originalOfferPhaseType?:string}}}[];
}
/** Current phase, not the original offer ID: an offer can outlive its free-trial phase. Unknown phase fails closed. */
export function googlePhaseIsTrial(line:GoogleSubscription["lineItems"][number]):boolean {
  const phase=line.offerPhase;
  if(!phase||typeof phase!=="object"||Array.isArray(phase))throw new Error("Play offer phase unavailable");
  const keys=Object.keys(phase);
  if(keys.length!==1||!["freeTrial","basePrice","introductoryPrice","prorationPeriod"].includes(keys[0]!))throw new Error("Invalid Play offer phase");
  const value=phase[keys[0] as keyof typeof phase];
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid Play offer phase");
  if(keys[0]==="prorationPeriod") {
    const original=phase.prorationPeriod!.originalOfferPhaseType;
    if(!["BASE","INTRODUCTORY","FREE_TRIAL"].includes(original??""))throw new Error("Unknown Play proration phase");
    return original==="FREE_TRIAL";
  }
  return keys[0]==="freeTrial";
}
export interface GooglePlayClient { getSubscription(packageName:string,purchaseToken:string):Promise<GoogleSubscription> }
/** Must verify Pub/Sub OIDC issuer, audience and authorized service-account identity before returning. No permissive default. */
export interface GooglePushAuthenticator { verify(authorization:string):Promise<void> }
export interface GoogleRTDN { packageName:string;eventTimeMillis:string;subscriptionNotification:{purchaseToken:string;notificationType:number} }
