import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../lib/auth";
import { REMOTE_DEBOUNCE_MS, localSearch, mergeResults, normalize, wantsRemote, type Searchable } from "../../lib/search";
import type { Wish } from "../../lib/wishes";

export interface WishSearch {
  /** Matching wish ids, best first. Empty when there is no query. */
  ids: string[];
  /** True while the search by meaning is on its way (including its short wait for typing to pause). */
  working: boolean;
}

const toSearchable = (w: Wish): Searchable => ({ id: w.id, name: w.name, kind: w.kind, about: w.details.about, tags: w.details.tags });

/**
 * Search for the Details page. Local matches (lib/search) show on every keystroke; when they are weak, the API ranks
 * the wishes by meaning (POST /wishes/search) once typing pauses, and its answer merges in. Answers are kept per
 * query until the wishes change, so going back over a word costs nothing. If the API can't help (offline, not set
 * up, today's allowance used), the local matches stand on their own.
 */
export function useWishSearch(wishes: Wish[], query: string): WishSearch {
  const { api } = useAuth();
  const q = normalize(query);
  const items = useMemo(() => wishes.map(toSearchable), [wishes]);
  const local = useMemo(() => (q ? localSearch(items, query) : []), [items, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const remoteWanted = !!q && wantsRemote(query, local);
  const [remote, setRemote] = useState<{ q: string; ids: string[] } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const cache = useRef(new Map<string, string[]>());

  // A new or changed wish can change any answer: forget the kept ones (the one on screen stays until the query moves).
  const shape = useMemo(() => wishes.map((w) => `${w.id}:${w.name}:${w.details.about ?? ""}`).join("|"), [wishes]);
  useEffect(() => cache.current.clear(), [shape]);

  useEffect(() => {
    if (!remoteWanted) {
      setPending(null);
      return;
    }
    const known = cache.current.get(q);
    if (known) {
      setRemote({ q, ids: known });
      setPending(null);
      return;
    }
    setPending(q);
    let live = true;
    const timer = setTimeout(async () => {
      const res = await api("/wishes/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: query.trim().slice(0, 200) }) }).catch(() => null);
      const body = res?.ok ? ((await res.json().catch(() => null)) as { ids?: unknown } | null) : null;
      const list: unknown = body?.ids;
      const ids = Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : null;
      if (ids) cache.current.set(q, ids);
      if (!live) return;
      setRemote({ q, ids: ids ?? [] });
      setPending(null);
    }, REMOTE_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // Only the query starts a search: a wish removed or described meanwhile doesn't buy another one.
  }, [q, remoteWanted, api]); // eslint-disable-line react-hooks/exhaustive-deps

  const ids = useMemo(() => {
    if (!q) return [];
    const known = new Set(wishes.map((w) => w.id));
    return mergeResults(local, remote?.q === q ? remote.ids : null, known);
  }, [q, local, remote, wishes]);

  return { ids, working: remoteWanted && pending === q };
}
