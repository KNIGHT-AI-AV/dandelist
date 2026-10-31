import { useEffect, useMemo, useSyncExternalStore } from "react";
import { endTask, startTask, updateTask } from "./activity";
import { getRun, interpretWish, startResearch, type PriceOption, type Run } from "./agent";
import { bindToSignIn, currentSignIn, useAuth } from "./auth";
import { POLL_MS, amendPatch, newPricePatch, pickOption, stepLine } from "./recheck";
import type { Wish } from "./wishes";

type Api = (path: string, init?: RequestInit) => Promise<Response>;

/**
 * "Check the price again" from the list (owner, recording 03), running in the background while the list stays in
 * use. Its progress shows as one of the Dandy's live tasks; the outcome waits in the Dandy area: an unchanged price
 * is saved as checked today on its own, a changed one asks before replacing the saved price.
 *
 * Every check belongs to the sign-in that started it (review of #131): signing out, or in as someone else, clears them
 * and their task lines, and a check still running from before stops before its next request, write or line on screen.
 * From the first render after the change, the screen shows only the account signed in now. Signing out and back in as
 * the same person counts as a new sign-in. Taking or leaving a result answers that attempt only, so a newer one started
 * meanwhile is never cleared by an older answer. One save of a wish runs at a time, and no look at it starts meanwhile.
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
  /** The sign-in it belongs to (setRecheckOwner): the account, a colon, then that sign-in's own key. */
  owner: string;
  /** This look's own id: answers to it touch nothing newer. */
  attempt: string;
  /** Its result is being saved: no second answer until that's done. */
  saving?: boolean;
}

let checks: readonly Recheck[] = [];
let owner: string | null = null;
/** The task lines of looks still running: they go with their sign-in, not when the work next notices. */
const lookTasks = new Set<string>();
/**
 * Wishes being saved, kept apart from the looks on screen (review of #131): a newer look taking an older one's place
 * can't free a wish the older one is still saving.
 */
const held = new Set<string>();
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
/** The account a sign-in key belongs to. */
const accountOf = (key: string) => key.slice(0, key.lastIndexOf(":"));

/** Sets whose checks these are: the signed-in person and this sign-in, or null when nobody is signed in. */
export function setRecheckOwner(next: string | null): void {
  if (next === owner) return;
  owner = next;
  // A request of the old sign-in's can hang for a long time: its lines go now.
  for (const task of lookTasks) endTask(task);
  lookTasks.clear();
  set([]);
}

/** The account signed in now, or null. */
export function useAccount(): string | null {
  const { status, user } = useAuth();
  return status === "signedIn" ? (user?.id ?? null) : null;
}

/** Keeps the checks to the person signed in now; mounted once, high in the app (lib/wishes.tsx's provider). */
export function useRecheckOwner(): void {
  const id = useAccount();
  useEffect(() => {
    // A fresh key on every sign-in, so signing out and back in as the same person starts afresh too.
    setRecheckOwner(id ? `${id}:${newAttempt()}` : null);
  }, [id]);
}

/** Clears an outcome once it has been read or answered: the look `attempt` names, or whatever is there. */
export function dismissRecheck(wishId: string, attempt?: string): void {
  if (held.has(wishId)) return;
  const gone = (c: Recheck) => c.wishId === wishId && (!attempt || c.attempt === attempt);
  if (checks.some(gone)) set(checks.filter((c) => !gone(c)));
}

/**
 * Runs `write` as the one save of `wishId` in flight, or returns false without running it while another save holds the
 * wish. Every save of a wish goes through here (this file's and the detail page's own price check), so saves to one
 * wish never overlap and a look always starts from the wish as last saved.
 */
export async function holdWish(wishId: string, write: () => Promise<void>): Promise<boolean> {
  if (held.has(wishId)) return false;
  held.add(wishId);
  try {
    await write();
    return true;
  } finally {
    held.delete(wishId);
  }
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
 * or result: it throws once the person signed out or in as someone else, or the look was answered or replaced. Its
 * requests go through `api` bound to the sign-in it started under (review of #131), so none is sent with another
 * account's bearer even before the screen has caught up with the change.
 */
async function look(wish: Wish, said: string | undefined, label: string, api: Api, work: (live: () => void, task: string, keep: (outcome: Outcome) => void, api: Api) => Promise<void>, failure: string): Promise<void> {
  const mine = owner;
  if (!mine || held.has(wish.id) || checks.some((c) => c.wishId === wish.id && c.outcome.kind === "running")) return;
  const attempt = newAttempt();
  const at = currentSignIn();
  const bound = bindToSignIn(api, at);
  const base = { wishId: wish.id, name: wish.name, owner: mine, attempt, ...(said ? { said } : {}) };
  const live = () => {
    if (owner !== mine || currentSignIn() !== at || !checks.some((c) => c.wishId === wish.id && c.attempt === attempt)) throw new Superseded();
  };
  const keep = (outcome: Outcome) => {
    live();
    put({ ...base, outcome, at: Date.now() });
  };
  put({ ...base, outcome: { kind: "running" }, at: Date.now() });
  const task = startTask(label, accountOf(mine));
  lookTasks.add(task);
  try {
    await work(live, task, keep, bound);
  } catch (e) {
    if (owner === mine && currentSignIn() === at && checks.some((c) => c.wishId === wish.id && c.attempt === attempt)) {
      // Still on screen: a failure says so; a look that gave way to another save of the wish just goes.
      if (e instanceof Superseded) set(checks.filter((c) => c.attempt !== attempt));
      else put({ ...base, outcome: { kind: "failed", message: (e as Error).message || failure }, at: Date.now() });
    }
  } finally {
    lookTasks.delete(task);
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
    api,
    async (live, task, keep, api) => {
      const { draft } = await interpretWish(api, wish.name);
      live();
      const run = await follow(api, await startResearch(api, draft, []), live, task);
      if (run.status === "error") throw new Error(run.error ?? "The check stopped.");
      const option = run.result ? pickOption(run.result.options, wish.details.agent?.url) : undefined;
      if (!option) throw new Error(`Couldn't find a price to stand behind for ${short(wish.name)}.`);
      if (option.upfrontCents === wish.item.upfrontCents) {
        // The same price: saved as checked today without asking, unless another save of the wish is under way.
        live();
        const saved = await holdWish(wish.id, async () => {
          await patch(api, wish, run, option);
          live();
          await reload();
        });
        if (!saved) throw new Superseded();
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
    api,
    async (live, task, keep, api) => {
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
 * Saves the result `attempt` names, once, as the one save of the wish: the look is marked saving so neither answer can
 * be pressed again meanwhile, and the wish stays held until the list has the saved wish, so a look started after this
 * starts from it. When the save lands only that look is cleared.
 */
async function adopt(api: Api, wish: Wish, attempt: string | undefined, kind: "amended" | "changed", save: (r: Recheck, api: Api) => Promise<void>, reload: () => Promise<void>): Promise<void> {
  const mine = owner;
  const r = checks.find((c) => c.wishId === wish.id && (!attempt || c.attempt === attempt));
  if (!mine || !r || r.owner !== mine || r.outcome.kind !== kind || r.saving) return;
  // The save goes as the sign-in that pressed Use, or not at all.
  const bound = bindToSignIn(api, currentSignIn());
  await holdWish(wish.id, async () => {
    put({ ...r, saving: true });
    try {
      await save(r, bound);
    } catch (e) {
      if (owner === mine && checks.some((c) => c.attempt === r.attempt)) put({ ...r, saving: false });
      throw e;
    }
    if (owner !== mine) return;
    try {
      await reload();
    } finally {
      if (checks.some((c) => c.attempt === r.attempt)) set(checks.filter((c) => c.attempt !== r.attempt));
    }
  });
}

/** Takes what the person meant in place of the saved find: its name, price, seller and pictures. */
export async function adoptAmend(api: Api, wish: Wish, reload: () => Promise<void>, attempt?: string): Promise<void> {
  await adopt(
    api,
    wish,
    attempt,
    "amended",
    async (r, api) => {
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
    async (r, api) => {
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

/** The looks of the account signed in now: never another account's, from the first render after a sign-in change. */
export function useRechecks(): readonly Recheck[] {
  const account = useAccount();
  const all = useSyncExternalStore(subscribe, () => checks, () => checks);
  return useMemo(() => all.filter((c) => accountOf(c.owner) === account), [all, account]);
}
