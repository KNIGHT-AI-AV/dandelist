import { getSecret, setSecret } from "./storage";
import type { WishKind } from "./wishes";

/**
 * Today's pick (owner, 2026-10-29): one real suggestion a day from the Dandy, made by the API when the list opens
 * (apps/api/src/picks.ts). The app sends the date on this phone; the card offers "Add to my list" and "Not for me",
 * and its close button hides it until tomorrow on this device.
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

/** The day the card was last closed on this device, if any. */
export async function hiddenDay(): Promise<string | null> {
  try {
    return await getSecret(HIDDEN_KEY);
  } catch {
    return null;
  }
}

/** Hides the card until tomorrow on this device. */
export async function hideForDay(day: string): Promise<void> {
  try {
    await setSecret(HIDDEN_KEY, day);
  } catch {}
}
