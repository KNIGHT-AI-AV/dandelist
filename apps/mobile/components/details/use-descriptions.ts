import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../lib/auth";
import { unjudged } from "../../lib/comfort";
import { useWishes, type Wish, type WishDetails } from "../../lib/wishes";

/** Wishes sent per call (the API's limit). */
const BATCH = 20;
/** Waits this long after the wishes change, so a burst of new wishes goes in one call. */
const SETTLE_MS = 1200;

/** A wish is tried once a session for each tier it has, since a new tier is judged afresh. */
const triedKey = (w: Wish) => `${w.id}:${w.tier}`;

/**
 * Gives every wish a one-sentence description in the background, so search on the Details page understands meaning,
 * and a judgment of what share of a year's income it may comfortably take (owner, 2026-10-30: "Every time the agent
 * adds a new item, it needs to revamp the money needed"). Wishes without `details.about`, or without a judgment for
 * their current tier, go to POST /wishes/describe in batches; what comes back is folded into the wishes on screen (no
 * reload), so the list's "Comfortable on" figure and the money page move as each judgment lands. Each wish is tried
 * once a session for each tier, and a server that can't describe (not set up, or today's allowance used) is left
 * alone for the rest of the session. Nothing here is announced.
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
  const waiting = useMemo(() => wishes.filter((w) => (!w.details.about || unjudged(w)) && !tried.current.has(triedKey(w))), [wishes, round]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = waiting.map(triedKey).join(",");

  useEffect(() => {
    if (auth !== "signedIn" || status !== "ready" || off.current || busy.current || !waiting.length) return;
    const batch = waiting.slice(0, BATCH);
    const timer = setTimeout(async () => {
      busy.current = true;
      for (const w of batch) tried.current.add(triedKey(w));
      try {
        const res = await api("/wishes/describe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: batch.map((w) => w.id) }) }).catch(() => null);
        if (res && (res.status === 503 || res.status === 429)) off.current = true;
        if (!res?.ok) return;
        const body = (await res.json().catch(() => null)) as { wishes?: { id: string; details?: WishDetails }[] } | null;
        for (const w of body?.wishes ?? []) {
          const d = w.details;
          const change: Partial<WishDetails> = { ...(d?.about ? { about: d.about, tags: d.tags ?? [] } : {}), ...(d?.comfort ? { comfort: d.comfort } : {}) };
          if (Object.keys(change).length) merge.current(w.id, change);
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
