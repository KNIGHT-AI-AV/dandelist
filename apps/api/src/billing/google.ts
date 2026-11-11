/** Read-only Play Developer API boundary. Phase 2 supplies only mocked clients, never credentials or acknowledgements. */
export interface GoogleSubscription {
  subscriptionState:string;
  latestOrderId:string;
  externalAccountIdentifiers?:{obfuscatedExternalAccountId?:string};
  linkedPurchaseToken?:string;
  lineItems:{productId:string;expiryTime:string;autoRenewingPlan?:{autoRenewEnabled?:boolean}}[];
}
export interface GooglePlayClient { getSubscription(packageName:string,purchaseToken:string):Promise<GoogleSubscription> }
/** Must verify Pub/Sub OIDC issuer, audience and authorized service-account identity before returning. No permissive default. */
export interface GooglePushAuthenticator { verify(authorization:string):Promise<void> }
export interface GoogleRTDN { packageName:string;eventTimeMillis:string;subscriptionNotification:{purchaseToken:string;notificationType:number} }
