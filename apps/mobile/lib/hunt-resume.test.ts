import { describe, expect, it } from "vitest";
import { resumeHunt } from "./agent";

const run = { id: "run-1", status: "running", steps: [], result: null };
const answer = (status: number, body: unknown = {}) => async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("a card coming back to the hunt it remembers (review of #134)", () => {
  it("shows the hunt when the server has it", async () => {
    expect(await resumeHunt(answer(200, { run }), "run-1")).toEqual({ kind: "run", run });
  });

  it("hunts afresh only when the server says it's gone", async () => {
    expect(await resumeHunt(answer(404, { error: "Not found." }), "run-1")).toEqual({ kind: "fresh" });
  });

  it("keeps following it through a busy server, a dropped connection or a sign-in to refresh", async () => {
    expect(await resumeHunt(answer(503, { error: "Busy." }), "run-1")).toEqual({ kind: "follow" });
    expect(await resumeHunt(answer(401, { error: "Sign in." }), "run-1")).toEqual({ kind: "follow" });
    expect(await resumeHunt(async () => Promise.reject(new TypeError("Network request failed")), "run-1")).toEqual({ kind: "follow" });
  });
});
