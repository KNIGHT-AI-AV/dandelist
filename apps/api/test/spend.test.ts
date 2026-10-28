import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate, type Db } from "../src/db";
import { HOLD_USD, SpendLimitError, assertBudget, withHold } from "../src/spend";

describe("spend holds", () => {
  let db: Db;
  const now = new Date("2026-10-27T18:00:00Z");
  const caps = { dailyUsd: 10, totalUsd: 120 };
  beforeEach(async () => {
    const lite = new PGlite();
    db = { query: (t, p) => lite.query(t, p) as never, exec: (s) => lite.exec(s) };
    await migrate(db);
  });
  const spend = (usd: number) =>
    db.query("insert into spend_ledger (user_id, model, kind, input_tokens, output_tokens, searches, cost_usd, created_at) values (null, 'muse-spark-1.3', 'test', 0, 0, 0, $1, $2)", [usd.toFixed(6), now.toISOString()]);

  it("lets one call through with room under the cap", async () => {
    await spend(9.5);
    await expect(withHold(() => assertBudget(db, caps, now), async () => "ok")).resolves.toBe("ok");
  });

  it("never lets calls that start together overshoot the cap", async () => {
    await spend(10 - HOLD_USD * 1.5);
    const call = () => withHold(() => assertBudget(db, caps, now), async () => "ok");
    const results = await Promise.allSettled([call(), call(), call()]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBeLessThanOrEqual(1);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof SpendLimitError)).toBe(true);
  });

  it("refuses a call whose hold alone would pass the cap", async () => {
    await spend(10 - HOLD_USD / 2);
    await expect(withHold(() => assertBudget(db, caps, now), async () => "ok")).rejects.toBeInstanceOf(SpendLimitError);
  });
});
