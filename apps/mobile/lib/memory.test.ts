import { describe, expect, it, vi } from "vitest";
// Only the request helpers here; the hook's sign-in ownership is tested with the real AuthProvider in memory-owner.test.ts.
vi.mock("./auth", () => ({ useAuth: () => ({}), currentSignIn: () => 0, bindToSignIn: <T>(api: T) => api }));
import { fetchMemories, forgetAllMemories, forgetMemory } from "./memory";

const lines = [{ id: "m1", text: "prefers vintage cars to new ones", createdAt: "2026-10-31T08:00:00.000Z" }];
const answering = (status: number, body: unknown) => vi.fn(async (_path: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));

describe("what the Dandy remembers, from Settings", () => {
  it("reads the lines, forgets one by its id or all of them, each answering with what is left", async () => {
    const api = answering(200, { memories: lines });
    expect(await fetchMemories(api)).toEqual(lines);
    expect(api.mock.calls[0]![0]).toBe("/me/memories");
    const one = answering(200, { memories: [] });
    expect(await forgetMemory(one, "a/b")).toEqual([]);
    expect(one.mock.calls[0]).toEqual(["/me/memories/a%2Fb", { method: "DELETE" }]);
    const all = answering(200, { memories: [] });
    await forgetAllMemories(all);
    expect(all.mock.calls[0]).toEqual(["/me/memories", { method: "DELETE" }]);
  });

  it("says it couldn't, in plain words, when the server refuses, answers something else or can't be reached", async () => {
    await expect(fetchMemories(answering(500, { error: "boom" }))).rejects.toThrow("Couldn't do that just now. Try again.");
    await expect(fetchMemories(answering(200, { nope: true }))).rejects.toThrow("Couldn't do that just now. Try again.");
    await expect(forgetMemory(vi.fn(async () => Promise.reject(new Error("offline"))), "m1")).rejects.toThrow("Couldn't do that just now. Try again.");
  });
});
