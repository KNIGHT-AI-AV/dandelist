import type { Wish } from "./wishes";

export const KIND_LABEL = { buy: "Buy", own: "Own", do: "Do", visit: "Visit" } as const;
/**
 * How much a wish is wanted, on a scale that reads in order (owner, recording 03: "Must/Nice/Dream is unclear"):
 * first the things they must have, then what they would love, then what can wait for someday.
 */
export const TIER_LABEL = { must: "Must have", nice: "Would love", dream: "Someday" } as const;
/** 1 is wanted most. */
export const TIER_RANK = { must: 1, nice: 2, dream: 3 } as const;

/** A name as it reads mid-sentence: "A month in Lisbon" becomes "a month in Lisbon"; proper names are left alone. */
export const midSentence = (name: string) => name.replace(/^(A|An|The) /, (article) => article.toLowerCase());

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** "today", "yesterday", "3 days ago", or a short date for anything older than a week. */
export function whenChecked(iso: string, now = new Date()): string {
  const then = new Date(iso);
  const days = Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(then.getFullYear(), then.getMonth(), then.getDate())) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** What the agent last did for a wish, in a few words. */
export function agentLine(w: Wish): string {
  const a = w.details.agent;
  if (!a) return "Priced by you";
  // A typical price from the archive has no single page to name.
  if (!hostOf(a.url)) return "Typical price, an estimate";
  return a.status === "verified" ? `Checked ${whenChecked(a.checkedAt)} on ${hostOf(a.url)}` : `Estimate from ${hostOf(a.url)}`;
}

export function monthYear(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
