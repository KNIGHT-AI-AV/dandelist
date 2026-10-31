import type { DreamEvent, Numbered, RunningJob, SessionDetail } from "./dream";

/**
 * Who shows the conversation's events, and each only once (review of #134). One source owns delivery at a time: the
 * open turn's stream, the follower reading the event log, or a reload of the saved conversation. Each takes it over
 * from the last, and a source that has been taken over from changes nothing when its answer comes: not the feed, not
 * the cursor, and it starts no follower. Numbered events show in order, once each: one at or below the cursor has been
 * shown already.
 */
export interface DeliveryDeps {
  /** One event onto the feed. */
  show(e: DreamEvent): void;
  /** The feed replaced by the conversation as saved, with what is still running. */
  reset(s: SessionDetail): void;
  /** The log after `after`, waiting a while for something new (lib/dream.ts sessionEvents). */
  events(sid: string, after: number, signal: AbortSignal): Promise<{ events: { seq: number; event: DreamEvent }[]; gap: boolean; running: RunningJob[] }>;
  /** The conversation as saved (lib/dream.ts loadSession). */
  load(sid: string): Promise<SessionDetail>;
  /** The conversation the chat is in now. */
  current(): string | null;
  /** A pause before the follower tries again after a dropped connection. */
  wait(ms: number): Promise<void>;
}

/** A turn's hold on delivery, from its stream opening to its end. */
export interface TurnDelivery {
  /** The cursor the turn's request sends: the stream starts with what came after it. */
  readonly after: number;
  /** An event from the stream; true when it's the turn's to show. */
  take(e: Numbered): boolean;
  /** The stream ended: if the turn's own done left work running, the log is followed from here. */
  end(sid: string | null): void;
}

export class Delivery {
  /** The highest event number shown in this conversation. */
  seen = 0;
  private owner = 0;
  private follower: AbortController | null = null;

  constructor(private readonly deps: DeliveryDeps) {}

  /** The chat left its conversation: everything still on its way is stale and the count starts again. */
  leave(): void {
    this.claim();
    this.seen = 0;
  }

  /** Takes delivery over: whatever held it before is stale from now on. */
  claim(): number {
    this.follower?.abort();
    this.follower = null;
    return ++this.owner;
  }

  /** Whether `token` still holds delivery. */
  holds(token: number): boolean {
    return this.owner === token;
  }

  /** Whether a numbered event is new, counting it if so; one without a number (an older server) always is. */
  accept(seq: number | undefined): boolean {
    if (seq === undefined) return true;
    if (seq <= this.seen) return false;
    this.seen = seq;
    return true;
  }

  /** A turn's stream takes delivery over. */
  beginTurn(): TurnDelivery {
    const token = this.claim();
    let started = false;
    let own: Extract<DreamEvent, { type: "done" }> | null = null;
    return {
      after: this.seen,
      take: (e) => {
        if (!this.holds(token)) return false;
        if (e.type === "start") {
          started = true;
          // The server's log started again since the last number seen (a restart): count on from where it stands.
          if (e.log !== undefined && e.log < this.seen) this.seen = e.log;
          return true;
        }
        if (e.type === "done") {
          this.accept(e.seq);
          // Before start, a done is one the app missed, replayed: history, never this turn's end. After it, the last
          // one is the turn's own (the stream ends with it).
          if (started) own = e;
          return false;
        }
        return this.accept(e.seq);
      },
      end: (sid) => {
        if (sid && this.holds(token) && own?.running) this.follow(sid, this.seen);
      },
    };
  }

  /** Shows the conversation as saved, then what running work has shown since, and follows it while it runs. */
  restore(token: number, sid: string, s: SessionDetail): boolean {
    if (!this.holds(token) || this.deps.current() !== sid) return false;
    this.deps.reset(s);
    for (const e of s.pending ?? []) this.deps.show(e);
    this.seen = s.seq ?? 0;
    if (s.running?.length) this.follow(sid, this.seen);
    return true;
  }

  /**
   * Opens a saved conversation (history, or the latest one on launch): the chat enters it only if nothing took delivery
   * over while it loaded (review of #134). A turn sent meanwhile wins, and the chat never switches away from it.
   * Errors loading it reach the caller only while the open still holds delivery.
   */
  async open(id: string, enter: (sid: string) => void): Promise<boolean> {
    const token = this.claim();
    let s: SessionDetail;
    try {
      s = await this.deps.load(id);
    } catch (e) {
      // A failure nothing waits for any more says nothing: a message sent meanwhile keeps its turn's feed clean.
      if (this.holds(token)) throw e;
      return false;
    }
    if (!this.holds(token)) return false;
    enter(s.id);
    return this.restore(token, s.id, s);
  }

  /** Reloads the conversation as saved; a turn that starts meanwhile wins and the reload's answer is dropped. */
  async recover(sid: string): Promise<void> {
    const token = this.claim();
    let s: SessionDetail;
    try {
      s = await this.deps.load(sid);
    } catch {
      // Unreachable for now: keep following the log, which says so itself if anything was missed.
      if (this.holds(token) && this.deps.current() === sid) this.follow(sid, this.seen);
      return;
    }
    this.restore(token, sid, s);
  }

  /** Follows the log from `after` while work runs, showing each new event once. */
  follow(sid: string, after: number): void {
    const token = this.claim();
    const ctrl = new AbortController();
    this.follower = ctrl;
    const live = () => !ctrl.signal.aborted && this.holds(token) && this.deps.current() === sid;
    void (async () => {
      let cursor = Math.max(after, this.seen);
      let misses = 0;
      while (live()) {
        try {
          const r = await this.deps.events(sid, cursor, ctrl.signal);
          // An answer that comes after the follower was taken over from changes nothing.
          if (!live()) return;
          misses = 0;
          if (r.gap) {
            // Missed some (or the server restarted): the saved conversation is the truth.
            void this.recover(sid);
            return;
          }
          for (const { seq, event } of r.events) {
            cursor = seq;
            if (this.accept(seq)) this.deps.show(event);
          }
          if (!r.running.length) break;
        } catch {
          if (!live()) return;
          // A dropped connection is tried again, more slowly each time; coming back to the app starts afresh.
          misses++;
          await this.deps.wait(Math.min(15_000, 1_000 * 2 ** misses));
        }
      }
      if (this.follower === ctrl) this.follower = null;
    })();
  }
}
