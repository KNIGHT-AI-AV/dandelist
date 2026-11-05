import { safeAuthor, safeCommonsSourcePage } from "@dandelist/catalogue";

/** The photo fields needed by a caption; saved media is validated again before it becomes a link. */
export interface CreditedImage {
  credit?: string;
  license?: string;
  source?: string;
  sourcePage?: string;
  generated?: boolean;
  similar?: boolean;
  author?: unknown;
}

export type PhotoCreditContent = (
  | { kind: "unsplash"; author: { name: string; url: string } }
  | { kind: "commons"; text: string; url: string }
  | { kind: "plain"; text: string }
) & {
  /** Said before the credit: a stand-in photo is a similar one, not the wish itself. */
  lead?: string;
};

/** What the credit says first about a stand-in, the wish's broad form shown because the very thing was not found. */
export const SIMILAR = "A similar one";
/** The same, for a screen reader reading a whole card. */
export const SIMILAR_SPOKEN = "the photo shows a similar one";

/** Whether the photo a card shows (`shown`, its address) is a stand-in, by its own mark in the card's saved media. */
export function isSimilarPhoto(media: { images: { url: string; similar?: boolean }[] } | null | undefined, shown: string | null | undefined): boolean {
  return !!shown && !!media?.images.some((image) => image.url === shown && image.similar);
}

/** Prefer the displayed photo's attribution; a card-level credit is only a fallback for missing photo metadata. */
export function photoCreditContent(image?: CreditedImage | null, fallback?: string): PhotoCreditContent | undefined {
  if (image?.generated) return undefined;
  const content = attribution(image, fallback);
  if (!image?.similar) return content;
  return content ? { ...content, lead: SIMILAR } : { kind: "plain", text: SIMILAR };
}

function attribution(image?: CreditedImage | null, fallback?: string): PhotoCreditContent | undefined {
  const author = safeAuthor(image?.author);
  if (author) return { kind: "unsplash", author };
  const page = image && safeCommonsSourcePage(image);
  if (image && page) return { kind: "commons", text: [image.credit, image.license].filter(Boolean).join(" · "), url: page };
  const text = !image?.credit && !image?.license && fallback
    ? fallback
    : [image?.credit, image?.license, image?.source].filter(Boolean).join(" · ");
  return text ? { kind: "plain", text } : undefined;
}

/** A cutout's credit belongs to its recorded original, never whichever image happens to be first. */
export function cutoutSourceImage<T extends { url: string }>(images: T[], from?: string): T | undefined {
  return from ? images.find((image) => image.url === from) : undefined;
}
