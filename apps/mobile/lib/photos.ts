import type { FoundPhoto, Media } from "./agent";

/**
 * A retake's photo on a wish: the new photo goes first, with the wish's other photos after it. A 3D model or a cut-out
 * was made from the old photo, so they give way and the new photo is what shows.
 */
export function withNewPhoto(old: Media | undefined, found: FoundPhoto): Media {
  const fresh = found.media.images.map((i) => i.url);
  const rest = (old?.images ?? []).filter((i) => !fresh.includes(i.url));
  return { kind: found.media.kind, images: [...found.media.images, ...rest].slice(0, 6) };
}

/** Every photo a wish has shown, so a retake never offers one of them again. */
export function shownPhotos(agent: { imageUrl?: string; media?: Media } | undefined): string[] {
  return [...new Set([agent?.imageUrl, ...(agent?.media?.images ?? []).map((i) => i.url)].filter((u): u is string => !!u))];
}
