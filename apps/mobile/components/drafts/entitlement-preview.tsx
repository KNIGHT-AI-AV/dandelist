import { useMemo,useState } from "react";
import { ScrollView,Text,View } from "react-native";
import { DRAFT_FEATURES } from "../../lib/drafts/features";
import { fixtureEntitlements,type AppleOutcome,type DraftPlatform,type FreeAction } from "../../lib/drafts/entitlements";
import { legalDocuments } from "../../lib/drafts/legal";
import { space,type,usePalette } from "../../lib/theme";
import { DraftButton,DraftParagraph,EntitlementJourney,SamplePlan } from "./entitlement-journey";
import copy from "../../lib/drafts/copy.json";

/** Explicit fixtures only; never reads the live account or records its consent/entitlement. */
export function EntitlementPreview({enabled=DRAFT_FEATURES.ENTITLEMENTS_ENABLED}:{enabled?:boolean}){
  const p=usePalette();const [platform,setPlatform]=useState<DraftPlatform>("web"),[version,setVersion]=useState(0),[signedIn,setSignedIn]=useState(false),[consent,setConsent]=useState(false),[panel,setPanel]=useState<FreeAction|null>(null),[notice,setNotice]=useState(""),[apple,setApple]=useState<((outcome:AppleOutcome)=>void)|null>(null);
  const fixture=useMemo(()=>{
    let time=Date.parse("2026-11-11T00:00:00Z");
    const client=fixtureEntitlements(()=>time,()=>new Promise(resolve=>setApple(()=>resolve)));
    return {client,expire:()=>{time+=15*86400000;}};
  },[platform,version]);
  const [refresh,setRefresh]=useState(0);
  const client=useMemo(()=>({...fixture.client}),[fixture,refresh]);
  if(!enabled)return null;
  const reset=(next:DraftPlatform)=>{setPlatform(next);setVersion(v=>v+1);setSignedIn(false);setConsent(false);setPanel(null);setApple(null);setNotice("");};
  return <ScrollView style={{flex:1,backgroundColor:p.bg}} contentContainerStyle={{maxWidth:620,width:"100%",alignSelf:"center",padding:space[16],gap:space[16]}}>
    <Text accessibilityRole="header" style={[type.headline,{color:p.ink}]}>{copy.preview.title}</Text><DraftParagraph>{copy.preview.note}</DraftParagraph>
    <View style={{flexDirection:"row",flexWrap:"wrap",gap:space[8]}}>{(["web","android","ios"] as const).map(value=><DraftButton key={value} quiet label={copy.preview[value]} onPress={()=>reset(value)}/>)}</View>
    {panel?<View style={{gap:space[16]}}>{panel==="read"?<SamplePlan/>:panel==="privacy"?legalDocuments(true).map(doc=><View key={doc.id} style={{gap:space[12]}}><Text accessibilityRole="header" style={[type.headline,{color:p.ink}]}>{doc.title}</Text>{doc.sections.map(section=><View key={section.heading} style={{gap:space[8]}}><Text style={[type.label,{color:p.ink}]}>{section.heading}</Text>{section.body.map(text=><DraftParagraph key={text}>{text}</DraftParagraph>)}</View>)}</View>):<DraftParagraph>{copy.preview.freeDone}</DraftParagraph>}<DraftButton label={copy.flow.close} onPress={()=>setPanel(null)}/></View>:<EntitlementJourney key={`${platform}-${version}`} enabled={enabled} platform={platform} signedIn={signedIn} consentAccepted={consent} client={client} onSignIn={()=>setSignedIn(true)} onConsent={()=>setConsent(true)} onFreeAction={action=>setPanel(action)} onPremiumWork={()=>setNotice(copy.preview.premiumDone)}/>}
    {apple?<View style={{gap:space[8]}}>{(["confirmed","cancelled","ineligible"] as const).map((outcome,i)=><DraftButton key={outcome} label={[copy.preview.confirm,copy.preview.cancelOffer,copy.preview.ineligible][i]!} onPress={()=>{apple(outcome);setApple(null);}}/>)}</View>:null}
    <View style={{flexDirection:"row",flexWrap:"wrap",gap:space[8]}}><DraftButton quiet label={copy.preview.expire} onPress={()=>{fixture.expire();setRefresh(v=>v+1);}}/><DraftButton quiet label={copy.preview.reset} onPress={()=>reset(platform)}/></View>
    {notice?<DraftParagraph>{notice}</DraftParagraph>:null}
  </ScrollView>;
}
