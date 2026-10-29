import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate, type Db } from "../src/db";
import { HOLD_USD, MAX_INFLIGHT_PER_USER, SpendLimitError, assertBudget, heldForScope, withBudgetScope, withHold } from "../src/spend";

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

  it("caps one person's calls in flight, so nobody can lock the budget for everyone", async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const mine = Array.from({ length: MAX_INFLIGHT_PER_USER }, () => withHold(async () => {}, () => gate, "user-a"));
    await expect(withHold(async () => {}, async () => "ok", "user-a")).rejects.toBeInstanceOf(SpendLimitError);
    await expect(withHold(async () => {}, async () => "ok", "user-b")).resolves.toBe("ok");
    open();
    await Promise.all(mine);
    await expect(withHold(async () => {}, async () => "ok", "user-a")).resolves.toBe("ok");
  });

  it("counts concurrent feature calls together while keeping guest and preview allowances separate", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const guard = async () => {
      if (2.85 + heldForScope("guest") > 3) throw new SpendLimitError("daily");
    };
    const first = withBudgetScope("guest", guard, () => gate);
    try {
      await expect(withBudgetScope("guest", guard, async () => "wrong")).rejects.toBeInstanceOf(SpendLimitError);
      await expect(withBudgetScope("preview", async () => {}, async () => heldForScope("guest"))).resolves.toBeCloseTo(HOLD_USD);
      expect(heldForScope("guest")).toBeCloseTo(HOLD_USD);
    } finally {
      release();
      await first;
    }
    expect(heldForScope("guest")).toBe(0);
    expect(heldForScope("preview")).toBe(0);
  });

  it("releases feature and global reservations on a failed provider or guard", async () => {
    const failure = new Error("provider failed");
    await expect(withBudgetScope("guest", async () => {}, async () => { throw failure; })).rejects.toBe(failure);
    await expect(withBudgetScope("guest", async () => { throw failure; }, async () => "wrong")).rejects.toBe(failure);
    expect(heldForScope("guest")).toBe(0);
    await spend(10 - HOLD_USD);
    await expect(withHold(() => assertBudget(db, caps, now), async () => "ok")).resolves.toBe("ok");
  });
});
