import type { DreamEvent } from "@dandelist/catalogue/dream";
import type { DreamState, TranscriptEntry } from "./types";

/**
 * The Dandy's slow work (a car or home search, a builder's price list, a service quote, what a pick costs to keep) runs
 * as jobs beside the conversation, so the person can keep talking while it works and add to it (owner, 2026-10-31:
 * "Users need to be able to have full conversations while shit is happening", "I should be able to add context while
 * it's working"). A job works on its own copy of the chat and folds what it made back in when it ends (mergeChat).
 * What it shows on the way goes to the session's event log, which the app follows (GET /dream/sessions/:id/events).
 */

/** Events kept per session for an app that comes back: enough for a few jobs' steps, cards and lines. */
const LOG_KEEP = 300;
/** Sessions whose log is kept in memory, newest first. */
const SESSIONS_KEPT = 500;

export interface JobStep {
  id: string;
  state: "running" | "done";
  text: string;
}

/** What the app and the concierge see of a job. */
export interface JobView {
  id: string;
  /** Which kind of work: a newer job of the same lane replaces a running one ("V12" sent while the DB11 is searched). */
  lane: string;
  label: string;
  startedAt: string;
}

interface Job extends JobView {
  /** The seq its first event will take: everything from here on isn't in the saved conversation until it's folded in. */
  first: number;
  stop: AbortController;
  /** Set when a newer job of the same lane replaced it: what it made is dropped. */
  replaced: boolean;
}

interface Log {
  seq: number;
  events: { seq: number; event: DreamEvent }[];
  waiters: Set<() => void>;
}

export class Jobs {
  private readonly running = new Map<string, Map<string, Job>>();
  private readonly logs = new Map<string, Log>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly listeners = new Map<string, Set<(event: DreamEvent, origin?: string) => void>>();

  /** Jobs working on a session right now, oldest first. */
  list(session: string): JobView[] {
    return [...(this.running.get(session)?.values() ?? [])].map(({ id, lane, label, startedAt }) => ({ id, lane, label, startedAt }));
  }

  /**
   * Registers a job and stops any running one in the same lane: the newer one carries everything said so far. Returns
   * the job's abort signal and a check for whether it has been replaced since.
   */
  add(session: string, view: JobView): { signal: AbortSignal; replaced: () => boolean } {
    const jobs = this.running.get(session) ?? new Map<string, Job>();
    this.running.set(session, jobs);
    for (const old of jobs.values()) {
      if (old.lane !== view.lane) continue;
      old.replaced = true;
      old.stop.abort();
    }
    const job: Job = { ...view, first: this.seq(session) + 1, stop: new AbortController(), replaced: false };
    jobs.set(view.id, job);
    return { signal: job.stop.signal, replaced: () => job.replaced };
  }

  /** Forgets a finished job. */
  remove(session: string, id: string): void {
    const jobs = this.running.get(session);
    jobs?.delete(id);
    if (jobs && !jobs.size) this.running.delete(session);
  }

  /**
   * Where an app that has just read the saved conversation follows the log from: just before the first event of the
   * oldest work still running (none of which is saved yet), or the log's end when nothing runs. Read it under the
   * session's lock (see lock), together with the saved conversation, so nothing is folded in between.
   */
  resumeFrom(session: string): number {
    const firsts = [...(this.running.get(session)?.values() ?? [])].map((j) => j.first);
    return firsts.length ? Math.min(...firsts) - 1 : this.seq(session);
  }

  /** The number of the last event in a session's log (0 before any). */
  seq(session: string): number {
    return this.logs.get(session)?.seq ?? 0;
  }

  /**
   * Hears every event published to a session from now on, with the id of the work that published it, so an open turn
   * can pass its jobs' events on to the phone as they happen. Returns the function that stops listening.
   */
  listen(session: string, fn: (event: DreamEvent, origin?: string) => void): () => void {
    const set = this.listeners.get(session) ?? new Set();
    set.add(fn);
    this.listeners.set(session, set);
    return () => {
      set.delete(fn);
      if (!set.size) this.listeners.delete(session);
    };
  }

  /** Adds an event to a session's log, tells its listeners and wakes anyone waiting on it. */
  publish(session: string, event: DreamEvent, origin?: string): number {
    let log = this.logs.get(session);
    if (!log) {
      log = { seq: 0, events: [], waiters: new Set() };
      this.logs.set(session, log);
      // The oldest sessions' logs go first; an app coming back to one reloads the conversation instead.
      if (this.logs.size > SESSIONS_KEPT) {
        for (const [key, l] of this.logs) {
          if (this.logs.size <= SESSIONS_KEPT) break;
          if (!l.waiters.size && !this.running.has(key)) this.logs.delete(key);
        }
      }
    }
    log.seq++;
    log.events.push({ seq: log.seq, event });
    if (log.events.length > LOG_KEEP) log.events.splice(0, log.events.length - LOG_KEEP);
    for (const wake of log.waiters) wake();
    log.waiters.clear();
    for (const fn of this.listeners.get(session) ?? []) fn(event, origin);
    return log.seq;
  }

  /**
   * The events after `after`, waiting up to `waitMs` for one when there are none yet and work is still running.
   * `gap` is true when events the caller hasn't seen were already dropped (or the server restarted): reload the session.
   */
  async since(session: string, after: number, waitMs: number): Promise<{ events: { seq: number; event: DreamEvent }[]; seq: number; gap: boolean; running: JobView[] }> {
    const read = () => {
      const log = this.logs.get(session);
      const events = log?.events.filter((e) => e.seq > after) ?? [];
      const first = log?.events[0]?.seq;
      const gap = after > (log?.seq ?? 0) || (first !== undefined && after < first - 1);
      return { events, seq: log?.seq ?? 0, gap, running: this.list(session) };
    };
    let out = read();
    if (out.events.length || out.gap || !out.running.length || waitMs <= 0) return out;
    const log = this.logs.get(session) ?? { seq: 0, events: [], waiters: new Set<() => void>() };
    this.logs.set(session, log);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, waitMs);
      function done() {
        clearTimeout(timer);
        log.waiters.delete(done);
        resolve();
      }
      log.waiters.add(done);
    });
    out = read();
    return out;
  }

  /** Runs `fn` with no other save of this session in between (one instance; the row lock covers the rest). */
  async lock<T>(session: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(session) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    this.locks.set(session, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(session) === tail) this.locks.delete(session);
    }
  }
}

/** A chat as one piece of work found it, to fold back into the chat as it stands now. */
export interface ChatCopy {
  transcript: TranscriptEntry[];
  state: DreamState;
}

const MAPS = ["widgets", "decks", "builds", "quotes"] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Folds what one piece of work did (`base` became `next`) into the chat as it is now (`latest`), so a turn and the jobs
 * beside it never write over each other: new lines are added in order, cards it made or changed replace theirs by id,
 * cards it dropped go, and search criteria it changed are taken. `before` holds the transcript entries the work began
 * with, so lines it added are told apart from lines it was given.
 */
export function mergeChat(latest: ChatCopy, base: DreamState, next: ChatCopy, before: ReadonlySet<TranscriptEntry>, maxTranscript: number): ChatCopy {
  const transcript = [...latest.transcript, ...next.transcript.filter((e) => !before.has(e))];
  if (transcript.length > maxTranscript) transcript.splice(0, transcript.length - maxTranscript);
  const state: DreamState = { ...latest.state, counter: Math.max(latest.state.counter, next.state.counter) };
  for (const key of MAPS) {
    const merged = { ...(latest.state[key] as Record<string, unknown>) };
    const was = base[key] as Record<string, unknown>;
    const now = next.state[key] as Record<string, unknown>;
    for (const [id, v] of Object.entries(now)) if (!(id in was) || !same(was[id], v)) merged[id] = v;
    for (const id of Object.keys(was)) if (!(id in now)) delete merged[id];
    (state as unknown as Record<string, unknown>)[key] = merged;
  }
  if (!same(base.home, next.state.home)) state.home = next.state.home;
  if (!same(base.car, next.state.car)) state.car = next.state.car;
  state.seen = [...new Set([...latest.state.seen, ...next.state.seen])].slice(-200);
  delete state.tag;
  return { transcript, state };
}
