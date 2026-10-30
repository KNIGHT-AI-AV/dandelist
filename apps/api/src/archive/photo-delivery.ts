import { selectHeroPhotos } from "./photo-selection";

/**
 * Unsplash-labelled archive photos must stay on Unsplash's image CDN, including older approved rows.
 * This is only a delivery check: the host alone proves neither API provenance nor attribution/download events.
 * Commons and other sources retain their own admission rules; self-hosting is not forbidden for every provider.
 */
export function providerDeliveryAllowed(photo: { source: string; url: string }): boolean {
  const source = photo.source.trim().toLowerCase();
  if (source !== "unsplash" && source !== "unsplash.com") return true;
  if (/\s|\\/.test(photo.url)) return false;
  try {
    const url = new URL(photo.url);
    return url.protocol === "https:" && url.hostname === "images.unsplash.com" && !url.port && !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * Check the original hero selection before excluding undeliverable photos. Filtering must not resolve two heroes
 * by accident or promote a gallery photo when the designated hero is withheld. Stored approvals stay untouched.
 */
export function selectDeliverablePhotos<T extends { hero: boolean; source: string; url: string }>(photos: T[]): T[] | null {
  const selected = selectHeroPhotos(photos);
  if (!selected || !providerDeliveryAllowed(selected[0]!)) return null;
  return selected.filter(providerDeliveryAllowed);
}
