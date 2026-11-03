import { afterEach, describe, expect, it, vi } from "vitest";
import { carActor, runActor } from "../src/dream/apify";

const car = { kind: "car" as const, make: "Porsche", model: "911", trim: "", colour: "", condition: "any" as const, maxPrice: null, currency: "USD", notes: "" };
const ctxWith = (res: () => Response) =>
  ({
    apify: { token: "apify-secret-token", dailyUsd: 1, fetch: async () => res() },
    now: () => new Date("2026-11-03T05:00:00Z"),
    db: { query: async (sql: string) => (sql.startsWith("select") ? { rows: [{ spent: "0" }] } : { rows: [] }) },
    userId: "u1",
  }) as never;

afterEach(() => vi.restoreAllMocks());

describe("a portal run that fails", () => {
  // Filming the demo (2026-11-03), every in-app realtor.com run answered 400 while the same request worked later; the
  // log held only the status, so the cause was lost.
  it("logs Apify's own error text with the status, so the cause can be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = JSON.stringify({ error: { type: "run-failed", message: "Actor run did not succeed (run ID: abc, status: FAILED)" } });
    const r = await runActor(ctxWith(() => new Response(body, { status: 400 })), carActor(), car);
    expect(r.listings).toEqual([]);
    expect(warn).toHaveBeenCalledWith("apify run answered", "blackfalcondata~mobile-de-scraper", 400, expect.stringContaining("status: FAILED"));
  });

  it("keeps the logged text short and on one line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await runActor(ctxWith(() => new Response(`line one\n${"x".repeat(2000)}`, { status: 502 })), carActor(), car);
    const text = warn.mock.calls[0]![3] as string;
    expect(text.length).toBeLessThanOrEqual(300);
    expect(text).not.toMatch(/\n/);
  });
});
