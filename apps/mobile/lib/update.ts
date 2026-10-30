import type { Updater } from "./update-core";

export * from "./update-core";

/** sessionStorage key: the reload this tab already tried. */
const TRIED = "dandelist.update.tried";

/** The parts of the page the web's updater touches, so tests can stand in for them. */
export interface Page {
  sessionStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  location?: { reload(): void };
}

/**
 * The web's updater: the bundle's own version against web.version in latest.json on the same origin, and a reload to
 * update. Storage can refuse (private browsing); then a reload may simply be offered again.
 */
export function webUpdater(version: string | undefined, page: Page): Updater {
  const v = version?.trim();
  return {
    running: v ? { platform: "web", version: v } : null,
    source: "/latest.json",
    tried() {
      try {
        return page.sessionStorage?.getItem(TRIED) ?? null;
      } catch {
        return null;
      }
    },
    go(offer) {
      try {
        page.sessionStorage?.setItem(TRIED, offer.target);
      } catch {
        // Storage refused; the reload still happens.
      }
      page.location?.reload();
    },
  };
}

/** scripts/deploy-web.mjs sets EXPO_PUBLIC_WEB_VERSION at export. The dev server leaves it unset, so dev never asks. */
export const updater: Updater = webUpdater(process.env.EXPO_PUBLIC_WEB_VERSION, globalThis as unknown as Page);
