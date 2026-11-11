import { readFileSync } from "node:fs";
import { Environment, SignedDataVerifier, type JWSTransactionDecodedPayload, type JWSRenewalInfoDecodedPayload, type ResponseBodyV2DecodedPayload } from "@apple/app-store-server-library";
const roots=["AppleRootCA-G3.cer","AppleRootCA-G2.cer"].map(name=>readFileSync(new URL("../../certs/"+name,import.meta.url)));
export interface AppleConfig { bundleId:string; environment:Environment.SANDBOX|Environment.PRODUCTION; appAppleId?:number }
/** Offline chain/signature verification using Apple's maintained verifier. No Xcode/local unsigned bypass. */
export class AppleVerifier {
  private verifier:SignedDataVerifier;
  constructor(readonly config:AppleConfig,testRoots?:Buffer[]){
    if(![Environment.SANDBOX,Environment.PRODUCTION].includes(config.environment))throw new Error("Unsupported Apple verification environment");
    if(testRoots&&config.environment!==Environment.SANDBOX)throw new Error("Test roots forbidden in production");
    this.verifier=new SignedDataVerifier(testRoots??roots,false,config.environment,config.bundleId,config.appAppleId);
  }
  async transaction(jws:string):Promise<JWSTransactionDecodedPayload>{this.header(jws);return this.verifier.verifyAndDecodeTransaction(jws);}
  async renewal(jws:string):Promise<JWSRenewalInfoDecodedPayload>{this.header(jws);return this.verifier.verifyAndDecodeRenewalInfo(jws);}
  async notification(jws:string):Promise<{notification:ResponseBodyV2DecodedPayload;transaction:JWSTransactionDecodedPayload;renewal?:JWSRenewalInfoDecodedPayload}>{
    this.header(jws);const notification=await this.verifier.verifyAndDecodeNotification(jws);
    if(!notification.data?.signedTransactionInfo)throw new Error("Notification has no transaction");
    const transaction=await this.transaction(notification.data.signedTransactionInfo);
    const renewal=notification.data.signedRenewalInfo?await this.renewal(notification.data.signedRenewalInfo):undefined;
    if(renewal&&renewal.originalTransactionId!==transaction.originalTransactionId)throw new Error("Mismatched Apple renewal");
    return {notification,transaction,renewal};
  }
  private header(jws:string){
    if(jws.length>500_000)throw new Error("Apple payload limit");
    const h=JSON.parse(Buffer.from(jws.split('.')[0]??'',"base64url").toString("utf8"));
    if(h.alg!=="ES256"||!Array.isArray(h.x5c)||h.x5c.length!==3)throw new Error("Invalid Apple JWS header");
  }
}
export { Environment };
