import { describe, expect, it } from "vitest";
import { Alive } from "../src/alive";
import { Jobs, mergeChat } from "../src/dream/jobs";
import { emptyState, type DreamState, type TranscriptEntry } from "../src/dream/types";

const at = "2026-10-31T05:00:00.000Z";
const line = (role: "user" | "agent", text: string): TranscriptEntry => ({ role, text, at });
const view = (id: string, lane: string) => ({ id, lane, label: `job ${id}`, startedAt: at });
const deck = (id: string, round = 1) => ({ id, criteria: { kind: "car" }, cards: [], swipes: {}, round, refined: false }) as unknown as DreamState["decks"][string];

describe("jobs beside the conversation", () => {
  it("lets different subjects run side by side and replaces a running one in the same lane", () => {
    const jobs = new Jobs();
    const db11 = jobs.add("s1", view("a", "car:aston martin db11"));
    const lambo = jobs.add("s1", view("b", "car:lamborghini urus"));
    expect(jobs.list("s1").map((j) => j.id)).toEqual(["a", "b"]);
    // "V12" while the DB11 is searched: the newer search carries it, the older one stops and its work is dropped.
    const v12 = jobs.add("s1", view("c", "car:aston martin db11"));
    expect(db11.signal.aborted).toBe(true);
    expect(db11.replaced()).toBe(true);
    expect(lambo.signal.aborted).toBe(false);
    expect(v12.replaced()).toBe(false);
    jobs.remove("s1", "a");
    jobs.remove("s1", "b");
    jobs.remove("s1", "c");
    expect(jobs.list("s1")).toEqual([]);
  });

  it("keeps a numbered event log the app follows, waking a waiting follower when something comes", async () => {
    const jobs = new Jobs();
    jobs.add("s1", view("a", "car:x"));
    expect(jobs.publish("s1", { type: "text", text: "On its way." })).toBe(1);
    expect((await jobs.since("s1", 0, 0)).events.map((e) => e.seq)).toEqual([1]);
    const waiting = jobs.since("s1", 1, 5_000);
    setTimeout(() => jobs.publish("s1", { type: "step", id: "job_a", state: "done", text: "job a" }), 20);
    const woke = await waiting;
    expect(woke.events.map((e) => e.event.type)).toEqual(["step"]);
    expect(woke.gap).toBe(false);
    // Nothing running: no wait at all.
    jobs.remove("s1", "a");
    const t0 = Date.now();
    expect((await jobs.since("s1", 2, 5_000)).events).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(1_000);
    // A seq from before a restart (or past the log) says reload.
    expect((await jobs.since("s1", 99, 0)).gap).toBe(true);
  });

  it("tells a reloading app to follow from just before the oldest running work's first event", () => {
    const jobs = new Jobs();
    jobs.publish("s1", { type: "text", text: "saved already" });
    jobs.add("s1", view("a", "car:x"));
    jobs.publish("s1", { type: "step", id: "job_a", state: "running", text: "job a" });
    jobs.add("s1", view("b", "home:y"));
    jobs.publish("s1", { type: "step", id: "job_b", state: "running", text: "job b" });
    expect(jobs.resumeFrom("s1")).toBe(1);
    jobs.remove("s1", "a");
    expect(jobs.resumeFrom("s1")).toBe(2);
    jobs.remove("s1", "b");
    expect(jobs.resumeFrom("s1")).toBe(jobs.seq("s1"));
  });

  it("passes events on to listeners with the work that published them", () => {
    const jobs = new Jobs();
    const heard: string[] = [];
    const stop = jobs.listen("s1", (e, origin) => heard.push(`${e.type}:${origin ?? "-"}`));
    jobs.publish("s1", { type: "text", text: "hi" }, "turn1");
    jobs.publish("s1", { type: "widget", widget: { kind: "item", id: "item_1", text: "a Leica Q3" } as never });
    stop();
    jobs.publish("s1", { type: "text", text: "after" });
    expect(heard).toEqual(["text:turn1", "widget:-"]);
  });

  it("runs one save of a session at a time", async () => {
    const jobs = new Jobs();
    const order: string[] = [];
    const slow = jobs.lock("s1", async () => {
      order.push("a start");
      await new Promise((r) => setTimeout(r, 30));
      order.push("a end");
    });
    const fast = jobs.lock("s1", async () => void order.push("b"));
    await Promise.all([slow, fast]);
    expect(order).toEqual(["a start", "a end", "b"]);
  });
});

describe("folding a job's work into the conversation as it is now", () => {
  it("adds its lines after the turn's, takes the cards it made, drops ones it removed and never saves its tag", () => {
    const base: DreamState = { ...emptyState(), counter: 4, decks: { deck_1: deck("deck_1") } };
    const given = [line("user", "an Aston Martin DB11")];
    // The job began from the chat as the turn had it, then made its own deck and line.
    const job = structuredClone({ transcript: given, state: base });
    const before = new Set(job.transcript);
    job.state.tag = "a1f";
    job.state.counter = 5;
    job.state.decks["deck_a1f5"] = deck("deck_a1f5");
    delete job.state.decks["deck_1"];
    job.state.car = { kind: "car", make: "Aston Martin", model: "DB11", trim: "", colour: "", condition: "used", maxPrice: null, currency: "USD", notes: "" };
    job.transcript.push(line("agent", "Showed deck deck_a1f5"));
    // Meanwhile the next turn answered "Is that the V12?" and saved.
    const latest = { transcript: [...given, line("user", "Is that the V12?"), line("agent", "The AMR is the V12.")], state: { ...base, counter: 6, widgets: { item_6: { kind: "item", id: "item_6", text: "x" } as never } } };
    const merged = mergeChat(latest, structuredClone(base), job, before, 80);
    expect(merged.transcript.map((e) => e.text)).toEqual(["an Aston Martin DB11", "Is that the V12?", "The AMR is the V12.", "Showed deck deck_a1f5"]);
    expect(Object.keys(merged.state.decks)).toEqual(["deck_a1f5"]);
    expect(Object.keys(merged.state.widgets)).toEqual(["item_6"]);
    expect(merged.state.car?.model).toBe("DB11");
    expect(merged.state.counter).toBe(6);
    expect(merged.state.tag).toBeUndefined();
  });

  it("leaves what it didn't touch as the latest has it", () => {
    const base: DreamState = { ...emptyState(), decks: { deck_1: deck("deck_1") } };
    const job = structuredClone({ transcript: [] as TranscriptEntry[], state: base });
    const latest = { transcript: [], state: { ...base, decks: { deck_1: deck("deck_1", 2) } } };
    const merged = mergeChat(latest, structuredClone(base), job, new Set(), 80);
    expect(merged.state.decks["deck_1"]!.round).toBe(2);
  });
});

describe("staying awake while work outlives its request", () => {
  it("holds a request to itself while work is in flight and lets go once it settles", async () => {
    let alive!: Alive;
    const holds: string[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      holds.push(url);
      const status = await alive.wait((init?.headers as Record<string, string>)["x-hold"]);
      return new Response(null, { status });
    }) as unknown as typeof fetch;
    alive = new Alive({ origin: "https://api.example.com/", fetch: fakeFetch, holdMs: 1_000, tickMs: 5, retryMs: 5 });
    let finish!: () => void;
    const work = alive.keep(new Promise<string>((resolve) => (finish = () => resolve("done"))));
    expect(alive.inFlight).toBe(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(holds[0]).toBe("https://api.example.com/internal/hold");
    finish();
    expect(await work).toBe("done");
    expect(alive.inFlight).toBe(0);
  });

  it("turns away a hold that carries another instance's token", async () => {
    const alive = new Alive({ holdMs: 10 });
    expect(await alive.wait("someone-else")).toBe(404);
    expect(await alive.wait(alive.token)).toBe(204);
  });

  it("passes a failure through untouched", async () => {
    const alive = new Alive();
    await expect(alive.keep(Promise.reject(new Error("no")))).rejects.toThrow("no");
    expect(alive.inFlight).toBe(0);
  });
});

describe("a reply as one paragraph", () => {
  it("reads a list the model wrote anyway as one sentence, never run together", async () => {
    const { paragraph } = await import("../src/dream/agent");
    expect(paragraph("Got you, I just added all 3:\nLeica Q3 for street photos\na week in Kyoto in the fall\nOmega Speedmaster\nI'm hunting down real pricing for each now.")).toBe(
      "Got you, I just added all 3: Leica Q3 for street photos, a week in Kyoto in the fall, Omega Speedmaster. I'm hunting down real pricing for each now.",
    );
    expect(paragraph("On it:\n- a Leica Q3\n- a week in Kyoto\n\nThey'll show up as cards on their own soon.")).toBe("On it: a Leica Q3, a week in Kyoto. They'll show up as cards on their own soon.");
    expect(paragraph("One line.")).toBe("One line.");
  });
});
