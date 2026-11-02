import { describe, expect, it } from "vitest";
import { PHOTO_GRACE_MS, researchTail } from "../src/agent/agent";

/**
 * Research's last wait: the summary always gets the time left; a thing to buy whose own photo search found a checked
 * photo gives its options' photo hunt only a grace after the summary.
 */
const after = <T>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms));
const never = <T>() => new Promise<T>(() => undefined);
const timed = async <T>(p: Promise<T>) => {
  const t = Date.now();
  const value = await p;
  return { value, ms: Date.now() - t };
};

describe("researchTail", () => {
  it("with the hunt's photo found, stops waiting for the options' photos a grace after the summary", async () => {
    const { value, ms } = await timed(researchTail(after(20, "summary"), never<void>(), 2_000, Promise.resolve(true), 60));
    expect(value).toBe("summary");
    expect(ms).toBeGreaterThanOrEqual(70);
    expect(ms).toBeLessThan(600);
  });

  it("counts the grace from whichever comes last, the summary or the found photo", async () => {
    const { ms } = await timed(researchTail(after(20, "summary"), never<void>(), 2_000, after(200, true), 60));
    expect(ms).toBeGreaterThanOrEqual(250);
    expect(ms).toBeLessThan(800);
  });

  it("waits the whole time when the hunt's own search found no photo, since the first option may need this hunt's", async () => {
    const { value, ms } = await timed(researchTail(after(20, "summary"), never<void>(), 500, Promise.resolve(false), 60));
    expect(value).toBe("summary");
    expect(ms).toBeGreaterThanOrEqual(480);
  });

  it("waits the whole time while the hunt's own search is still out, and when its answer fails", async () => {
    const out = await timed(researchTail(after(20, "summary"), never<void>(), 400, never<boolean>(), 60));
    expect(out.ms).toBeGreaterThanOrEqual(380);
    const failed = await timed(researchTail(after(20, "summary"), never<void>(), 400, Promise.reject(new Error("no")), 60));
    expect(failed.ms).toBeGreaterThanOrEqual(380);
  });

  it("for anything but a thing to buy (no covered promise), waits for the photos up to the time left", async () => {
    const { value, ms } = await timed(researchTail(after(20, "summary"), never<void>(), 500, null, 60));
    expect(value).toBe("summary");
    expect(ms).toBeGreaterThanOrEqual(480);
  });

  it("still waits for a summary that is slow, up to the time left, and is null when it never comes", async () => {
    const slow = await timed(researchTail(after(250, "summary"), never<void>(), 2_000, Promise.resolve(true), 60));
    expect(slow.value).toBe("summary");
    expect(slow.ms).toBeGreaterThanOrEqual(300);
    const none = await timed(researchTail(never<string>(), never<void>(), 300, Promise.resolve(true), 60));
    expect(none.value).toBeNull();
    expect(none.ms).toBeGreaterThanOrEqual(280);
  });

  it("returns as soon as both are in, and photos that land inside the grace are waited for", async () => {
    const both = await timed(researchTail(after(20, "summary"), after(40, undefined), 2_000, Promise.resolve(true), 500));
    expect(both.ms).toBeLessThan(300);
    let landed = false;
    await researchTail(after(10, "summary"), after(40, undefined).then(() => void (landed = true)), 2_000, Promise.resolve(true), 500);
    expect(landed).toBe(true);
  });

  it("never waits for the hunt's own search once the options' photos are done", async () => {
    const { value, ms } = await timed(researchTail(after(20, "summary"), after(30, undefined), 2_000, never<boolean>(), 60));
    expect(value).toBe("summary");
    expect(ms).toBeLessThan(300);
  });

  it("gives a summary that fails the same grace, and leaves its error to the caller as before", async () => {
    await expect(researchTail(Promise.reject(new Error("model down")), never<void>(), 2_000, Promise.resolve(true), 60)).rejects.toThrow("model down");
  });

  it("uses a grace of a few seconds by default", () => {
    expect(PHOTO_GRACE_MS).toBe(3_000);
  });
});
