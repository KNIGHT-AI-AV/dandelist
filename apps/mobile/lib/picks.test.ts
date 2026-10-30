import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("./storage", () => ({
  getSecret: async (k: string) => store.get(k) ?? null,
  setSecret: async (k: string, v: string | null) => void (v === null ? store.delete(k) : store.set(k, v)),
}));
import { answerPick, fetchTodayPick, hiddenDay, hideForDay, localDay, pickAdded, showsPick, wasPickAdded, type TodayPick } from "./picks";

const pick: TodayPick = { id: "p1", day: "2026-10-29", status: "ready", title: "Riva Aquariva Super", kind: "own", why: "It goes with the summers on the lake you wrote about.", summary: "", photo: null, createdAt: "2026-10-29T12:00:00.000Z" };

beforeEach(() => store.clear());

describe("today's pick on the list", () => {
  it("sends the date on this phone", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(localDay(new Date(2026, 9, 29, 0, 0))).toBe("2026-10-29");
  });

  it("shows a ready pick for today, until it is answered or closed for the day", () => {
    expect(showsPick(pick, "2026-10-29", null)).toBe(true);
    expect(showsPick(null, "2026-10-29", null)).toBe(false);
    expect(showsPick({ ...pick, status: "skipped" }, "2026-10-29", null)).toBe(false);
    expect(showsPick({ ...pick, status: "added" }, "2026-10-29", null)).toBe(false);
    expect(showsPick(pick, "2026-10-30", null)).toBe(false);
    expect(showsPick(pick, "2026-10-29", "2026-10-29")).toBe(false);
    expect(showsPick(pick, "2026-10-29", "2026-10-28")).toBe(true);
  });

  it("remembers the day it was closed on this device", async () => {
    expect(await hiddenDay("user-a")).toBeNull();
    await hideForDay("user-a", "2026-10-29");
    expect(await hiddenDay("user-a")).toBe("2026-10-29");
    // Another person on the same phone still sees theirs.
    expect(await hiddenDay("user-b")).toBeNull();
    // A pick counts as added only once its wish is saved.
    expect(wasPickAdded("pick-1")).toBe(false);
    pickAdded("pick-1");
    expect(wasPickAdded("pick-1")).toBe(true);
  });

  it("asks the API with the day and the Dandy's personality, and answers it", async () => {
    const seen: { path: string; init?: RequestInit }[] = [];
    let reply: Response = Response.json({ pick });
    const api = async (path: string, init?: RequestInit) => (seen.push({ path, init }), reply);
    expect(await fetchTodayPick(api, "2026-10-29", "mogul")).toEqual({ pick, pending: false });
    expect(seen[0]).toMatchObject({ path: "/picks/today", init: { method: "POST", body: JSON.stringify({ day: "2026-10-29", persona: "mogul" }) } });
    reply = Response.json({ pick: null, pending: true });
    expect(await fetchTodayPick(api, "2026-10-29")).toEqual({ pick: null, pending: true });
    expect(seen[1]!.init!.body).toBe(JSON.stringify({ day: "2026-10-29" }));
    reply = new Response("down", { status: 502 });
    expect(await fetchTodayPick(api, "2026-10-29")).toEqual({ pick: null, pending: false });
    reply = Response.json({ pick: { ...pick, status: "skipped" } });
    await answerPick(api, "p1", "skipped");
    expect(seen.at(-1)).toMatchObject({ path: "/picks/p1", init: { method: "PATCH", body: JSON.stringify({ outcome: "skipped" }) } });
    reply = new Response("gone", { status: 404 });
    await expect(answerPick(api, "p1", "added")).rejects.toThrow("Couldn't save that.");
  });
});
