import type { NewWish, Wish } from "./wishes";
import { getRun, startHunt } from "./agent";
import type { FirstWish, WelcomeState } from "./welcome";

/**
 * Turning the list someone kept before sign-in into their first wishes, without losing any (Codex R01). Each wish
 * comes off the saved list only once the server has it, so a dropped connection or a closed app loses nothing, and
 * what is left is tried again next time. A wish the account already has is not written twice.
 */

/** The saved list's shape, as far as adoption needs it. */
export interface Kept {
  wish: { option?: unknown } | null;
  items: { id: string }[];
}

/** Where each wish toWishes makes sits in the kept list: "wish" for a priced first wish, then each pick's id. */
export const adoptionKeys = (s: Kept): string[] => [...(s.wish?.option ? ["wish"] : []), ...s.items.map((e) => e.id)];

/** The saved list without one wish the server now has. */
export function withoutAdopted<S extends Kept>(s: S, key: string): S {
  return key === "wish" ? { ...s, wish: null } : { ...s, items: s.items.filter((e) => e.id !== key) };
}

/** Nothing is left to adopt: no picks, and no first wish, priced or not. */
export const adoptionDone = (s: Kept) => !s.items.length && !s.wish;

/**
 * The account already holds this wish: same name and the same source page. It catches a write that landed although
 * its answer never came back, so trying again never doubles it.
 */
export const alreadyHas = (have: Pick<Wish, "name" | "details">[], w: Pick<NewWish, "name" | "details">) =>
  have.some((x) => x.name === w.name && (x.details?.agent?.url ?? "") === (w.details?.agent?.url ?? ""));

interface Adoption {
  have(): Pick<Wish, "name" | "details">[];
  add(wish: NewWish): Promise<unknown>;
  save(state: WelcomeState | null): Promise<void>;
  toWishes(state: WelcomeState): NewWish[];
  price(text: string): Promise<FirstWish | null>;
}

/** Checkpoint completed research before saving it; remove wishes only after the account has them. */
export async function adoptWelcome(kept: WelcomeState, deps: Adoption): Promise<void> {
  if (!kept.kept) return;
  const keys = adoptionKeys(kept);
  const list = deps.toWishes(kept);
  for (let i = 0; i < list.length; i++) {
    if (!alreadyHas(deps.have(), list[i]!)) {
      const saved = await deps.add(list[i]!).then(() => true, () => false);
      if (!saved) return;
    }
    kept = withoutAdopted(kept, keys[i]!);
    await deps.save(adoptionDone(kept) ? null : kept);
  }
  if (kept.wish && !kept.wish.option) {
    const priced = await deps.price(kept.wish.text).catch(() => null);
    if (!priced?.option) return;
    kept = { ...kept, wish: priced };
    await deps.save(kept);
    const wish = deps.toWishes(kept)[0]!;
    if (!alreadyHas(deps.have(), wish) && !(await deps.add(wish).then(() => true, () => false))) return;
    kept = withoutAdopted(kept, "wish");
    await deps.save(adoptionDone(kept) ? null : kept);
  }
}

/** Wait up to 75 seconds for first-wish research, preserving its result for a separate account-write retry. */
export async function priceFirstWish(api: Parameters<typeof startHunt>[0], text: string): Promise<FirstWish | null> {
  let run = await startHunt(api, { text });
  const until = Date.now() + 75_000;
  while (run.status === "running" && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 2_000));
    run = await getRun(api, run.id);
  }
  const option = run.result?.options[0];
  if (!option || !run.draft) return null;
  return { text, title: run.draft.title, kind: run.draft.kind, option, runId: run.id, explanation: run.result?.explanation ?? "" };
}
