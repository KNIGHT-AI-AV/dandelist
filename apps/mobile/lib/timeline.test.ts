import { describe, expect, it } from "vitest";
import { DEFAULT_TIMELINE_MONTHS, TIMELINE_LABELS, TIMELINE_MONTHS, firmTimelineStep, timelineWords } from "./timeline";

describe("the wish page's timeline (owner, 2026-10-31)", () => {
  it("counts in months up to three years, then in years", () => {
    expect(timelineWords(1)).toBe("1 month");
    expect(timelineWords(18)).toBe("18 months");
    expect(timelineWords(36)).toBe("36 months");
    expect(timelineWords(48)).toBe("4 years");
    expect(timelineWords(120)).toBe("10 years");
  });

  it("has every month to a year, rising notches to ten years, and starts at five years", () => {
    expect(TIMELINE_MONTHS.slice(0, 12)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(TIMELINE_MONTHS.every((m, i) => i === 0 || m > TIMELINE_MONTHS[i - 1]!)).toBe(true);
    expect(TIMELINE_MONTHS.at(-1)).toBe(120);
    expect(TIMELINE_MONTHS).toContain(DEFAULT_TIMELINE_MONTHS);
    expect(TIMELINE_LABELS.every((l) => TIMELINE_MONTHS.includes(l.cents))).toBe(true);
  });

  it("lands whole years and the step into years with the firmer haptic", () => {
    expect(firmTimelineStep(11, 12)).toBe(true);
    expect(firmTimelineStep(36, 48)).toBe(true);
    expect(firmTimelineStep(5, 6)).toBe(false);
  });
});
