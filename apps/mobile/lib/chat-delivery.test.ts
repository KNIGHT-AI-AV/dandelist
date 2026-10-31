import { describe, expect, it } from "vitest";
import { Delivery, type DeliveryDeps, type TurnDelivery } from "./chat-delivery";
import type { DreamEvent, Numbered, RunningJob, SessionDetail } from "./dream";

type Poll = { events: { seq: number; event: DreamEvent }[]; gap: boolean; running: RunningJob[] };
function later<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const at = "2026-10-31T06:00:00.000Z";
const text = (t: string): DreamEvent => ({ type: "text", text: t });
const job: RunningJob = { id: "j1", label: "Searching for a DB11 V12" };

/**
 * The chat page in miniature, as components/home/chat-page.tsx wires the controller: its feed, the conversation it is
 * in, and every request to the server held until the test answers it, in any order. Answers ignore their abort signal,
 * like a fetch that was already on its way back.
 */
function chat(sid: string | null = "s1") {
  const feed: string[] = [];
  const polls: { after: number; answer: ReturnType<typeof later<Poll>> }[] = [];
  const loads: ReturnType<typeof later<SessionDetail>>[] = [];
  const box = { current: sid as string | null };
  const deps: DeliveryDeps = {
    show: (e) => void (e.type === "text" && feed.push(e.text)),
    reset: (s) => void feed.splice(0, feed.length, ...s.transcript.map((l) => `${l.role === "user" ? "you" : "dandy"}: ${l.text}`)),
    events: (_sid, after) => {
      const answer = later<Poll>();
      polls.push({ after, answer });
      return answer.promise;
    },
    load: () => {
      const answer = later<SessionDetail>();
      loads.push(answer);
      return answer.promise;
    },
    current: () => box.current,
    wait: async () => undefined,
  };
  const d = new Delivery(deps);
  /** What the page does with each event of a turn's stream. */
  const stream = (t: TurnDelivery, events: Numbered[]) => events.forEach((e) => t.take(e) && deps.show(e));
  return { d, feed, polls, loads, box, stream };
}

describe("one source shows the conversation's events, each once (review of #134)", () => {
  it("takes a missed done replayed before the turn's start as history, and shows an event the stream and the log both carry once", async () => {
    const c = chat();
    c.d.accept(5);
    const t = c.d.beginTurn();
    expect(t.after).toBe(5);
    // What the app missed (the last turn's done, with a job still running, then the job's line), then this turn.
    c.stream(t, [
      { type: "done", sessionId: "s1", seq: 6, running: 1 },
      { ...text("The AMR is the V12."), seq: 7 },
      { type: "start", sessionId: "s1", log: 7 },
      { ...text("Looking at DB11 V12s now."), seq: 8 },
    ]);
    // The replayed done handed nothing to a follower while the stream is open.
    expect(c.polls).toHaveLength(0);
    c.stream(t, [{ type: "done", sessionId: "s1", seq: 9, running: 1 }]);
    t.end("s1");
    // The turn's own done does: the log from where the stream ended.
    expect(c.polls.map((p) => p.after)).toEqual([9]);
    c.polls[0]!.answer.resolve({ events: [{ seq: 8, event: text("Looking at DB11 V12s now.") }, { seq: 10, event: text("Found three.") }], gap: false, running: [] });
    await flush();
    expect(c.feed).toEqual(["The AMR is the V12.", "Looking at DB11 V12s now.", "Found three."]);
    expect(c.d.seen).toBe(10);
  });

  it("drops a reload that answers after a newer turn began: the turn's echo, its lines and the cursor stay", async () => {
    const c = chat();
    c.d.accept(5);
    // Back in the app with no stream open: a reload starts, and its answer is slow.
    const reload = c.d.recover("s1");
    // They send a message meanwhile: the page shows it, and the turn takes over.
    c.feed.push("you: and the Vantage?");
    const t = c.d.beginTurn();
    c.stream(t, [{ type: "start", sessionId: "s1", log: 5 }, { ...text("The Vantage is the V8."), seq: 6 }]);
    // The older snapshot lands, from before the message.
    c.loads[0]!.resolve({ id: "s1", transcript: [{ role: "user", text: "an Aston Martin DB11", at }], widgets: [], running: [job], pending: [], seq: 5 });
    await reload;
    expect(c.feed).toEqual(["you: and the Vantage?", "The Vantage is the V8."]);
    expect(c.d.seen).toBe(6);
    expect(c.polls).toHaveLength(0);
  });

  it("lets an aborted follower's late answer touch neither the feed nor the cursor, for a new turn or a new conversation", async () => {
    const c = chat();
    c.d.follow("s1", 5);
    const t = c.d.beginTurn();
    c.stream(t, [{ type: "start", sessionId: "s1", log: 5 }, { ...text("Here's the DB11."), seq: 6 }]);
    c.polls[0]!.answer.resolve({ events: [{ seq: 6, event: text("Here's the DB11.") }, { seq: 7, event: text("late") }], gap: false, running: [job] });
    await flush();
    expect(c.feed).toEqual(["Here's the DB11."]);
    expect(c.d.seen).toBe(6);
    expect(c.polls).toHaveLength(1);
    // Another conversation: an answer from the old one changes nothing there either.
    c.d.follow("s1", 6);
    c.d.leave();
    c.box.current = "s2";
    c.polls[1]!.answer.resolve({ events: [{ seq: 7, event: text("late") }], gap: false, running: [] });
    await flush();
    expect(c.feed).toEqual(["Here's the DB11."]);
    expect(c.d.seen).toBe(0);
  });

  it("starts no follower from a replayed done when the stream ends without its own", () => {
    const c = chat();
    c.d.accept(5);
    const t = c.d.beginTurn();
    c.stream(t, [{ type: "done", sessionId: "s1", seq: 6, running: 1 }, { type: "start", sessionId: "s1", log: 6 }, { ...text("Hm."), seq: 7 }]);
    t.end("s1");
    expect(c.polls).toHaveLength(0);
  });

  it("drops a turn's late events once something newer has taken over", () => {
    const c = chat();
    const t = c.d.beginTurn();
    c.stream(t, [{ type: "start", sessionId: "s1", log: 0 }, { ...text("One."), seq: 1 }]);
    void c.d.recover("s1");
    c.stream(t, [{ ...text("Two."), seq: 2 }]);
    t.end("s1");
    expect(c.feed).toEqual(["One."]);
    expect(c.polls).toHaveLength(0);
  });

  it("counts on from where a restarted server's log stands", () => {
    const c = chat();
    c.d.accept(40);
    const t = c.d.beginTurn();
    c.stream(t, [{ type: "start", sessionId: "s1", log: 2 }, { ...text("Still here."), seq: 3 }]);
    expect(c.feed).toEqual(["Still here."]);
    expect(c.d.seen).toBe(3);
  });

  it("shows every event from a server that doesn't number them (control)", () => {
    const c = chat();
    const t = c.d.beginTurn();
    c.stream(t, [{ type: "start", sessionId: "s1" }, text("On it."), text("On it.")]);
    expect(c.feed).toEqual(["On it.", "On it."]);
  });
});

describe("reloads and the follower (controls)", () => {
  it("shows the saved conversation, then what running work has shown since, and follows from the log's end", async () => {
    const c = chat();
    const reload = c.d.recover("s1");
    c.loads[0]!.resolve({ id: "s1", transcript: [{ role: "user", text: "an Aston Martin DB11", at }], widgets: [], running: [job], pending: [{ ...text("Found two so far."), seq: 4 }], seq: 4 });
    await reload;
    expect(c.feed).toEqual(["you: an Aston Martin DB11", "Found two so far."]);
    expect(c.polls.map((p) => p.after)).toEqual([4]);
    c.polls[0]!.answer.resolve({ events: [{ seq: 5, event: text("Found three.") }], gap: false, running: [] });
    await flush();
    expect(c.feed).toEqual(["you: an Aston Martin DB11", "Found two so far.", "Found three."]);
  });

  it("reloads when the log says some were missed, and tries a dropped poll again", async () => {
    const c = chat();
    c.d.follow("s1", 3);
    c.polls[0]!.answer.reject(new Error("network connection was lost"));
    await flush();
    expect(c.polls.map((p) => p.after)).toEqual([3, 3]);
    c.polls[1]!.answer.resolve({ events: [], gap: true, running: [] });
    await flush();
    expect(c.loads).toHaveLength(1);
    c.loads[0]!.resolve({ id: "s1", transcript: [{ role: "agent", text: "Here are three.", at }], widgets: [], running: [], pending: [], seq: 12 });
    await flush();
    expect(c.feed).toEqual(["dandy: Here are three."]);
    expect(c.d.seen).toBe(12);
    expect(c.polls).toHaveLength(2);
  });

  it("keeps following when a reload can't reach the server", async () => {
    const c = chat();
    c.d.accept(7);
    const reload = c.d.recover("s1");
    c.loads[0]!.reject(new Error("offline"));
    await reload;
    expect(c.polls.map((p) => p.after)).toEqual([7]);
  });

  it("doesn't enter a conversation opened from history when a message is sent while it loads", async () => {
    const c = chat(null);
    const entered: string[] = [];
    const opening = c.d.open("s1", (sid) => {
      entered.push(sid);
      c.box.current = sid;
    });
    // A message sent while it loads starts its own conversation.
    const t = c.d.beginTurn();
    c.box.current = "s2";
    c.stream(t, [{ type: "start", sessionId: "s2", log: 0 }, { ...text("Hello."), seq: 1 }]);
    c.loads[0]!.resolve({ id: "s1", transcript: [{ role: "agent", text: "old", at }], widgets: [], running: [job], seq: 4 });
    expect(await opening).toBe(false);
    expect(entered).toEqual([]);
    expect(c.box.current).toBe("s2");
    expect(c.feed).toEqual(["Hello."]);
    expect(c.d.seen).toBe(1);
    expect(c.polls).toHaveLength(0);
  });

  it("keeps a history open's failure out of a message's turn that began while it loaded (review of #145)", async () => {
    const c = chat(null);
    const opening = c.d.open("s1", () => {
      throw new Error("entered");
    });
    const t = c.d.beginTurn();
    c.box.current = "s2";
    c.stream(t, [{ type: "start", sessionId: "s2", log: 0 }, { ...text("Hello."), seq: 1 }]);
    c.loads[0]!.reject(new Error("Couldn't open that conversation."));
    // Nothing waits for it any more: it fails quietly, and the turn's feed stays as it is.
    expect(await opening).toBe(false);
    expect(c.feed).toEqual(["Hello."]);
    expect(c.box.current).toBe("s2");
  });

  it("still reports a history open's failure when nothing came first (control)", async () => {
    const c = chat(null);
    const opening = c.d.open("s1", () => void 0);
    c.loads[0]!.reject(new Error("Couldn't open that conversation."));
    await expect(opening).rejects.toThrow("Couldn't open that conversation.");
  });

  it("enters and shows a conversation opened from history when nothing came first (control)", async () => {
    const c = chat(null);
    const opening = c.d.open("s1", (sid) => void (c.box.current = sid));
    c.loads[0]!.resolve({ id: "s1", transcript: [{ role: "agent", text: "Here are three.", at }], widgets: [], running: [job], pending: [{ ...text("Found a fourth."), seq: 5 }], seq: 5 });
    expect(await opening).toBe(true);
    expect(c.box.current).toBe("s1");
    expect(c.feed).toEqual(["dandy: Here are three.", "Found a fourth."]);
    expect(c.polls.map((p) => p.after)).toEqual([5]);
  });

  it("opens a conversation only for the open that asked for it", () => {
    const c = chat();
    const token = c.d.claim();
    c.d.claim();
    expect(c.d.restore(token, "s1", { id: "s1", transcript: [{ role: "agent", text: "old", at }], widgets: [], seq: 3 })).toBe(false);
    expect(c.feed).toEqual([]);
  });
});
