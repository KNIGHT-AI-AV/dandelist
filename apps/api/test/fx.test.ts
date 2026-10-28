import { describe, expect, it } from "vitest";
import { fxRoutes } from "../src/fx";

const clock = { t: new Date("2026-10-28T12:00:00Z") };

describe("GET /fx", () => {
  it("returns today's rates per dollar and caches them", async () => {
    let calls = 0;
    const web = (async (url: string | URL) => {
      calls++;
      expect(String(url)).toContain("base=USD");
      return new Response(JSON.stringify({ date: "2026-10-28", rates: { EUR: 0.93, GBP: 0.79, JPY: 151.2, CNY: 7.1 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const app = fxRoutes({ webFetch: web, now: () => clock.t });
    const a = await (await app.request("/")).json();
    expect(a).toEqual({ base: "USD", date: "2026-10-28", rates: { USD: 1, EUR: 0.93, GBP: 0.79, JPY: 151.2, CNY: 7.1 } });
    await app.request("/");
    expect(calls).toBe(1);
  });

  it("keeps the last good answer when the source fails, and says so when there is none", async () => {
    let up = true;
    const web = (async () => (up ? new Response(JSON.stringify({ date: "2026-10-28", rates: { EUR: 0.9 } }), { status: 200 }) : new Response("down", { status: 502 }))) as unknown as typeof fetch;
    const now = { t: new Date("2026-10-28T00:00:00Z") };
    const app = fxRoutes({ webFetch: web, now: () => now.t });
    expect((await app.request("/")).status).toBe(200);
    up = false;
    now.t = new Date("2026-10-29T00:00:00Z");
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { rates: Record<string, number> }).rates.EUR).toBe(0.9);
    const cold = fxRoutes({ webFetch: web, now: () => now.t });
    expect((await cold.request("/")).status).toBe(503);
  });
});
