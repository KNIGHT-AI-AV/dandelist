import { useEffect, useSyncExternalStore } from "react";
import { endTask, startTask, updateTask } from "./activity";
import { getRun, interpretWish, startResearch, type PriceOption, type Run } from "./agent";
import { useAuth } from "./auth";
import { POLL_MS, amendPatch, newPricePatch, pickOption, stepLine } from "./recheck";
import type { Wish } from "./wishes";

type Api = (path: string, init?: RequestInit) => Promise<Response>;

/**
 * "Check the price again" from the list (owner, recording 03), running in the background while the list stays in
 * use. Its progress shows as one of the Dandy's live tasks; the outcome waits in the Dandy area: an unchanged price
 * is saved as checked today on its own, a changed one asks before replacing the saved price.
 *
 * Every check belongs to the sign-in that started it (review of #131): signing out, or in as someone else, clears them,
 * and a check still running from before stops before its next request, write or line on screen. Signing out and back in
 * as the same person counts as a new sign-in. Taking or leaving a result answers that attempt only, so a newer one
 * started meanwhile is never cleared by an older answer, and only one answer saves at a time.
 */
export type Outcome =
  | { kind: "running" }
  | { kind: "changed"; option: PriceOption; run: Run; was: number }
  | { kind: "same"; option: PriceOption }
  /** The person said what they meant; this is what that is, to take in place of the saved find or not. */
  | { kind: "amended"; option: PriceOption; run: Run; name: string }
  | { kind: "failed"; message: string };

export interface Recheck {
  wishId: string;
  name: string;
  outcome: Outcome;
  at: number;
  /** What the person told the Dandy, when this look started from their words. */
  said?: string;
  /** The sign-in it belongs to (setRecheckOwner). */
  owner: string;
  /** This look's own id: answers to it touch nothing newer. */
  attempt: string;
  /** Its result is being saved: no second answer until that's done. */
  saving?: boolean;
}

let checks: readonly Recheck[] = [];
let owner: string | null = null;
const listeners = new Set<() => void>();
const set = (next: readonly Recheck[]) => {
  checks = next;
  listeners.forEach((l) => l());
};
/** Shows `r` in place of any earlier look at the same wish, if it belongs to this sign-in. */
const put = (r: Recheck) => {
  if (r.owner === owner) set([...checks.filter((c) => c.wishId !== r.wishId), r]);
};
const newAttempt = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Sets whose checks these are: the signed-in person and this sign-in, or null when nobody is signed in. */
export function setRecheckOwner(next: string | null): void {
  if (next === owner) return;
  owner = next;
  set([]);
}

/** Keeps the checks to the person signed in now; mounted once, high in the app (lib/wishes.tsx's provider). */
export function useRecheckOwner(): void {
  const { status, user } = useAuth();
  const id = status === "signedIn" ? (user?.id ?? null) : null;
  useEffect(() => {
    // A fresh key on every sign-in, so signing out and back in as the same person starts afresh too.
    setRecheckOwner(id ? `${id}:${newAttempt()}` : null);
  }, [id]);
}

/** Clears an outcome once it has been read or answered: the look `attempt` names, or whatever is there. */
export function dismissRecheck(wishId: string, attempt?: string): void {
  const gone = (c: Recheck) => c.wishId === wishId && (!attempt || c.attempt === attempt) && !c.saving;
  if (checks.some(gone)) set(checks.filter((c) => !gone(c)));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Names in task lines stay short: "the Leica Q3", not a 60-character listing title. */
const short = (name: string) => (name.length > 32 ? `${name.slice(0, 30).trimEnd()}...` : name);

async function patch(api: Api, wish: Wish, run: Pick<Run, "id" | "result">, option: PriceOption) {
  const res = await api(`/wishes/${wish.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newPricePatch(wish, run, option)) }).catch(() => null);
  if (!res?.ok) throw new Error(((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't save the new price.");
}

/** Thrown when the look's sign-in or attempt has moved on: it stops quietly. */
class Superseded extends Error {}

/**
 * Starts a look at `wish` for this sign-in and runs `work`, which calls `live()` before every follow-on request, write
 * or result: it throws once the person signed out or in as someone else, or the look was answered or replaced.
 */
async function look(wish: Wish, said: string | undefined, label: string, work: (live: () => void, task: string, keep: (outcome: Outcome) => void) => Promise<void>, failure: string): Promise<void> {
  const mine = owner;
  if (!mine || checks.some((c) => c.wishId === wish.id && c.outcome.kind === "running")) return;
  const attempt = newAttempt();
  const base = { wishId: wish.id, name: wish.name, owner: mine, attempt, ...(said ? { said } : {}) };
  const live = () => {
    if (owner !== mine || !checks.some((c) => c.wishId === wish.id && c.attempt === attempt)) throw new Superseded();
  };
  const keep = (outcome: Outcome) => {
    live();
    put({ ...base, outcome, at: Date.now() });
  };
  put({ ...base, outcome: { kind: "running" }, at: Date.now() });
  const task = startTask(label);
  try {
    await work(live, task, keep);
  } catch (e) {
    if (!(e instanceof Superseded) && owner === mine && checks.some((c) => c.wishId === wish.id && c.attempt === attempt)) {
      put({ ...base, outcome: { kind: "failed", message: (e as Error).message || failure }, at: Date.now() });
    }
  } finally {
    endTask(task);
  }
}

/** Follows a research run to its end, showing its newest step on the task. */
async function follow(api: Api, run: Run, live: () => void, task: string): Promise<Run> {
  while (run.status === "running") {
    await sleep(POLL_MS);
    live();
    run = await getRun(api, run.id);
    live();
    const last = run.steps[run.steps.length - 1];
    if (last) {
      const line = stepLine(last);
      updateTask(task, `${line.verb ? `${line.verb} ` : ""}${line.detail}`.trim());
    }
  }
  return run;
}

/** Starts a check for `wish` unless one is already running for it. */
export async function recheckWish(api: Api, wish: Wish, reload: () => Promise<void>): Promise<void> {
  await look(
    wish,
    undefined,
    `Checking the price of ${short(wish.name)}`,
    async (live, task, keep) => {
      const { draft } = await interpretWish(api, wish.name);
      live();
      const run = await follow(api, await startResearch(api, draft, []), live, task);
      if (run.status === "error") throw new Error(run.error ?? "The check stopped.");
      const option = run.result ? pickOption(run.result.options, wish.details.agent?.url) : undefined;
      if (!option) throw new Error(`Couldn't find a price to stand behind for ${short(wish.name)}.`);
      if (option.upfrontCents === wish.item.upfrontCents) {
        // The same price: saved as checked today without asking.
        live();
        await patch(api, wish, run, option);
        live();
        await reload();
        keep({ kind: "same", option });
      } else keep({ kind: "changed", option, run, was: wish.item.upfrontCents });
    },
    "Couldn't check the price just now.",
  );
}

/**
 * A saved wish the person tells the Dandy more about (owner, 2026-10-31: "clicking item that you already added and
 * amend it someway by adding more context of what you wanted instead"): the wish is read again with their words and
 * hunted afresh in the background; what it finds waits in the Dandy area to take or leave, like a changed price.
 */
export async function amendWish(api: Api, wish: Wish, said: string): Promise<void> {
  const words = said.trim();
  if (!words) return;
  await look(
    wish,
    words,
    `Looking again at ${short(wish.name)}`,
    async (live, task, keep) => {
      const { draft } = await interpretWish(api, `${wish.name}. ${words}`);
      live();
      const run = await follow(api, await startResearch(api, draft, []), live, task);
      if (run.status === "error") throw new Error(run.error ?? "The search stopped.");
      // What they meant may well be another seller's, so no preference for the one the wish was saved from.
      const option = run.result ? pickOption(run.result.options) : undefined;
      if (!option) throw new Error(`Couldn't find a price to stand behind for that.`);
      keep({ kind: "amended", option, run, name: draft.title || option.label });
    },
    "Couldn't look again just now.",
  );
}

/**
 * Saves the result `attempt` names, once: the look is marked saving so neither answer can be pressed again meanwhile,
 * and when the save lands only that look is cleared.
 */
async function adopt(api: Api, wish: Wish, attempt: string | undefined, kind: "amended" | "changed", save: (r: Recheck) => Promise<void>, reload: () => Promise<void>): Promise<void> {
  const mine = owner;
  const r = checks.find((c) => c.wishId === wish.id && (!attempt || c.attempt === attempt));
  if (!mine || !r || r.owner !== mine || r.outcome.kind !== kind || r.saving) return;
  put({ ...r, saving: true });
  try {
    await save(r);
  } catch (e) {
    if (owner === mine && checks.some((c) => c.attempt === r.attempt)) put({ ...r, saving: false });
    throw e;
  }
  if (owner !== mine) return;
  await reload();
  if (checks.some((c) => c.attempt === r.attempt)) set(checks.filter((c) => c.attempt !== r.attempt));
}

/** Takes what the person meant in place of the saved find: its name, price, seller and pictures. */
export async function adoptAmend(api: Api, wish: Wish, reload: () => Promise<void>, attempt?: string): Promise<void> {
  await adopt(
    api,
    wish,
    attempt,
    "amended",
    async (r) => {
      if (r.outcome.kind !== "amended") return;
      const body = amendPatch(wish, r.outcome.run, r.outcome.option, r.outcome.name);
      const res = await api(`/wishes/${wish.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
      if (!res?.ok) throw new Error(((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't save it.");
    },
    reload,
  );
}

/** Saves the new price a check found. */
export async function adoptRecheck(api: Api, wish: Wish, reload: () => Promise<void>, attempt?: string): Promise<void> {
  await adopt(
    api,
    wish,
    attempt,
    "changed",
    async (r) => {
      if (r.outcome.kind === "changed") await patch(api, wish, r.outcome.run, r.outcome.option);
    },
    reload,
  );
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** The looks as they stand, outside React (tests, event handlers). */
export const currentRechecks = (): readonly Recheck[] => checks;

export function useRechecks(): readonly Recheck[] {
  return useSyncExternalStore(subscribe, () => checks, () => checks);
}
