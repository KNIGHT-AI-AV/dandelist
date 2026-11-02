/**
 * The picture beside what the Dandy brings back from a look (owner, 2026-11-02: "Suggestion should have a picture.
 * revisions should have a picture. Amendments should have a picture"). An amendment is a different find, so it shows
 * its own checked photo or none, never the old one. A new or unchanged price is the same thing: its find's photo, or
 * else the wish's saved one.
 */
export function foundPhoto(o: { kind: string; option?: { imageUrl?: string } }, saved?: string | null): string | null {
  if (o.kind === "amended") return o.option?.imageUrl ?? null;
  if (o.kind === "changed" || o.kind === "same") return o.option?.imageUrl ?? saved ?? null;
  return null;
}
