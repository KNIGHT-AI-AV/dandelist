import { afterEach, describe, expect, it } from "vitest";
import type { DreamAction } from "./dream";
import { dreamTurn } from "./dream";
import { QUEUED_MAX, queueWish, queuedWishes, takeQueuedWishes } from "./wish-queue";

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
  // Anything a test left waiting is taken and dropped, so the next starts empty.
  takeQueuedWishes(() => {})();
});

describe("adding another wish while one is priced", () => {
  it("waits, in order, for the chat to take it", () => {
    expect(queueWish("  a Leica   Q3 ")).toBe(true);
    expect(queueWish("a Rolex Daytona")).toBe(true);
    expect(queuedWishes()).toEqual(["a Leica Q3", "a Rolex Daytona"]);
    const took: string[] = [];
    stop = takeQueuedWishes((t) => took.push(t));
    expect(took).toEqual(["a Leica Q3", "a Rolex Daytona"]);
    expect(queuedWishes()).toEqual([]);
  });

  it("goes straight to the chat once it is listening, and waits again after it stops", () => {
    const took: string[] = [];
    stop = takeQueuedWishes((t) => took.push(t));
    queueWish("a week in Lisbon");
    expect(took).toEqual(["a week in Lisbon"]);
    stop();
    stop = null;
    queueWish("a Bentley");
    expect(took).toEqual(["a week in Lisbon"]);
    expect(queuedWishes()).toEqual(["a Bentley"]);
  });

  it("ignores a blank wish and keeps a long one to the limit", () => {
    expect(queueWish("   ")).toBe(false);
    expect(queuedWishes()).toEqual([]);
    queueWish("x".repeat(QUEUED_MAX + 50));
    expect(queuedWishes()[0]).toHaveLength(QUEUED_MAX);
  });

  it("each one reaches the Dandy as the person's own message, in the order added (network faked)", async () => {
    const sent: DreamAction[] = [];
    // The API's turn endpoint, faked: it records the action and streams back a finished turn.
    const apiStream = async (_path: string, init?: RequestInit) => {
      sent.push((JSON.parse(String(init?.body)) as { action: DreamAction }).action);
      const sse = `data: ${JSON.stringify({ type: "text", text: "On it." })}\n\ndata: ${JSON.stringify({ type: "done", sessionId: "s1" })}\n\n`;
      return new Response(new ReadableStream({ start: (c) => (c.enqueue(new TextEncoder().encode(sse)), c.close()) }), { status: 200 });
    };
    // The chat's queue: one turn at a time, in order.
    let chain = Promise.resolve<string | null>(null);
    stop = takeQueuedWishes((text) => {
      chain = chain.then((session) => dreamTurn(apiStream, session, { type: "message", text }, () => {}));
    });
    queueWish("a Leica Q3");
    queueWish("a Rolex Daytona");
    expect(await chain).toBe("s1");
    expect(sent).toEqual([
      { type: "message", text: "a Leica Q3" },
      { type: "message", text: "a Rolex Daytona" },
    ]);
  });
});
