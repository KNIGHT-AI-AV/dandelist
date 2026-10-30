import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFS,
  NUDGE_FROM,
  NUDGE_UNTIL,
  PAUSE_BODY,
  QUIET_AFTER_MS,
  nudgeLines,
  nudgeTime,
  picksSlowed,
  planReminders,
  settle,
  shouldAsk,
  stepTime,
  timeLabel,
  type Delivered,
  type PlanInput,
} from "./reminders";

// Local wall-clock dates in early October 2026, clear of every summer time change.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute);
const DAY = 24 * 60 * 60 * 1000;
/** A repeatable stream of numbers in [0, 1). */
const seq = (seed: number) => () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const plan = (change: Partial<PlanInput> = {}) => planReminders({ now: at(5, 20), prefs: DEFAULT_PREFS, delivered: [], lastWishAt: null, nudgesSent: 0, dandyName: "Hugo", random: seq(7), ...change });
const picks = (d: Delivered[] | undefined = undefined) => plan(d ? { delivered: d } : {}).filter((n) => n.kind === "pick");
const delivered = (kind: Delivered["kind"], day: number, tapped = false, hour = 9): Delivered => ({ id: `${kind}-${day}`, kind, at: at(day, hour).toISOString(), tapped });

describe("today's pick notification", () => {
  it("comes each morning at the person's time for the week after an open, quietly", () => {
    const list = picks();
    expect(list.map((n) => [n.at.getDate(), n.at.getHours(), n.at.getMinutes()])).toEqual([6, 7, 8, 9, 10, 11, 12].map((d) => [d, 9, 0]));
    expect(list.every((n) => n.passive && n.title === "Today's pick" && n.body === "Hugo found something new for your list.")).toBe(true);
    expect(list[0]!.id).toBe("pick-2026-10-06");
    // Opened before nine: the week's last morning is past the quiet line, so six picks.
    expect(plan({ now: at(5, 7) }).filter((n) => n.kind === "pick").map((n) => n.at.getDate())).toEqual([6, 7, 8, 9, 10, 11]);
    const late = plan({ prefs: { ...DEFAULT_PREFS, hour: 18, minute: 30 } }).filter((n) => n.kind === "pick");
    expect(late.map((n) => n.at.getHours() * 60 + n.at.getMinutes())).toEqual(Array(7).fill(18 * 60 + 30));
  });

  it("drops to three a week after three untapped, and comes back daily once one is tapped", () => {
    const three = [delivered("pick", 2), delivered("pick", 3), delivered("pick", 4)];
    expect(picksSlowed(three)).toBe(true);
    expect(picks(three).map((n) => n.at.getDate())).toEqual([6, 8, 10]);
    const tapped = [delivered("pick", 2), delivered("pick", 3, true), delivered("pick", 4)];
    expect(picksSlowed(tapped)).toBe(false);
    expect(picks(tapped)).toHaveLength(7);
    expect(picksSlowed([delivered("pick", 3), delivered("pick", 4)])).toBe(false);
    // Nudges between them don't count either way.
    expect(picksSlowed([...three, delivered("nudge", 4, true, 12)])).toBe(true);
  });

  it("is off when the person turns it off, pause note and all", () => {
    expect(plan({ prefs: { ...DEFAULT_PREFS, daily: false } }).filter((n) => n.kind !== "nudge")).toEqual([]);
  });
});

describe("the quiet week", () => {
  it("plans nothing past a week from the open, and one note that the picks will wait", () => {
    const list = plan();
    const pause = list.filter((n) => n.kind === "pause");
    expect(pause).toHaveLength(1);
    expect(pause[0]).toMatchObject({ title: null, body: PAUSE_BODY, passive: true });
    expect([pause[0]!.at.getDate(), pause[0]!.at.getHours()]).toEqual([13, 9]);
    expect(pause[0]!.at.getTime()).toBeGreaterThanOrEqual(at(5, 20).getTime() + QUIET_AFTER_MS);
    // Everything else falls inside the week, and the note is the last thing planned.
    expect(list.at(-1)).toBe(pause[0]);
    for (const n of list.slice(0, -1)) expect(n.at.getTime()).toBeLessThan(at(5, 20).getTime() + QUIET_AFTER_MS);
    expect(plan({ now: at(5, 7) }).find((n) => n.kind === "pause")!.at.getDate()).toBe(12);
  });
});

describe("the nudge", () => {
  const nudge = (change: Partial<PlanInput> = {}) => plan(change).filter((n) => n.kind === "nudge");

  it("comes at most once a week, between 11:00 and 19:00, never within a day of the open", () => {
    for (let seed = 1; seed < 60; seed++) {
      const list = nudge({ random: seq(seed) });
      expect(list).toHaveLength(1);
      const n = list[0]!;
      const minutes = n.at.getHours() * 60 + n.at.getMinutes();
      expect(minutes).toBeGreaterThanOrEqual(NUDGE_FROM * 60);
      expect(minutes).toBeLessThan(NUDGE_UNTIL * 60);
      expect(n.at.getSeconds()).toBe(0);
      expect(n.at.getTime()).toBeGreaterThanOrEqual(at(5, 20).getTime() + DAY);
      expect(n.at.getTime()).toBeLessThan(at(5, 20).getTime() + QUIET_AFTER_MS);
      expect(n.passive).toBe(false);
    }
    // Different days over different opens.
    expect(new Set(Array.from({ length: 30 }, (_, i) => nudge({ random: seq(i + 1) })[0]!.at.getDate())).size).toBeGreaterThan(3);
  });

  it("waits a week after a wish is added and a week after the last nudge", () => {
    const afterWish = nudge({ lastWishAt: at(4, 20) });
    expect(afterWish).toHaveLength(1);
    expect(afterWish[0]!.at.getTime()).toBeGreaterThanOrEqual(at(11, 20).getTime());
    expect(afterWish[0]!.at.getDate()).toBe(12);
    // Added a wish an hour ago: no nudge this week at all.
    expect(nudge({ lastWishAt: at(5, 19) })).toEqual([]);
    const afterNudge = nudge({ delivered: [delivered("nudge", 3, false, 12)] });
    expect(afterNudge[0]!.at.getTime()).toBeGreaterThanOrEqual(at(10, 12).getTime());
    expect(nudge({ prefs: { ...DEFAULT_PREFS, nudges: "off" } })).toEqual([]);
  });

  it("keeps an hour and a half from a pick on the same day", () => {
    const prefs = { ...DEFAULT_PREFS, hour: 15, minute: 0 };
    for (let seed = 1; seed < 80; seed++) {
      const n = nudge({ prefs, random: seq(seed) })[0]!;
      const minutes = n.at.getHours() * 60 + n.at.getMinutes();
      expect(minutes < 13 * 60 + 30 || minutes >= 16 * 60 + 30, `${n.at}`).toBe(true);
    }
    expect(nudgeTime(at(5, 20), at(6, 11).getTime(), at(6, 12).getTime(), [at(6, 11, 30).getTime()], seq(1))).toBeNull();
    expect(nudgeTime(at(5, 20), at(7, 0).getTime(), at(6, 0).getTime(), [], seq(1))).toBeNull();
  });

  it("says something different each time, in the Dandy's name where it names it", () => {
    const lines = nudgeLines("Hugo");
    expect(lines).toHaveLength(4);
    expect(lines[2]).toBe("Spotted something you want? Tell Hugo and it goes on your list.");
    expect(nudge()[0]!.body).toBe(lines[0]);
    expect(nudge({ nudgesSent: 1 })[0]!.body).toBe(lines[1]);
    expect(nudge({ nudgesSent: 5 })[0]!.body).toBe(lines[1]);
  });
});

describe("what was delivered and tapped", () => {
  it("counts what came due as delivered, with its tap, and keeps the newest", () => {
    const planned = [
      { id: "pick-2026-10-06", kind: "pick" as const, at: at(6, 9).toISOString() },
      { id: "nudge-2026-10-07", kind: "nudge" as const, at: at(7, 14).toISOString() },
      { id: "pick-2026-10-08", kind: "pick" as const, at: at(8, 9).toISOString() },
    ];
    const out = settle(planned, [], ["pick-2026-10-06"], at(7, 20));
    expect(out).toEqual({
      delivered: [
        { id: "pick-2026-10-06", kind: "pick", at: planned[0]!.at, tapped: true },
        { id: "nudge-2026-10-07", kind: "nudge", at: planned[1]!.at, tapped: false },
      ],
      nudges: 1,
    });
    // A tap seen later marks one already delivered; nothing is counted twice.
    const again = settle(planned.slice(0, 2), out.delivered, ["nudge-2026-10-07"], at(8, 8));
    expect(again.delivered.map((d) => [d.id, d.tapped])).toEqual([["pick-2026-10-06", true], ["nudge-2026-10-07", true]]);
    expect(again.nudges).toBe(0);
    const many = settle(Array.from({ length: 20 }, (_, i) => ({ id: `pick-${i}`, kind: "pick" as const, at: new Date(at(1, 9).getTime() + i * 60_000).toISOString() })), [], [], at(2, 9)).delivered;
    expect(many).toHaveLength(8);
    expect(many.at(-1)!.id).toBe("pick-19");
  });
});

describe("the ask", () => {
  const base = { available: true, permission: "undetermined" as const, wishes: 1, firstLaunch: false, ask: null, now: at(5, 12) };
  it("comes after the first wish, never on the first launch, and only where it can do something", () => {
    expect(shouldAsk(base)).toBe(true);
    expect(shouldAsk({ ...base, wishes: 0 })).toBe(false);
    expect(shouldAsk({ ...base, firstLaunch: true })).toBe(false);
    expect(shouldAsk({ ...base, available: false })).toBe(false);
    expect(shouldAsk({ ...base, permission: "granted" })).toBe(false);
    expect(shouldAsk({ ...base, permission: "provisional" })).toBe(false);
    expect(shouldAsk({ ...base, permission: "denied" })).toBe(false);
  });

  it("waits a month after Not now, twice at most, and never comes back after Yes", () => {
    expect(shouldAsk({ ...base, ask: { answer: "yes", at: at(1, 12).toISOString(), laters: 0 } })).toBe(false);
    const later = { answer: "later" as const, at: at(1, 12).toISOString(), laters: 1 };
    expect(shouldAsk({ ...base, ask: later })).toBe(false);
    expect(shouldAsk({ ...base, ask: later, now: new Date(at(1, 12).getTime() + 30 * DAY) })).toBe(true);
    expect(shouldAsk({ ...base, ask: { ...later, laters: 2 }, now: new Date(at(1, 12).getTime() + 90 * DAY) })).toBe(false);
  });
});

describe("the pick's time in Settings", () => {
  it("moves by half an hour between 6:00 and 22:00, and reads plainly", () => {
    expect(stepTime(9, 0, 1)).toEqual({ hour: 9, minute: 30 });
    expect(stepTime(9, 0, -1)).toEqual({ hour: 8, minute: 30 });
    expect(stepTime(6, 0, -1)).toEqual({ hour: 6, minute: 0 });
    expect(stepTime(22, 0, 1)).toEqual({ hour: 22, minute: 0 });
    expect(timeLabel(9, 0)).toBe("9:00");
    expect(timeLabel(18, 30)).toBe("18:30");
  });
});
