import { describe, expect, it } from "vitest";
import { fxRoutes } from "../src/fx";

type FxBody = { base: string; date: string; rates: Record<string, number>; observations: Record<string, { rate: number; source: string; referenceDate: string; fetchedAt: string; retained: boolean }> };
const read = async (response: Response | Promise<Response>): Promise<FxBody> => (await (await response).json()) as FxBody;

const clock = { t: new Date("2026-10-28T12:00:00Z") };

describe("FX observation retention", () => {
  const initial = { base: "USD", date: "2026-10-28", rates: { EUR: 0.9, GBP: 0.75, JPY: 160, CNY: 6.5 } };

  it("merges a partial response and keeps each omitted currency's date through an outage", async () => {
    let provider: unknown = initial;
    let failed = false;
    let now = new Date("2026-10-28T17:00:00Z");
    const web = (async () => failed ? new Response("down", { status: 502 }) : Response.json(provider)) as typeof fetch;
    const app = fxRoutes({ webFetch: web, now: () => now });
    const first = await read(app.request("/"));
    now = new Date("2026-10-29T17:00:00Z");
    provider = { base: "USD", date: "2026-10-29", rates: { EUR: 0.8 } };
    const partial = await read(app.request("/"));
    expect(partial.rates).toEqual({ USD: 1, EUR: 0.8, GBP: 0.75, JPY: 160, CNY: 6.5 });
    expect(partial.observations.EUR).toEqual({ rate: 0.8, source: "ecb", referenceDate: "2026-10-29", fetchedAt: now.toISOString(), retained: false });
    expect(partial.observations.GBP).toEqual({ ...first.observations.GBP, retained: true });
    expect(partial.date).toBe("2026-10-28");
    failed = true; now = new Date("2026-10-30T17:00:00Z");
    const response = await app.request("/");
    const stale = await read(response);
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(stale.rates).toEqual(partial.rates);
    expect(stale.observations.EUR).toEqual({ ...partial.observations.EUR, retained: true });
    expect(stale.observations.GBP).toEqual(partial.observations.GBP);
  });

  it("does not backdate a currency when a later response contains older observations", async () => {
    let provider: unknown = initial, now = new Date("2026-10-28T17:00:00Z");
    const app = fxRoutes({ webFetch: (async () => Response.json(provider)) as typeof fetch, now: () => now });
    const first = await read(app.request("/"));
    now = new Date("2026-10-29T17:00:00Z");
    provider = { base: "USD", date: "2026-10-27", rates: { EUR: 0.7, GBP: 0.6 } };
    const older = await read(app.request("/"));
    expect(older.rates).toEqual(first.rates);
    expect(older.observations.EUR).toEqual({ ...first.observations.EUR, retained: true });
  });

  it("accepts a same-reference-day correction without changing the source date", async () => {
    let rate = 0.9, now = new Date("2026-10-28T10:00:00Z");
    const app = fxRoutes({ webFetch: (async () => Response.json({ ...initial, rates: { EUR: rate } })) as typeof fetch, now: () => now });
    await app.request("/");
    rate = 0.91; now = new Date("2026-10-28T17:00:00Z");
    const corrected = await read(app.request("/"));
    expect(corrected.observations.EUR).toEqual({ rate: 0.91, source: "ecb", referenceDate: "2026-10-28", fetchedAt: now.toISOString(), retained: false });
  });

  it.each([
    { base: "EUR", date: "2026-10-29", rates: { EUR: 0.8 } },
    { date: "2026-10-29", rates: { EUR: 0.8 } },
    { base: "USD", date: "", rates: { EUR: 0.8 } },
    { base: "USD", date: "2026-02-30", rates: { EUR: 0.8 } },
    { base: "USD", date: "2026-10-29", rates: { USD: 1 } },
    { base: "USD", date: "2026-10-29", rates: { EUR: -1, GBP: "0.8" } },
  ])("keeps the prior set when the provider response is invalid: %j", async (invalid) => {
    let provider: unknown = initial, now = new Date("2026-10-28T17:00:00Z");
    const web = (async () => Response.json(provider)) as typeof fetch;
    const app = fxRoutes({ webFetch: web, now: () => now });
    const first = await read(app.request("/"));
    provider = invalid; now = new Date("2026-10-29T17:00:00Z");
    const response = await app.request("/");
    const after = await read(response);
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(after.rates).toEqual(first.rates);
    expect(after.observations.EUR).toEqual({ ...first.observations.EUR, retained: true });
    const cold = fxRoutes({ webFetch: web, now: () => now });
    expect((await cold.request("/")).status).toBe(503);
  });

  it("a cold partial answer reports only observed currencies, without invented fallback provenance", async () => {
    const app = fxRoutes({ webFetch: (async () => Response.json({ base: "USD", date: "2026-10-28", rates: { EUR: 0.9, GBP: -1 } })) as typeof fetch, now: () => new Date("2026-10-28T17:00:00Z") });
    const response = await read(app.request("/"));
    expect(response.rates).toEqual({ USD: 1, EUR: 0.9 });
    expect(Object.keys(response.observations)).toEqual(["EUR"]);
  });

  it("coalesces simultaneous refreshes", async () => {
    let calls = 0, release!: (response: Response) => void;
    const waiting = new Promise<Response>((resolve) => { release = resolve; });
    const app = fxRoutes({ webFetch: (async () => { calls++; return waiting; }) as typeof fetch, now: () => new Date("2026-10-28T17:00:00Z") });
    const a = app.request("/"), b = app.request("/");
    await Promise.resolve();
    expect(calls).toBe(1);
    release(Response.json(initial));
    const [first, second] = await Promise.all([a, b]);
    expect(first.status).toBe(200); expect(second.status).toBe(200);
    expect(await first.json()).toEqual(await second.json());
  });
});

describe("GET /fx", () => {
  it("returns today's rates per dollar and caches them", async () => {
    let calls = 0;
    const web = (async (url: string | URL) => {
      calls++;
      expect(String(url)).toContain("base=USD");
      return new Response(JSON.stringify({ base: "USD", date: "2026-10-28", rates: { EUR: 0.93, GBP: 0.79, JPY: 151.2, CNY: 7.1 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const app = fxRoutes({ webFetch: web, now: () => clock.t });
    const a = await read(app.request("/"));
    expect(a).toMatchObject({ base: "USD", date: "2026-10-28", rates: { USD: 1, EUR: 0.93, GBP: 0.79, JPY: 151.2, CNY: 7.1 } });
    expect(a.observations.EUR).toEqual({ rate: 0.93, source: "ecb", referenceDate: "2026-10-28", fetchedAt: clock.t.toISOString(), retained: false });
    await app.request("/");
    expect(calls).toBe(1);
  });

  it("keeps the last good answer when the source fails, and says so when there is none", async () => {
    let up = true;
    const web = (async () => (up ? new Response(JSON.stringify({ base: "USD", date: "2026-10-28", rates: { EUR: 0.9 } }), { status: 200 }) : new Response("down", { status: 502 }))) as unknown as typeof fetch;
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
