import type { Draft, WishCandidate } from "./agent";

/** The candidates a vague wish is offered as, to pick by sight, and which of them is the one being hunted. */
export interface CandidatePick {
  candidates: WishCandidate[];
  /** The candidate the hunt is pricing (its name is the wish's), or -1 when none of them is. */
  current: number;
}

/**
 * The specific things a vague wish may mean, as photos to pick from (owner, 2026-10-30: "Images of multiple items up to
 * 5 with make model sub names just in case so user can pick which one they meant if it was not specific enough"):
 * only those with a photo, five at most, and only when two or more have one, so the row is never a lone picture or a
 * wall of names. Null otherwise; the text guesses (guessOthers) still serve then.
 */
export function guessCandidates(draft: Pick<Draft, "title" | "name" | "candidates"> | null | undefined): CandidatePick | null {
  const seen = new Set<string>();
  const shown: WishCandidate[] = [];
  for (const c of draft?.candidates ?? []) {
    const key = c.name.trim().toLowerCase();
    if (!key || !c.image?.url || seen.has(key)) continue;
    seen.add(key);
    shown.push(c);
    if (shown.length === 5) break;
  }
  if (shown.length < 2 || !draft) return null;
  const meant = new Set([draft.title, draft.name ?? ""].map((n) => n.trim().toLowerCase()).filter(Boolean));
  return { candidates: shown, current: shown.findIndex((c) => meant.has(c.name.trim().toLowerCase())) };
}

/**
 * The other likely names to offer when the reading had to work out what was meant (owner, 2026-10-30: "one of those
 * cats that look like a miniature lion, but I forgot what they're called"): null when the reading was sure, or said
 * nothing either way. The wish's own name is never offered back, nor the same name twice; three at most.
 */
export function guessOthers(draft: Pick<Draft, "title" | "sure" | "others"> | null | undefined): string[] | null {
  if (!draft || draft.sure !== false) return null;
  const seen = new Set([draft.title.trim().toLowerCase()]);
  const out: string[] = [];
  for (const raw of draft.others ?? []) {
    const name = raw.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
    if (out.length === 3) break;
  }
  return out;
}
