/**
 * A safe link to an existing Commons file-description page, not proof of an image's provenance or licence.
 * Keep the original URL: the producer/archive owns the association, and consumers must never guess a file title.
 */
export function safeCommonsSourcePage(image: { source?: unknown; sourcePage?: unknown } | null | undefined): string | undefined {
  if (!image || typeof image.source !== "string" || typeof image.sourcePage !== "string") return undefined;
  const source = image.source.trim().toLowerCase();
  if (source !== "commons" && source !== "commons.wikimedia.org") return undefined;
  const page = image.sourcePage;
  if (page.length > 2048 || /[\s\\?#]/.test(page) || !/^https:\/\/commons\.wikimedia\.org(?::443)?\/wiki\//i.test(page)) return undefined;
  try {
    const url = new URL(page);
    if (url.protocol !== "https:" || url.hostname !== "commons.wikimedia.org" || url.port || url.username || url.password) return undefined;
    const path = decodeURIComponent(url.pathname);
    if (!path.startsWith("/wiki/File:") || !path.slice("/wiki/File:".length).trim() || /[\u0000-\u001f\u007f\\]/.test(path)) return undefined;
    return page;
  } catch {
    return undefined;
  }
}
