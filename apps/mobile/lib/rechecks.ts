import { useSyncExternalStore } from "react";
import { endTask, startTask, updateTask } from "./activity";
import { getRun, interpretWish, startResearch, type PriceOption, type Run } from "./agent";
import { POLL_MS, amendPatch, newPricePatch, pickOption, stepLine } from "./recheck";
import type { Wish } from "./wishes";

type Api = (path: string, init?: RequestInit) => Promise<Response>;

/**
 * "Check the price again" from the list (owner, recording 03), running in the background while the list stays in
 * use. Its progress shows as one of the Dandy's live tasks; the outcome waits in the Dandy area: an unchanged price
 * is saved as checked today on its own, a changed one asks before replacing the saved price.
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
}

let checks: readonly Recheck[] = [];
const listeners = new Set<() => void>();
const set = (next: readonly Recheck[]) => {
  checks = next;
  listeners.forEach((l) => l());
};
const put = (r: Recheck) => set([...checks.filter((c) => c.wishId !== r.wishId), r]);

/** Clears an outcome once it has been read or answered. */
export function dismissRecheck(wishId: string): void {
  if (checks.some((c) => c.wishId === wishId)) set(checks.filter((c) => c.wishId !== wishId));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Names in task lines stay short: "the Leica Q3", not a 60-character listing title. */
const short = (name: string) => (name.length > 32 ? `${name.slice(0, 30).trimEnd()}...` : name);

async function patch(api: Api, wish: Wish, run: Pick<Run, "id" | "result">, option: PriceOption) {
  const res = await api(`/wishes/${wish.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newPricePatch(wish, run, option)) }).catch(() => null);
  if (!res?.ok) throw new Error(((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't save the new price.");
}

/** Starts a check for `wish` unless one is already running for it. */
export async function recheckWish(api: Api, wish: Wish, reload: () => Promise<void>): Promise<void> {
  if (checks.some((c) => c.wishId === wish.id && c.outcome.kind === "running")) return;
  put({ wishId: wish.id, name: wish.name, outcome: { kind: "running" }, at: Date.now() });
  const task = startTask(`Checking the price of ${short(wish.name)}`);
  try {
    const { draft } = await interpretWish(api, wish.name);
    let run = await startResearch(api, draft, []);
    while (run.status === "running") {
      await sleep(POLL_MS);
      run = await getRun(api, run.id);
      const last = run.steps[run.steps.length - 1];
      if (last) {
        const line = stepLine(last);
        updateTask(task, `${line.verb ? `${line.verb} ` : ""}${line.detail}`.trim());
      }
    }
    if (run.status === "error") throw new Error(run.error ?? "The check stopped.");
    const option = run.result ? pickOption(run.result.options, wish.details.agent?.url) : undefined;
    if (!option) throw new Error(`Couldn't find a price to stand behind for ${short(wish.name)}.`);
    if (option.upfrontCents === wish.item.upfrontCents) {
      // The same price: saved as checked today without asking.
      await patch(api, wish, run, option);
      await reload();
      put({ wishId: wish.id, name: wish.name, outcome: { kind: "same", option }, at: Date.now() });
    } else {
      put({ wishId: wish.id, name: wish.name, outcome: { kind: "changed", option, run, was: wish.item.upfrontCents }, at: Date.now() });
    }
  } catch (e) {
    put({ wishId: wish.id, name: wish.name, outcome: { kind: "failed", message: (e as Error).message || "Couldn't check the price just now." }, at: Date.now() });
  } finally {
    endTask(task);
  }
}

/**
 * A saved wish the person tells the Dandy more about (owner, 2026-10-31: "clicking item that you already added and
 * amend it someway by adding more context of what you wanted instead"): the wish is read again with their words and
 * hunted afresh in the background; what it finds waits in the Dandy area to take or leave, like a changed price.
 */
export async function amendWish(api: Api, wish: Wish, said: string): Promise<void> {
  const words = said.trim();
  if (!words || checks.some((c) => c.wishId === wish.id && c.outcome.kind === "running")) return;
  put({ wishId: wish.id, name: wish.name, outcome: { kind: "running" }, at: Date.now(), said: words });
  const task = startTask(`Looking again at ${short(wish.name)}`);
  try {
    const { draft } = await interpretWish(api, `${wish.name}. ${words}`);
    let run = await startResearch(api, draft, []);
    while (run.status === "running") {
      await sleep(POLL_MS);
      run = await getRun(api, run.id);
      const last = run.steps[run.steps.length - 1];
      if (last) {
        const line = stepLine(last);
        updateTask(task, `${line.verb ? `${line.verb} ` : ""}${line.detail}`.trim());
      }
    }
    if (run.status === "error") throw new Error(run.error ?? "The search stopped.");
    // What they meant may well be another seller's, so no preference for the one the wish was saved from.
    const option = run.result ? pickOption(run.result.options) : undefined;
    if (!option) throw new Error(`Couldn't find a price to stand behind for that.`);
    put({ wishId: wish.id, name: wish.name, outcome: { kind: "amended", option, run, name: draft.title || option.label }, at: Date.now(), said: words });
  } catch (e) {
    put({ wishId: wish.id, name: wish.name, outcome: { kind: "failed", message: (e as Error).message || "Couldn't look again just now." }, at: Date.now(), said: words });
  } finally {
    endTask(task);
  }
}

/** Takes what the person meant in place of the saved find: its name, price, seller and pictures. */
export async function adoptAmend(api: Api, wish: Wish, reload: () => Promise<void>): Promise<void> {
  const r = checks.find((c) => c.wishId === wish.id);
  if (r?.outcome.kind !== "amended") return;
  const body = amendPatch(wish, r.outcome.run, r.outcome.option, r.outcome.name);
  const res = await api(`/wishes/${wish.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (!res?.ok) throw new Error(((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't save it.");
  await reload();
  dismissRecheck(wish.id);
}

/** Saves the new price a check found. */
export async function adoptRecheck(api: Api, wish: Wish, reload: () => Promise<void>): Promise<void> {
  const r = checks.find((c) => c.wishId === wish.id);
  if (r?.outcome.kind !== "changed") return;
  await patch(api, wish, r.outcome.run, r.outcome.option);
  await reload();
  dismissRecheck(wish.id);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function useRechecks(): readonly Recheck[] {
  return useSyncExternalStore(subscribe, () => checks, () => checks);
}
