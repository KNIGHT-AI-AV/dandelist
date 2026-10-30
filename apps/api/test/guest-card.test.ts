import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The hunt is a stand-in here, so each test says exactly which card it shows and what changes on it afterwards.
vi.mock("../src/agent/find", async (importOriginal) => ({ ...(await importOriginal<object>()), huntWish: vi.fn() }));
import { createApp } from "../src/app";
import { migrate, type Db } from "../src/db";
import { huntWish, type HuntResult } from "../src/agent/find";
import type { PriceOption } from "../src/agent/agent";

const clock = new Date("2026-10-30T09:00:00Z");
const PHOTO = "https://upload.wikimedia.org/g-class.jpg";
let db: Db;

const draft = { title: "Mercedes-Benz G-Class in pink", kind: "own", summary: "A pink G-Wagon.", specifics: [], region: "US", currency: "USD", unknowns: [] } as unknown as HuntResult["draft"];
const option = (): PriceOption => ({
  label: "G 550",
  seller: "Mercedes-Benz USA",
  url: "https://www.mbusa.com/en/vehicles/class/g-class",
  upfrontCents: 14_890_000,
  recurring: [],
  source: { currency: "USD", price: 148_900, rate: 1, rateDate: "2026-10-30" },
  status: "verified",
  statusLabel: "Checked on mbusa.com",
  evidence: "$148,900",
  confidence: "high",
  checkedAt: clock.toISOString(),
  totals: { monthlyCents: 0, horizonCents: 14_890_000, spreadMonthlyCents: 0 },
});
const result = (o: PriceOption, provisional: boolean): HuntResult => ({ options: [o], explanation: "", note: "", horizonYears: 10, draft, questions: [], provisional });

beforeEach(async () => {
  const pg = new PGlite();
  db = { query: (t, p) => pg.query(t, p) as never, exec: (s) => pg.exec(s) } as Db;
  await migrate(db);
  vi.mocked(huntWish).mockReset();
});

async function cards() {
  const app = createApp({
    db,
    mailer: { sendCode: async () => {} },
    jwtSecret: "test-secret-that-is-at-least-32-chars-long",
    codePepper: "test-pepper-16-chars",
    now: () => clock,
    webOrigins: [],
    meta: { apiKey: "test", fetch: (async () => new Response("no model call in these tests", { status: 500 })) as unknown as typeof fetch },
    spendCaps: { dailyUsd: 10, totalUsd: 120 },
  });
  const res = await app.request("/guest/wish", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.40" }, body: JSON.stringify({ text: "a pink g wagon" }) });
  return (await res.text())
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => JSON.parse(l.slice(5)))
    .filter((e) => e.type === "priced" || e.type === "error");
}

describe("the guest card after the fast one", () => {
  it("sends the full card when the hunt's photo lands on the very card it showed fast", async () => {
    vi.mocked(huntWish).mockImplementation(async (_meta, ctx) => {
      const card = option();
      await ctx.onProvisional?.(result(card, true));
      // The photo search answers after the fast card went out, and its pick goes on that same object (find.ts withPhoto).
      card.imageUrl = PHOTO;
      card.media = { kind: "vehicle", images: [{ url: PHOTO, source: "commons.wikimedia.org" }] };
      return result(card, false);
    });
    const evs = await cards();
    expect(evs).toHaveLength(2);
    expect(evs[0]).toMatchObject({ provisional: true });
    expect(evs[0].option.imageUrl).toBeUndefined();
    expect(evs[1]).not.toHaveProperty("provisional");
    expect(evs[1].option).toMatchObject({ imageUrl: PHOTO, media: { kind: "vehicle", images: [{ url: PHOTO }] } });
  });

  it("sends nothing more when the full card is the fast card unchanged", async () => {
    vi.mocked(huntWish).mockImplementation(async (_meta, ctx) => {
      const card = option();
      await ctx.onProvisional?.(result(card, true));
      return result(card, false);
    });
    const evs = await cards();
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ provisional: true, option: { upfrontCents: 14_890_000 } });
  });
});
