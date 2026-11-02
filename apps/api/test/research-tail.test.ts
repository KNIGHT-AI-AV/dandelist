import { describe, expect, it } from "vitest";
import { PHOTO_GRACE_MS, researchTail } from "../src/agent/agent";

/** Research's last wait: the summary always gets the time left; a thing to buy's other photos only a grace after it. */
const after = <T>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms));
const never = <T>() => new Promise<T>(() => undefined);
const timed = async <T>(p: Promise<T>) => {
  const t = Date.now();
  const value = await p;
  return { value, ms: Date.now() - t };
};

describe("researchTail", () => {
  it("for a thing to buy, stops waiting for photos a grace after the summary", async () => {
    const { value, ms } = await timed(researchTail(after(20, "summary"), never<void>(), 2_000, true, 60));
    expect(value).toBe("summary");
    expect(ms).toBeGreaterThanOrEqual(70);
    expect(ms).toBeLessThan(600);
  });

  it("for anything else, waits for the photos up to the time left", async () => {
    const { value, ms } = await timed(researchTail(after(20, "summary"), never<void>(), 500, false, 60));
    expect(value).toBe("summary");
    expect(ms).toBeGreaterThanOrEqual(480);
  });

  it("still waits for a summary that is slow, up to the time left, and is null when it never comes", async () => {
    const slow = await timed(researchTail(after(250, "summary"), never<void>(), 2_000, true, 60));
    expect(slow.value).toBe("summary");
    expect(slow.ms).toBeGreaterThanOrEqual(300);
    const none = await timed(researchTail(never<string>(), never<void>(), 300, true, 60));
    expect(none.value).toBeNull();
    expect(none.ms).toBeGreaterThanOrEqual(280);
  });

  it("returns as soon as both are in, and photos that land inside the grace are waited for", async () => {
    const both = await timed(researchTail(after(20, "summary"), after(40, undefined), 2_000, true, 500));
    expect(both.ms).toBeLessThan(300);
    let landed = false;
    await researchTail(after(10, "summary"), after(40, undefined).then(() => void (landed = true)), 2_000, true, 500);
    expect(landed).toBe(true);
  });

  it("gives a summary that fails the same grace, and leaves its error to the caller as before", async () => {
    await expect(researchTail(Promise.reject(new Error("model down")), never<void>(), 2_000, true, 60)).rejects.toThrow("model down");
  });

  it("uses a grace of a few seconds by default", () => {
    expect(PHOTO_GRACE_MS).toBe(3_000);
  });
});
