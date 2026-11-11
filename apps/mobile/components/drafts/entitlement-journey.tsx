import { useEffect,useRef,useState,type ReactNode } from "react";
import { Pressable,Text,View } from "react-native";
import { layout,radius,space,type,usePalette,useType } from "../../lib/theme";
import { DRAFT_FEATURES } from "../../lib/drafts/features";
import { FREE_ACTIONS,journeyStage,type AccessSnapshot,type DraftEntitlementClient,type DraftPlatform,type FreeAction } from "../../lib/drafts/entitlements";
import copy from "../../lib/drafts/copy.json";

const c=copy.flow;
export function DraftButton({label,onPress,disabled=false,quiet=false}:{label:string;onPress():void;disabled?:boolean;quiet?:boolean}){
  const p=usePalette();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress}
    style={{minHeight:layout.headerBar,paddingHorizontal:space[16],paddingVertical:space[12],borderRadius:radius.control,alignItems:"center",justifyContent:"center",backgroundColor:quiet?"transparent":p.accent,opacity:disabled?.5:1}}>
    <Text style={[type.label,{color:quiet?p.accentText:p.onAccent,textAlign:"center"}]}>{label}</Text>
  </Pressable>;
}
export function DraftParagraph({children}:{children:ReactNode}){const p=usePalette();return <Text style={[type.callout,{color:p.ink2}]}>{children}</Text>;}
export function SamplePlan(){
  const p=usePalette(),t=useType();
  return <View testID="saved-plan" style={{gap:space[12],padding:space[20],borderWidth:1,borderColor:p.hair,borderRadius:radius.lg}}>
    <Text accessibilityRole="header" style={[t.title2,{color:p.ink}]}>{c.planTitle}</Text>
    {[[c.upfront,c.sampleUpfront],[c.running,c.sampleRunning],[c.timeline,c.sampleTimeline]].map(([label,value])=><View key={label} style={{flexDirection:"row",justifyContent:"space-between",gap:space[12],flexWrap:"wrap"}}><DraftParagraph>{label}</DraftParagraph><Text style={[type.figure,{color:p.ink}]}>{value}</Text></View>)}
    <DraftParagraph>{c.sampleSaving}</DraftParagraph>
  </View>;
}
export interface JourneyProps {
  enabled?:boolean;platform:DraftPlatform;signedIn:boolean;consentAccepted:boolean;client:DraftEntitlementClient;
  onSignIn():void;onConsent():void;onFreeAction(action:FreeAction):void;onPremiumWork():void;
}
/** Draft boundary, used only in the development preview. No production work is wired here. */
export function EntitlementJourney({enabled=DRAFT_FEATURES.ENTITLEMENTS_ENABLED,platform,signedIn,consentAccepted,client,onSignIn,onConsent,onFreeAction,onPremiumWork}:JourneyProps){
  const p=usePalette(),t=useType();
  const [snapshot,setSnapshot]=useState<AccessSnapshot>(),[busy,setBusy]=useState(false),[error,setError]=useState(false),[notice,setNotice]=useState<string>(),[firstValue,setFirstValue]=useState(false),[offer,setOffer]=useState(false);
  const epoch=useRef(0);
  async function run<T>(operation:()=>Promise<T>,accept:(value:T)=>void){
    if(!enabled||!signedIn||!consentAccepted)return;
    const mine=epoch.current;setBusy(true);setError(false);setNotice(undefined);
    try{const value=await operation();if(mine===epoch.current)accept(value);}catch{if(mine===epoch.current)setError(true);}finally{if(mine===epoch.current)setBusy(false);}
  }
  useEffect(()=>{
    epoch.current++;setSnapshot(undefined);setFirstValue(false);setOffer(false);setError(false);setBusy(false);setNotice(undefined);
    if(enabled&&signedIn&&consentAccepted)void run(()=>client.read(),setSnapshot);
    return ()=>{epoch.current++;};
  },[enabled,signedIn,consentAccepted,client]);
  const stage=journeyStage(enabled,signedIn,consentAccepted,snapshot,firstValue,offer);
  if(stage==="disabled")return null;
  const heading=stage==="signin"?c.signInTitle:stage==="consent"?c.consentTitle:stage==="trial"?(platform==="ios"?c.iosTitle:c.trialTitle):stage==="paywall"?(["expired","revoked"].includes(snapshot!.state)?c.expiredTitle:c.offerTitle):stage==="value"?c.firstTitle:c.loading;
  const freeLabels:Record<FreeAction,string>={signin:c.signIn,read:c.read,export:c.export,delete:c.delete,privacy:c.privacy,cancel:c.cancel};
  return <View testID={`journey-${stage}`} style={{width:"100%",maxWidth:520,alignSelf:"center",gap:space[24],padding:space[24],backgroundColor:p.bg}}>
    <Text accessibilityRole="header" style={[t.title1,{color:p.ink}]}>{heading}</Text>
    {stage==="signin"?<><DraftParagraph>{c.signInBody}</DraftParagraph><DraftButton label={c.signIn} onPress={onSignIn}/></>:null}
    {stage==="consent"?<><DraftParagraph>{c.consentBody}</DraftParagraph><DraftButton label={c.agree} onPress={onConsent}/></>:null}
    {error?<View accessibilityLiveRegion="polite"><DraftParagraph>{c.error}</DraftParagraph><DraftButton label={c.retry} onPress={()=>void run(()=>client.read(),setSnapshot)} disabled={busy}/></View>:null}
    {stage==="trial"&&!error?<>
      <DraftParagraph>{platform==="ios"?c.iosBody:c.trialBody}</DraftParagraph>
      {platform==="ios"?<DraftParagraph>{c.appleTerms}</DraftParagraph>:null}
      <DraftButton label={busy?c.working:platform==="ios"?c.iosAction:c.startTrial} disabled={busy} onPress={()=>void(platform==="ios"?run(()=>client.appleOffer(),r=>{setSnapshot(r.snapshot);if(r.outcome!=="confirmed")setNotice(r.outcome==="cancelled"?c.appleCancelled:c.appleIneligible);}):run(()=>client.startTrial(platform),setSnapshot))}/>
    </>:null}
    {stage==="value"?<>
      <DraftParagraph>{c.firstBody}</DraftParagraph><SamplePlan/>
      <DraftButton label={c.options} disabled={busy} onPress={()=>{setFirstValue(true);setOffer(true);}}/>
      <DraftButton label={busy?c.working:c.newHunt} disabled={busy||error} onPress={()=>void run(()=>client.admitPremium(),r=>{setSnapshot(r.snapshot);if(r.admitted){setFirstValue(true);onPremiumWork();}else setOffer(true);})}/>
    </>:null}
    {stage==="paywall"?<>
      <DraftParagraph>{snapshot?.canStartPremium?c.offerBody:c.expiredBody}</DraftParagraph>
      <View testID="pending-prices" style={{gap:space[16]}}>{[c.monthly,c.annual].map(label=><View key={label} style={{flexDirection:"row",justifyContent:"space-between",gap:space[12],padding:space[16],borderWidth:1,borderColor:p.hair,borderRadius:radius.control}}><DraftParagraph>{label}</DraftParagraph><Text style={[type.label,{color:p.accentText}]}>{c.pending}</Text></View>)}</View>
      <DraftParagraph>{c.pricesPending}</DraftParagraph>
      {snapshot?.canStartPremium?<DraftButton label={c.continueTrial} onPress={()=>setOffer(false)}/>:null}
    </>:null}
    {notice?<View accessibilityLiveRegion="polite"><DraftParagraph>{notice}</DraftParagraph></View>:null}
    <View testID="free-actions" style={{gap:space[4],borderTopWidth:1,borderTopColor:p.hair,paddingTop:space[16]}}>
      {FREE_ACTIONS.filter(action=>stage!=="signin"||action!=="signin").map(action=><DraftButton key={action} quiet label={freeLabels[action]} onPress={()=>onFreeAction(action)}/>)}
    </View>
  </View>;
}
