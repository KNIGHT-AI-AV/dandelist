import type { LegalDocument } from "../../components/legal";
import { PRIVACY,PRIVACY_UPDATED,TERMS,TERMS_UPDATED } from "../legal";
import { DRAFT_FEATURES } from "./features";
import copy from "./copy.json";

/** The off lane returns the current policy's arrays and dates unchanged. No live text replacement. */
export function legalDocuments(historyEnabled=DRAFT_FEATURES.MODEL_HISTORY_ENABLED):LegalDocument[]{
  return [
    {id:"privacy",title:"Privacy",updated:historyEnabled?copy.legal.updated:PRIVACY_UPDATED,sections:historyEnabled?[...PRIVACY,{id:"chat-continuity",heading:copy.legal.privacyHeading,body:copy.legal.privacyBody}]:PRIVACY},
    {id:"terms",title:"Terms",updated:historyEnabled?copy.legal.updated:TERMS_UPDATED,sections:historyEnabled?[...TERMS,{id:"chat-continuity-terms",heading:copy.legal.termsHeading,body:copy.legal.termsBody}]:TERMS},
  ];
}
