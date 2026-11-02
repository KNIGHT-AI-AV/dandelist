import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate, type Db } from "../src/db";
import { JUDGING, SpendLimitError, assertBudget, dailyCapUsd, userCapUsd } from "../src/spend";

/**
 * Judging week (owner, 2026-11-02: "Yes, $30 for Nov 4-8"): the service's daily cap is $30 on those UTC days, so
 * judges (60% of it) and visitors aren't stopped mid-judging, and it goes back to SPEND_DAILY_USD by itself after.
 * The all-time cap is untouched.
 */
describe("the judging-week daily cap", () => {
  const caps = { dailyUsd: 10, totalUsd: 120 };
  let db: Db;
  beforeEach(async () => {
    const lite = new PGlite();
    db = { query: (t, p) => lite.query(t, p) as never, exec: (s) => lite.exec(s) };
    await migrate(db);
  });
  const spend = (usd: number, at: Date) =>
    db.query("insert into spend_ledger (user_id, model, kind, input_tokens, output_tokens, searches, cost_usd, created_at) values (null, 'muse-spark-1.3', 'test', 0, 0, 0, $1, $2)", [usd.toFixed(6), at.toISOString()]);

  it("is $30 from the first second of Nov 4 to the last of Nov 9 (UTC, so all of Nov 8 in the US), and the set cap either side", () => {
    expect(JUDGING).toEqual({ from: "2026-11-04", to: "2026-11-09", dailyUsd: 30 });
    expect(dailyCapUsd(caps, new Date("2026-11-03T23:59:59.999Z"))).toBe(10);
    expect(dailyCapUsd(caps, new Date("2026-11-04T00:00:00.000Z"))).toBe(30);
    expect(dailyCapUsd(caps, new Date("2026-11-06T12:00:00Z"))).toBe(30);
    expect(dailyCapUsd(caps, new Date("2026-11-08T23:59:59.999Z"))).toBe(30);
    // 11:59 pm on Nov 8 in Los Angeles is 07:59 on Nov 9 UTC.
    expect(dailyCapUsd(caps, new Date("2026-11-09T07:59:00.000Z"))).toBe(30);
    expect(dailyCapUsd(caps, new Date("2026-11-09T23:59:59.999Z"))).toBe(30);
    expect(dailyCapUsd(caps, new Date("2026-11-10T00:00:00.000Z"))).toBe(10);
  });

  it("never lowers a cap that is already set higher", () => {
    expect(dailyCapUsd({ dailyUsd: 50, totalUsd: 120 }, new Date("2026-11-05T12:00:00Z"))).toBe(50);
  });

  it("lets a call through past $10 during judging, and refuses it the day before and the day after", async () => {
    const during = new Date("2026-11-05T15:00:00Z");
    await spend(12, during);
    await expect(assertBudget(db, caps, during)).resolves.toBeUndefined();
    const before = new Date("2026-11-03T15:00:00Z");
    await spend(12, before);
    await expect(assertBudget(db, caps, before)).rejects.toBeInstanceOf(SpendLimitError);
    const after = new Date("2026-11-10T15:00:00Z");
    await spend(12, after);
    await expect(assertBudget(db, caps, after)).rejects.toBeInstanceOf(SpendLimitError);
  });

  it("still stops every call at the all-time cap, judging or not", async () => {
    const during = new Date("2026-11-05T15:00:00Z");
    await spend(120, new Date("2026-11-01T12:00:00Z"));
    await expect(assertBudget(db, caps, during)).rejects.toMatchObject({ scope: "total" });
  });

  it("gives the judge account 60% of the judging cap ($18) on those days, $6 otherwise; one person's allowance is unchanged", async () => {
    const id = async (email: string) => (await db.query<{ id: string }>("insert into users (email) values ($1) returning id", [email])).rows[0]!.id;
    const judge = { email: "judge@dandelist.com" };
    const judgeId = await id("judge@dandelist.com");
    const ada = await id("ada@example.com");
    expect(await userCapUsd(db, judgeId, 2, judge, caps, new Date("2026-11-05T12:00:00Z"))).toBeCloseTo(18);
    expect(await userCapUsd(db, judgeId, 2, judge, caps, new Date("2026-11-02T12:00:00Z"))).toBeCloseTo(6);
    expect(await userCapUsd(db, ada, 2, judge, caps, new Date("2026-11-05T12:00:00Z"))).toBe(2);
    // Claude's own caps (under.ts) are given no clock, so judging never lifts its $5 day: the judge gets 60% of $5.
    expect(await userCapUsd(db, judgeId, 2, judge, { dailyUsd: 5, totalUsd: Number.POSITIVE_INFINITY })).toBeCloseTo(3);
  });
});
