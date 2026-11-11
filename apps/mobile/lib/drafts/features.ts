/** Local drafts only. Coordinate both client/server flags and legal copy before any release. */
export interface DraftFeatures { MODEL_HISTORY_ENABLED:boolean; ENTITLEMENTS_ENABLED:boolean }
export const DRAFT_FEATURES:Readonly<DraftFeatures>=Object.freeze({MODEL_HISTORY_ENABLED:false,ENTITLEMENTS_ENABLED:false});
