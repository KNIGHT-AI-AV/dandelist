import { safeAuthor, safeCommonsSourcePage } from "@dandelist/catalogue";

/** The photo fields needed by a caption; saved media is validated again before it becomes a link. */
export interface CreditedImage {
  credit?: string;
  license?: string;
  source?: string;
  sourcePage?: string;
  generated?: boolean;
  author?: unknown;
}

export type PhotoCreditContent =
  | { kind: "unsplash"; author: { name: string; url: string } }
  | { kind: "commons"; text: string; url: string }
  | { kind: "plain"; text: string };

/** Prefer the displayed photo's attribution; a card-level credit is only a fallback for missing photo metadata. */
export function photoCreditContent(image?: CreditedImage | null, fallback?: string): PhotoCreditContent | undefined {
  if (image?.generated) return undefined;
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
