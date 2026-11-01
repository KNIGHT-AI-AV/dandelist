import { useEffect, useRef, useState } from "react";

/** A photograph that fails to load is asked for again after each of these waits, then left to its stand-in. */
export const PHOTO_RETRY_MS = [2_000, 10_000] as const;

/**
 * Whether to show a photograph, and which try of it (owner's screenshots, 2026-11-01: his Audi R8 had no photo on the
 * list while its own page showed the same one). A failed load belongs to its address, so a new address starts over at
 * once, and a failed address is tried again twice: one dropped connection used to leave a card on its stand-in for the
 * rest of the session. `tries` keys the image, so each try is a new request. A failure counts only for the address
 * still shown and the try still running (review R55-PHOTO-RETRY-OWNER): a late one from an earlier address or an
 * earlier try changes nothing, so it can neither cut a wait short nor buy extra tries.
 */
export function usePhotoLoad(uri: string | null | undefined): { show: boolean; tries: number; onError(): void } {
  const [load, setLoad] = useState<{ uri: string; tries: number; failed: boolean } | null>(null);
  const shown = useRef(uri);
  shown.current = uri;
  const now = !uri ? null : load?.uri === uri ? load : { uri, tries: 0, failed: false };
  const wait = now?.failed && now.tries < PHOTO_RETRY_MS.length ? PHOTO_RETRY_MS[now.tries] : null;
  const tries = now?.tries ?? 0;
  useEffect(() => {
    if (!uri || wait == null) return;
    const again = setTimeout(() => setLoad((at) => (at?.uri === uri && at.failed && at.tries === tries ? { uri, tries: tries + 1, failed: false } : at)), wait);
    return () => clearTimeout(again);
  }, [uri, wait, tries]);
  return {
    show: !!now && !now.failed,
    tries,
    onError: () => {
      if (!now || shown.current !== now.uri) return;
      const { uri: failed, tries: attempt } = now;
      setLoad((at) => {
        const live = at?.uri === failed ? at : { uri: failed, tries: 0, failed: false };
        return live.tries === attempt && !live.failed ? { uri: failed, tries: attempt, failed: true } : at;
      });
    },
  };
}
