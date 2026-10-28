import type { Media, MediaImage } from "./agent";
import { webOnly } from "./dream";

/** Pure helpers for the wish page's photo gallery and its full-screen viewer. No React, so tests can load them. */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The real photographs among a wish's media: nothing generated, web links only, each once, best first. */
export function realPhotos(media?: Pick<Media, "images"> | null): MediaImage[] {
  const seen = new Set<string>();
  return (media?.images ?? []).filter((img) => {
    const url = webOnly(img.url);
    if (img.generated || !url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

/**
 * The hero pages through photos only when there are two or more and no 3D model: a model is the richer view, and
 * its own drag-to-turn would fight a horizontal pager.
 */
export function showsGallery(media?: Media | null): boolean {
  return !media?.model3d && realPhotos(media).length > 1;
}

/** Who took it, under what licence, and where it came from, as the slideshow credits it. */
export function photoCredit(img: MediaImage): string {
  return [img.credit, img.license, img.source].filter(Boolean).join(" · ");
}

/** Width over height when the photo's size is known. */
export function aspectOf(img: Pick<MediaImage, "width" | "height">): number | undefined {
  return img.width && img.height ? img.width / img.height : undefined;
}

/** The largest rectangle of `aspect` that fits in `area`, centred: where a contained photo actually lands. */
export function containRect(aspect: number | undefined, area: Rect): Rect {
  if (!aspect || !(aspect > 0) || area.width <= 0 || area.height <= 0) return area;
  const width = Math.min(area.width, area.height * aspect);
  const height = width / aspect;
  return { x: area.x + (area.width - width) / 2, y: area.y + (area.height - height) / 2, width, height };
}

/** `rect` with its bottom `inset` points cut off; the whole rect when that would leave nothing. */
export function trimBottom(rect: Rect, inset: number): Rect {
  const height = rect.height - inset;
  return height > 0 ? { ...rect, height } : rect;
}

/** The page a horizontal pager rests nearest to. */
export function pageAt(offset: number, pageWidth: number, count: number): number {
  if (pageWidth <= 0 || count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(offset / pageWidth)));
}
