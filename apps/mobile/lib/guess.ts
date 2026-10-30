import type { Draft } from "./agent";

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
