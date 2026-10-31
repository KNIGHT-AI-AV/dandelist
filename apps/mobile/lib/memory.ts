import { useCallback, useEffect, useRef, useState } from "react";
import { bindToSignIn, currentSignIn, useAuth } from "./auth";
import type { Api } from "./profile";

/** One line the Dandy remembers about the person between conversations (api memory.ts). */
export interface Memory {
  id: string;
  text: string;
  createdAt: string;
}

const FAILED = "Couldn't do that just now. Try again.";

async function read(res: Response | null): Promise<Memory[]> {
  if (!res?.ok) throw new Error(FAILED);
  const body = (await res.json().catch(() => null)) as { memories?: Memory[] } | null;
  if (!Array.isArray(body?.memories)) throw new Error(FAILED);
  return body.memories;
}

/** What the Dandy remembers, newest first. */
export const fetchMemories = async (api: Api) => read(await api("/me/memories").catch(() => null));
/** Removes one line; answers with what is left. */
export const forgetMemory = async (api: Api, id: string) => read(await api(`/me/memories/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null));
/** Removes every line. */
export const forgetAllMemories = async (api: Api) => read(await api("/me/memories", { method: "DELETE" }).catch(() => null));

interface View {
  /** The account and sign-in (auth.tsx currentSignIn) the lines, busy and error belong to. */
  account: string | null;
  at: number;
  memories: Memory[];
  /** The line being forgotten, or "all". */
  busy: string | null;
  error: string | null;
}
const empty = (account: string | null, at: number): View => ({ account, at, memories: [], busy: null, error: null });

/**
 * The memory list in Settings, owned by one sign-in (review of #147): another account's lines never show, from the first
 * render after a change; its requests go as the sign-in that loaded the list, so a Forget waiting on a refresh is never
 * sent as whoever signed in since; and an answer for an earlier sign-in changes nothing on screen. Loaded while `active`.
 */
export function useMemories(active: boolean): Omit<View, "account" | "at"> & { forget(id: string | null): Promise<boolean> } {
  const { status, user, api } = useAuth();
  const account = status === "signedIn" ? (user?.id ?? null) : null;
  const [view, setView] = useState<View>(() => empty(null, -1));
  const owner = useRef<{ account: string; at: number } | null>(null);

  useEffect(() => {
    if (!active || !account) return;
    const me = { account, at: currentSignIn() };
    owner.current = me;
    setView((v) => (v.account === me.account && v.at === me.at ? v : empty(me.account, me.at)));
    fetchMemories(bindToSignIn(api, me.at))
      .then((memories) => owner.current === me && setView((v) => (v.at === me.at ? { ...v, memories } : v)))
      .catch(() => {});
  }, [active, account, api]);

  // Nothing answers into a list that is gone (review of #147, nonblocking): no success after Settings unmounts.
  useEffect(
    () => () => {
      owner.current = null;
    },
    [],
  );

  const forget = useCallback(
    async (id: string | null) => {
      const me = owner.current;
      if (!me || me.account !== account) return false;
      setView((v) => (v.at === me.at ? { ...v, busy: id ?? "all", error: null } : v));
      try {
        const send = bindToSignIn(api, me.at);
        const left = id ? await forgetMemory(send, id) : await forgetAllMemories(send);
        if (owner.current !== me) return false;
        setView((v) => (v.at === me.at ? { ...v, memories: left, busy: null } : v));
        return true;
      } catch {
        if (owner.current === me) setView((v) => (v.at === me.at ? { ...v, busy: null, error: FAILED } : v));
        return false;
      }
    },
    [api, account],
  );

  // Another account's view is never shown, even for the one render before the effect above resets it.
  const mine = view.account === account ? view : empty(account, -1);
  return { memories: mine.memories, busy: mine.busy, error: mine.error, forget };
}
