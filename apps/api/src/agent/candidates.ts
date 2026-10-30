import { toMediaImage, type Archive } from "../archive/archive";
import { articleTitle, leadFits, wikiPhotos } from "../wiki-photos";
import type { WishCandidate } from "./agent";
import type { MediaKind } from "./media";
import { within } from "./time";
import type { Fetcher } from "./tools";

/** How long a vague wish's candidates may take to get their photos: they go out beside the hunt, never ahead of it. */
export const CANDIDATE_PHOTOS_MS = 6_000;

/**
 * The titles a candidate's photo is looked up by, best first: its make and model ("Porsche 911", since a variant rarely
 * has a photo of its own), then the model alone, for a kind with no maker ("Maine Coon", whose make is "Cat").
 */
export function photoTitles(c: Pick<WishCandidate, "make" | "model">): string[] {
  const model = c.model.trim();
  const make = c.make.trim();
  const both = make && !model.toLowerCase().includes(make.toLowerCase()) ? `${make} ${model}` : model;
  return [...new Set([both, model].map(articleTitle).filter(Boolean))];
}

/**
 * A photo for each candidate, so the person can pick the one they meant by sight (owner, 2026-10-30): the archive's
 * approved photo when it knows the thing, else the lead photo of its Wikipedia article when that article is about the
 * very model (leadFits: "Porsche" never lends its photo to a 911). All at once, by `by`; a candidate with no photo
 * keeps its name, and one that came with a photo keeps it.
 */
export async function candidatePhotos(candidates: WishCandidate[], ctx: { archive?: Archive; api: Fetcher; kind: MediaKind; by: number }): Promise<WishCandidate[]> {
  const left = () => Math.max(0, ctx.by - Date.now());
  const titles = candidates.map(photoTitles);
  const [archived, wiki] = await Promise.all([
    Promise.all(candidates.map((c) => (ctx.archive && !c.image ? within(ctx.archive.lookup(c.name, ctx.kind).catch(() => null), left()) : Promise.resolve(null)))),
    within(wikiPhotos(titles.flat(), ctx.api, Math.min(CANDIDATE_PHOTOS_MS, left())), left()),
  ]);
  return candidates.map((c, i) => {
    if (c.image) return c;
    const hit = archived[i];
    if (hit?.photos.length) return { ...c, image: toMediaImage(hit.photos[0]!) };
    for (const title of titles[i]!) {
      const found = wiki?.get(title);
      if (found && leadFits(title, found.article)) return { ...c, image: found.image };
    }
    return c;
  });
}
