import { useSyncExternalStore } from "react";
import { getSecret, setSecret } from "./storage";
import type { WishKind } from "./wishes";

/**
 * Today's pick (owner, 2026-10-29): one real suggestion a day from the Dandy, made by the API when the list opens
 * (apps/api/src/picks.ts). The app sends the date on this phone; the card offers "Add to my list" and "Not for me",
 * and its close button hides it until tomorrow on this device. Tapping the card opens the pick's own page with what
 * was made for it (owner, 2026-11-01: a person who liked a pick couldn't look at it without adding it).
 */

type Api = (path: string, init?: RequestInit) => Promise<Response>;

export interface PickPhoto {
  url: string;
  width?: number;
  height?: number;
  source: string;
  credit?: string;
  license?: string;
}

export interface TodayPick {
  id: string;
  day: string;
  status: "ready" | "added" | "skipped";
  title: string;
  kind: WishKind;
  why: string;
  summary: string;
  photo: PickPhoto | null;
  createdAt: string;
}

/** The date on this phone, YYYY-MM-DD. */
export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The day's pick, made now if there isn't one yet. `pending` while another request is making it. */
export async function fetchTodayPick(api: Api, day: string, persona?: string): Promise<{ pick: TodayPick | null; pending: boolean }> {
  const res = await api("/picks/today", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ day, ...(persona ? { persona } : {}) }) });
  if (!res.ok) return { pick: null, pending: false };
  const body = (await res.json()) as { pick?: TodayPick | null; pending?: boolean };
  return { pick: body.pick ?? null, pending: body.pending === true };
}

/** What the person did with the pick; the next one learns from it. */
export async function answerPick(api: Api, id: string, outcome: "added" | "skipped"): Promise<void> {
  const res = await api(`/picks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outcome }) });
  if (!res.ok) throw new Error("Couldn't save that. Try again.");
}

/** Shown on the list: ready, today's, and not closed today on this device. */
export const showsPick = (pick: TodayPick | null, day: string, hiddenDay: string | null): pick is TodayPick => !!pick && pick.status === "ready" && pick.day === day && hiddenDay !== day;

const HIDDEN_KEY = "dandelist.pick.hidden";
/** Per person, so one person closing the card never hides another's on a shared phone. */
const hiddenKey = (userId: string) => `${HIDDEN_KEY}.${userId}`;

/** The day this person last closed the card on this device, if any. */
export async function hiddenDay(userId: string): Promise<string | null> {
  try {
    return await getSecret(hiddenKey(userId));
  } catch {
    return null;
  }
}

/** Hides this person's card until tomorrow on this device. */
export async function hideForDay(userId: string, day: string): Promise<void> {
  try {
    await setSecret(hiddenKey(userId), day);
  } catch {}
}

/** The account and sign-in (lib/auth.tsx currentSignIn) a pick was asked for under. */
export interface PickOwner {
  account: string;
  at: number;
}
export const sameOwner = (a: PickOwner | null | undefined, b: PickOwner | null | undefined): boolean => !!a && !!b && a.account === b.account && a.at === b.at;

/**
 * Picks seen this run of the app, so the card and the pick's own page show the same one; each keeps the sign-in it was
 * asked for under (review R50-PICK-OWNER), and only that sign-in reads it back: another account on the same phone never
 * sees it, whatever route it opens.
 */
const known = new Map<string, { pick: TodayPick; owner: PickOwner }>();
export const rememberPick = (pick: TodayPick, owner: PickOwner) => void known.set(pick.id, { pick, owner });
export const knownPick = (id: string, owner: PickOwner | null): TodayPick | null => {
  const k = known.get(id);
  return k && sameOwner(k.owner, owner) ? k.pick : null;
};

// Answers given this session, from the card or the pick's page: whichever is showing learns of one at once.
let answered = 0;
const listeners = new Set<() => void>();
const changed = () => {
  answered++;
  listeners.forEach((l) => l());
};
export function subscribePickAnswers(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
/** Re-renders the caller when a pick is added or turned down anywhere this session. */
export const usePickAnswers = () => useSyncExternalStore(subscribePickAnswers, () => answered, () => answered);

/** Picks saved as wishes this session: "added" is recorded once the wish is saved, and the list hides them at once. */
const added = new Set<string>();
export const pickAdded = (id: string) => {
  added.add(id);
  changed();
};
export const wasPickAdded = (id: string) => added.has(id);

/** Picks turned down on their own page this session: the list's card goes too. */
const skipped = new Set<string>();
export const pickSkipped = (id: string) => {
  skipped.add(id);
  changed();
};
export const wasPickSkipped = (id: string) => skipped.has(id);
