import { useEffect, useState } from "react";

/** A photograph that fails to load is asked for again after each of these waits, then left to its stand-in. */
export const PHOTO_RETRY_MS = [2_000, 10_000] as const;

/**
 * Whether to show a photograph, and which try of it (owner's screenshots, 2026-11-01: his Audi R8 had no photo on the
 * list while its own page showed the same one). A failed load belongs to its address, so a new address starts over at
 * once, and a failed address is tried again twice: one dropped connection used to leave a card on its stand-in for the
 * rest of the session. `tries` keys the image, so each try is a new request.
 */
export function usePhotoLoad(uri: string | null | undefined): { show: boolean; tries: number; onError(): void } {
  const [load, setLoad] = useState<{ uri: string; tries: number; failed: boolean } | null>(null);
  const now = !uri ? null : load?.uri === uri ? load : { uri, tries: 0, failed: false };
  const wait = now?.failed && now.tries < PHOTO_RETRY_MS.length ? PHOTO_RETRY_MS[now.tries] : null;
  useEffect(() => {
    if (!uri || wait == null) return;
    const tries = load?.tries ?? 0;
    const again = setTimeout(() => setLoad({ uri, tries: tries + 1, failed: false }), wait);
    return () => clearTimeout(again);
  }, [uri, wait, load?.tries]);
  return {
    show: !!now && !now.failed,
    tries: now?.tries ?? 0,
    onError: () => {
      if (now) setLoad({ uri: now.uri, tries: now.tries, failed: true });
    },
  };
}
