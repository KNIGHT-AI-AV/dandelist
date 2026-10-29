import { useEffect, useSyncExternalStore } from "react";
import { useAuth } from "./auth";
import { loadDandy } from "./dandy";
import { cleanSuggestions } from "./dream";

/**
 * Three things to say to the Dandy, fresh for each new chat (owner, 2026-10-28): written by GET /dream/suggestions
 * from their wishes, their home, their recent chats and their Dandy's personality. One store for the whole app, so
 * the list page can show the same chips the chat does; `refresh()` asks for the next three (the chat calls it for
 * every new conversation). When the server can't be reached, the last good set stays, or a quiet default.
 */

type Api = (path: string, init?: RequestInit) => Promise<Response>;

export const DEFAULT_SUGGESTIONS = ["A villa by the sea with a pool", "A black G-Wagon", "A weekend in Positano in June"];

interface State {
  items: string[];
  loading: boolean;
  loaded: boolean;
}

const EMPTY: State = { items: [], loading: false, loaded: false };
let state: State = EMPTY;
let api: Api | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** The next three from the API, in the Dandy's personality. Throws when there aren't three to show. */
export async function fetchSuggestions(call: Api, persona?: string): Promise<string[]> {
  const res = await call(`/dream/suggestions${persona ? `?persona=${encodeURIComponent(persona)}` : ""}`);
  if (!res.ok) throw new Error("No suggestions");
  const items = cleanSuggestions(((await res.json()) as { suggestions?: unknown }).suggestions);
  if (items.length < 3) throw new Error("Too few suggestions");
  return items;
}

/** Asks for the next three. Safe to call any time; the newest request wins. */
export function refreshSuggestions(): void {
  const call = api;
  if (!call) return;
  const mine = ++seq;
  set({ loading: true });
  void (async () => {
    let items: string[];
    try {
      const dandy = await loadDandy();
      items = await fetchSuggestions(call, dandy.persona);
    } catch {
      items = state.items.length ? state.items : DEFAULT_SUGGESTIONS;
    }
    if (mine === seq) set({ items, loading: false, loaded: true });
  })();
}

/** The shared suggestions: loads once when someone is signed in, then whenever `refresh()` is called. */
export function useSuggestions(): { items: string[]; loading: boolean; refresh(): void } {
  const auth = useAuth();
  const s = useSyncExternalStore(subscribe, () => state, () => state);
  useEffect(() => {
    if (auth.status !== "signedIn") {
      // Signed out: the next person starts with their own.
      if (auth.status === "signedOut" && state !== EMPTY) {
        api = null;
        seq++;
        state = EMPTY;
        listeners.forEach((l) => l());
      }
      return;
    }
    api = auth.api;
    if (!state.loaded && !state.loading) refreshSuggestions();
  }, [auth.status, auth.api]);
  return { items: s.items, loading: s.loading, refresh: refreshSuggestions };
}
