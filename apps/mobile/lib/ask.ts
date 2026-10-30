/**
 * Questions asked one at a time (owner, 2026-10-30: "if they click it, it should be enough. Whatever the user wants
 * to give is enough. And if they don't respond in time, the AI should just figure it out ... make sure the menus go
 * away when they're done. Once they make their selection, it should just disappear and collapse").
 *
 * A builder's steps and a hunt's refine questions run on this. One question is open; the others show as one-line
 * summaries, each tappable to change. A tap or a typed answer is the whole answer: the question closes and the next
 * one without an answer opens. When time runs out on the open one, the Dandy goes with its own pick for it and for
 * every later one still without an answer, and says which. Pure, so the tests can walk it.
 */

/**
 * An open question nobody taps, scrolls or types in for this long gets the Dandy's pick. About the 10 s that holds
 * someone's attention on one thing (Nielsen's response-time limits), plus the moment the card's photos take to land;
 * any touch starts it again, so someone still looking never loses the question.
 */
export const ASK_IDLE_MS = 12_000;
/**
 * A question that takes several picks closes this long after the last one: enough to reach a second choice in the
 * same row, short enough that a tap still feels like the whole answer.
 */
export const ASK_SETTLE_MS = 3_000;

/** Who answered: the person (a tap or typed words), or the Dandy (what it filled in, or its pick when time ran out). */
export type AnsweredBy = "you" | "dandy";

export interface Ask {
  /** The question open now; null once every one has an answer. */
  open: string | null;
  by: Readonly<Record<string, AnsweredBy>>;
}

/** Starts a run over `ids`, in order. `given` already hold the Dandy's answer and start closed; the first other opens. */
export function startAsk(ids: readonly string[], given: readonly string[] = []): Ask {
  const by: Record<string, AnsweredBy> = {};
  for (const id of given) if (ids.includes(id)) by[id] = "dandy";
  return { open: ids.find((id) => !(id in by)) ?? null, by };
}

/** The first question after `from`, then from the top, with no answer yet. */
function nextOpen(ids: readonly string[], by: Ask["by"], from: string): string | null {
  const i = ids.indexOf(from);
  return [...ids.slice(i + 1), ...ids.slice(0, Math.max(0, i))].find((id) => !(id in by)) ?? null;
}

/** The person answered `id` with a tap or typed words: it closes, and the next question without an answer opens. */
export function answerAsk(a: Ask, ids: readonly string[], id: string): Ask {
  const by = { ...a.by, [id]: "you" as const };
  return { open: nextOpen(ids, by, id), by };
}

/** Opens a closed question again to change it. One left open without an answer stays unanswered and comes round again. */
export function reopenAsk(a: Ask, id: string): Ask {
  return { ...a, open: id };
}

/**
 * Time ran out on the open question: the Dandy takes it (unless the person answered it before and only opened it
 * again) and every other question still without an answer. `took` lists those, in order, for the line that names its
 * picks. Every question has an answer afterwards, so the run is done.
 */
export function timeUpAsk(a: Ask, ids: readonly string[]): { ask: Ask; took: string[] } {
  if (a.open === null) return { ask: a, took: [] };
  const took = ids.filter((id) => (id === a.open ? a.by[id] !== "you" : !(id in a.by)));
  const by: Record<string, AnsweredBy> = { ...a.by };
  for (const id of took) by[id] = "dandy";
  return { ask: { open: null, by }, took };
}

export const askDone = (a: Ask) => a.open === null;

/** "A", "A and B", "A, B and C". */
export function joinAnd(xs: readonly string[]): string {
  return xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** The Dandy's one line after it chose for the person: "I went with Base and Obsidian Black." Null when it named nothing. */
export function pickedLine(labels: readonly string[]): string | null {
  const seen = new Set<string>();
  const xs = labels.map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l && !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase()));
  if (!xs.length) return null;
  return `I went with ${joinAnd(xs.length > 4 ? [...xs.slice(0, 3), `${xs.length - 3} more`] : xs)}.`;
}

type Timer = ReturnType<typeof setTimeout>;

/**
 * Waits on the open question and calls `due` once when its time is up. Every touch starts the wait again, and a pick
 * on a question that takes several starts the short one. A hold (a field in focus, the page turned away, the app in
 * the background, a screen reader on) stops it; letting go starts the long wait again from the top, so nobody comes
 * back to a question that is about to close. `change` hears the window whenever a wait starts, or null when none runs.
 */
export class AskClock {
  private key: string | null = null;
  private timer: Timer | null = null;
  private readonly holds = new Set<string>();
  private ms = ASK_IDLE_MS;

  constructor(
    private readonly due: (key: string) => void,
    private readonly change: (windowMs: number | null) => void = () => {},
  ) {}

  /** Waits on `key`; null waits on nothing. A different key starts the long wait. */
  wait(key: string | null): void {
    if (key === this.key) return;
    this.key = key;
    this.ms = ASK_IDLE_MS;
    this.restart();
  }

  /** Something happened on the open question; `picked` when it was a pick on a question that takes several. */
  touch(picked = false): void {
    if (this.key === null) return;
    this.ms = picked ? ASK_SETTLE_MS : ASK_IDLE_MS;
    this.restart();
  }

  hold(reason: string, on: boolean): void {
    const was = this.holds.size > 0;
    if (on) this.holds.add(reason);
    else this.holds.delete(reason);
    if (was === this.holds.size > 0) return;
    if (!on) this.ms = ASK_IDLE_MS;
    this.restart();
  }

  stop(): void {
    this.key = null;
    this.restart();
  }

  /** The window of the wait running now, or null. */
  get counting(): number | null {
    return this.timer ? this.ms : null;
  }

  private restart(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const key = this.key;
    if (key === null || this.holds.size) return this.change(null);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.key !== key) return;
      this.key = null;
      this.change(null);
      this.due(key);
    }, this.ms);
    this.change(this.ms);
  }
}
