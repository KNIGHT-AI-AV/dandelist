import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { expect,it } from "vitest";
import { PRIVACY,PRIVACY_UPDATED,TERMS,TERMS_UPDATED } from "../legal";
import { DRAFT_FEATURES } from "./features";
import { legalDocuments } from "./legal";
import { fixtureEntitlements,journeyStage } from "./entitlements";
import copy from "./copy.json";

it("defaults both drafts off and preserves current legal arrays, dates and wording",()=>{
  expect(DRAFT_FEATURES).toEqual({MODEL_HISTORY_ENABLED:false,ENTITLEMENTS_ENABLED:false});
  const [privacy,terms]=legalDocuments();expect(privacy?.sections).toBe(PRIVACY);expect(privacy?.updated).toBe(PRIVACY_UPDATED);expect(terms?.sections).toBe(TERMS);expect(terms?.updated).toBe(TERMS_UPDATED);
});
it("adds the matching limited-retention legal draft only alongside the history flag",()=>{
  const original=JSON.stringify({PRIVACY,TERMS});const [privacy,terms]=legalDocuments(true);
  expect(privacy?.sections.at(-1)?.body.join(" ")).toContain("30 days");expect(privacy?.sections.at(-1)?.body.join(" ")).toContain("Deleting a conversation");expect(terms?.sections.at(-1)?.body.join(" ")).toContain("rebuilds context");
  expect(JSON.stringify({PRIVACY,TERMS})).toBe(original);expect(legalDocuments(false)[0]?.sections).toBe(PRIVACY);
});
it("uses the literal cleaner clipboard artifact with a reproducible receipt",()=>{
  const file=readFileSync(new URL("./copy.json",import.meta.url));
  const receipt=JSON.parse(readFileSync(new URL("../../../../phase3/cleaner-receipt.json",import.meta.url),"utf8"));
  expect(createHash("sha256").update(file).digest("hex")).toBe(receipt.sha256);expect(receipt.literalCopyOutputClicked).toBe(true);expect(receipt.source).toContain("Windows system clipboard");
  expect(copy.flow.pending).toBe("Pending");expect(copy.flow.iosBody).toContain("two-week");expect(copy.flow.trialBody).toContain("without a card");
});
it("never advances to an offer before sign-in, consent, trial and first value",()=>{
  const none={state:"none" as const,expiresAt:null,canStartPremium:false};const trial={...none,state:"trialing" as const,canStartPremium:true};
  expect(journeyStage(false,true,true,trial,true,true)).toBe("disabled");expect(journeyStage(true,false,true,trial,true,true)).toBe("signin");expect(journeyStage(true,true,false,trial,true,true)).toBe("consent");expect(journeyStage(true,true,true,none,true,true)).toBe("trial");expect(journeyStage(true,true,true,trial,false,true)).toBe("value");expect(journeyStage(true,true,true,trial,true,true)).toBe("paywall");
});
it("fixture trial dates come from its service clock and restarting cannot reset expiry",async()=>{
  let serverTime=Date.parse("2026-11-11T00:00:00Z");const client=fixtureEntitlements(()=>serverTime,async()=>"confirmed");
  const first=await client.startTrial("android");expect(first.expiresAt).toBe("2026-11-25T00:00:00.000Z");
  serverTime+=15*86400000;expect((await client.startTrial("web")).expiresAt).toBe(first.expiresAt);expect((await client.admitPremium()).admitted).toBe(false);
});
it.each(["cancelled","ineligible"] as const)("Apple %s leaves the sample unentitled",async outcome=>{
  const client=fixtureEntitlements(()=>0,async()=>outcome);expect((await client.appleOffer()).snapshot.state).toBe("none");expect((await client.admitPremium()).admitted).toBe(false);
});
it("only confirmed sample Apple offers start the two-week fixture trial",async()=>{
  const client=fixtureEntitlements(()=>0,async()=>"confirmed");const r=await client.appleOffer();expect(r.snapshot.state).toBe("trialing");expect(r.snapshot.expiresAt).toBe(new Date(14*86400000).toISOString());
});
