import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../lib/auth";
import { useWishes, type WishDetails } from "../../lib/wishes";

/** Wishes sent per call (the API's limit). */
const BATCH = 20;
/** Waits this long after the wishes change, so a burst of new wishes goes in one call. */
const SETTLE_MS = 1200;

/**
 * Gives every wish a one-sentence description in the background, so search on the Details page understands meaning.
 * Wishes without `details.about` go to POST /wishes/describe in batches; what comes back is folded into the wishes
 * on screen (no reload). Each wish is tried once a session, and a server that can't describe (not set up, or today's
 * allowance used) is left alone for the rest of the session. Nothing here is ever shown or announced.
 */
export function useDescriptions() {
  const { api, status: auth } = useAuth();
  const { wishes, status, mergeDetails } = useWishes();
  const tried = useRef(new Set<string>());
  const off = useRef(false);
  const busy = useRef(false);
  const [round, setRound] = useState(0);
  // The store changes identity with every edit; the call only needs whichever is current when it lands.
  const merge = useRef(mergeDetails);
  merge.current = mergeDetails;
  const waiting = useMemo(() => wishes.filter((w) => !w.details.about && !tried.current.has(w.id)).map((w) => w.id), [wishes, round]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = waiting.join(",");

  useEffect(() => {
    if (auth !== "signedIn" || status !== "ready" || off.current || busy.current || !waiting.length) return;
    const ids = waiting.slice(0, BATCH);
    const timer = setTimeout(async () => {
      busy.current = true;
      for (const id of ids) tried.current.add(id);
      try {
        const res = await api("/wishes/describe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => null);
        if (res && (res.status === 503 || res.status === 429)) off.current = true;
        if (!res?.ok) return;
        const body = (await res.json().catch(() => null)) as { wishes?: { id: string; details?: WishDetails }[] } | null;
        for (const w of body?.wishes ?? []) {
          if (w.details?.about) merge.current(w.id, { about: w.details.about, tags: w.details.tags ?? [] });
        }
      } finally {
        busy.current = false;
        setRound((n) => n + 1);
      }
    }, SETTLE_MS);
    return () => clearTimeout(timer);
    // A round that ends re-checks, in case wishes arrived while a call was out.
  }, [key, auth, status, round, api]); // eslint-disable-line react-hooks/exhaustive-deps
}
