import { describe, expect, it } from "vitest";
import { GRACE_MS, graceAfter, keepsGrace, needsConfirm } from "./remove-confirm";

describe("asking before a wish is removed (owner, 2026-10-31)", () => {
  it("asks the first time", () => {
    expect(needsConfirm(0, 1_000)).toBe(true);
  });

  it("lets removals through without asking for two minutes after a yes, then asks again", () => {
    const yes = 10_000;
    const until = graceAfter(yes);
    expect(until - yes).toBe(GRACE_MS);
    expect(needsConfirm(until, yes + 60_000)).toBe(false);
    expect(needsConfirm(until, yes + GRACE_MS - 1)).toBe(false);
    expect(needsConfirm(until, yes + GRACE_MS)).toBe(true);
  });

  it("keeps the window on the list and Details, and closes it anywhere else", () => {
    expect(keepsGrace("list")).toBe(true);
    expect(keepsGrace("details")).toBe(true);
    expect(keepsGrace("chat")).toBe(false);
    expect(keepsGrace("money")).toBe(false);
    expect(keepsGrace("settings")).toBe(false);
  });
});
