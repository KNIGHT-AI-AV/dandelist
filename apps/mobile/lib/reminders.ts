/**
 * What the phone's own notifications say and when (owner, 2026-10-29: "daily item suggestions with notifications" and
 * "ping them randomly every so often to add to the list, whatever's reasonable throughout a week"; the coordinator's
 * research brief of the same day sets the numbers). Everything is planned here, on the phone, each time the app opens;
 * nothing comes from a server. Pure, so it is tested without a phone; lib/notifications.ts hands the plan to the OS.
 *
 * - Today's pick: once a day at the person's time (9:00 by default), passive on iOS. After three in a row go untapped
 *   it drops to three a week, and back to daily once one is tapped.
 * - The nudge: at most once a week, on a random day between 11:00 and 19:00, never within a day of opening the app,
 *   never within a week of adding a wish or of the last nudge, and never within 90 minutes of a pick. The copy rotates.
 * - Quiet: nothing is planned past a week from the last open. If the app stays closed that long, one gentle note says
 *   the picks will wait, and nothing more comes until it opens again.
 */

export type ReminderKind = "pick" | "nudge" | "pause";

export interface ReminderPrefs {
  /** Today's pick, on or off. */
  daily: boolean;
  /** Its time, local: 0 to 23 and 0 or 30. */
  hour: number;
  minute: number;
  nudges: "off" | "weekly";
}

/** Before anyone chooses: on, at 9:00, nudges once a week. Nothing is scheduled until they say yes. */
export const DEFAULT_PREFS: ReminderPrefs = { daily: true, hour: 9, minute: 0, nudges: "weekly" };

export interface Planned {
  /** One per kind and local day, like "pick-2026-10-30". */
  id: string;
  kind: ReminderKind;
  at: Date;
  title: string | null;
  body: string;
  /** iOS delivers it quietly, without lighting the screen. */
  passive: boolean;
}

export interface Delivered {
  id: string;
  kind: ReminderKind;
  /** ISO time it was due. */
  at: string;
  tapped: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Nothing is planned further ahead than this from the last open. */
export const QUIET_AFTER_MS = 7 * DAY_MS;
/** Untapped picks in a row before they drop to three a week. */
export const UNTAPPED_TO_SLOW = 3;
/** The days a slowed pick comes, counted from tomorrow: three a week. */
const SLOW_DAYS = [1, 3, 5];
/** The nudge's hours, local. */
export const NUDGE_FROM = 11;
export const NUDGE_UNTIL = 19;
/** A nudge stays this far from a pick on the same day. */
const APART_MS = 90 * 60 * 1000;
/** Delivered notifications kept to learn from: enough for the last three picks and the last nudge, small to store. */
const KEEP_DELIVERED = 8;

export const PICK_TITLE = "Today's pick";
export const pickBody = (dandyName: string) => `${dandyName} found something new for your list.`;
export const PAUSE_BODY = "We'll hold your daily picks until you're back.";
/** The nudge's lines, in turn. */
export const nudgeLines = (dandyName: string) => [
  "Seen something lately you'd love? Add it to your list.",
  "Anything catch your eye this week? Your list has room for it.",
  `Spotted something you want? Tell ${dandyName} and it goes on your list.`,
  "A place, a thing, a moment you'd love? Add it while it's fresh.",
];

/** The local date of `d`, YYYY-MM-DD. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** `days` local days after `d`'s date, at `hour`:`minute` local (the wall clock, so summer time changes nothing). */
const onDay = (d: Date, days: number, hour: number, minute = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, hour, minute, 0, 0);

/** Three picks in a row went untapped: they come three times a week until one is tapped. */
export function picksSlowed(delivered: Delivered[]): boolean {
  const picks = delivered.filter((d) => d.kind === "pick").slice(-UNTAPPED_TO_SLOW);
  return picks.length === UNTAPPED_TO_SLOW && picks.every((d) => !d.tapped);
}

/**
 * What was planned at the last open and has come due since was delivered; a tap was recorded by its id. Due ones join
 * `delivered` (the newest are kept), the rest were cancelled by this open. `nudges` counts the nudges newly delivered,
 * so their lines keep turning however many picks come between.
 */
export function settle(planned: { id: string; kind: ReminderKind; at: string }[], delivered: Delivered[], tapped: Iterable<string>, now: Date): { delivered: Delivered[]; nudges: number } {
  const taps = new Set(tapped);
  const seen = new Set(delivered.map((d) => d.id));
  const due = planned.filter((p) => new Date(p.at).getTime() <= now.getTime() && !seen.has(p.id)).sort((a, b) => a.at.localeCompare(b.at));
  const next = [...delivered.map((d) => (taps.has(d.id) && !d.tapped ? { ...d, tapped: true } : d)), ...due.map((p) => ({ id: p.id, kind: p.kind, at: p.at, tapped: taps.has(p.id) }))];
  return { delivered: next.slice(-KEEP_DELIVERED), nudges: due.filter((p) => p.kind === "nudge").length };
}

export interface PlanInput {
  now: Date;
  prefs: ReminderPrefs;
  delivered: Delivered[];
  /** When their newest wish was added, if they have one. */
  lastWishAt: Date | null;
  /** Nudges delivered so far, which picks the next nudge's line. */
  nudgesSent: number;
  dandyName: string;
  /** 0 to 1; the nudge's day and time. */
  random: () => number;
}

/** Everything to schedule from this open, soonest first. */
export function planReminders(input: PlanInput): Planned[] {
  const { now, prefs, delivered, dandyName } = input;
  const horizon = now.getTime() + QUIET_AFTER_MS;
  const out: Planned[] = [];

  if (prefs.daily) {
    const days = picksSlowed(delivered) ? SLOW_DAYS : [1, 2, 3, 4, 5, 6, 7];
    for (const d of days) {
      const at = onDay(now, d, prefs.hour, prefs.minute);
      if (at.getTime() < horizon) out.push({ id: `pick-${dayKey(at)}`, kind: "pick", at, title: PICK_TITLE, body: pickBody(dandyName), passive: true });
    }
    // A week without an open: one note at the first pick time past it, and nothing after.
    for (let d = 7; d <= 8; d++) {
      const at = onDay(now, d, prefs.hour, prefs.minute);
      if (at.getTime() >= horizon) {
        out.push({ id: `pause-${dayKey(at)}`, kind: "pause", at, title: null, body: PAUSE_BODY, passive: true });
        break;
      }
    }
  }

  if (prefs.nudges === "weekly") {
    const lastNudge = [...delivered].reverse().find((d) => d.kind === "nudge");
    const earliest = Math.max(now.getTime() + DAY_MS, input.lastWishAt ? input.lastWishAt.getTime() + 7 * DAY_MS : 0, lastNudge ? new Date(lastNudge.at).getTime() + 7 * DAY_MS : 0);
    const at = nudgeTime(now, earliest, horizon, out.filter((p) => p.kind === "pick").map((p) => p.at.getTime()), input.random);
    if (at) {
      const lines = nudgeLines(dandyName);
      out.push({ id: `nudge-${dayKey(at)}`, kind: "nudge", at, title: null, body: lines[input.nudgesSent % lines.length]!, passive: false });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** A random minute between 11:00 and 19:00 local within [earliest, latest), kept 90 minutes from any pick; or null. */
export function nudgeTime(now: Date, earliest: number, latest: number, picks: number[], random: () => number): Date | null {
  if (earliest >= latest) return null;
  const days: [number, number][][] = [];
  for (let d = 0; d <= 8; d++) {
    let spans: [number, number][] = [[Math.max(onDay(now, d, NUDGE_FROM).getTime(), earliest), Math.min(onDay(now, d, NUDGE_UNTIL).getTime(), latest)]];
    for (const pick of picks) spans = spans.flatMap(([a, b]) => [[a, Math.min(b, pick - APART_MS)], [Math.max(a, pick + APART_MS), b]] as [number, number][]);
    spans = spans.filter(([a, b]) => b - a >= 60_000);
    if (spans.length) days.push(spans);
  }
  if (!days.length) return null;
  const spans = days[Math.min(days.length - 1, Math.floor(random() * days.length))]!;
  const total = spans.reduce((sum, [a, b]) => sum + (b - a), 0);
  let x = random() * total;
  for (let i = 0; i < spans.length; i++) {
    const [a, b] = spans[i]!;
    if (x < b - a || i === spans.length - 1) {
      // On a whole minute inside the span (every span is at least a minute long, so it holds one).
      const t = Math.ceil(Math.min(a + x, b - 1) / 60_000) * 60_000;
      return new Date(t < b ? t : Math.ceil(a / 60_000) * 60_000);
    }
    x -= b - a;
  }
  return null;
}

/** The soft ask before the system's own: once there is a wish, never on the first launch, and "Not now" waits a month (twice at most). */
export interface AskState {
  answer: "yes" | "later";
  at: string;
  laters: number;
}
export const ASK_AGAIN_MS = 30 * DAY_MS;
export const MAX_LATERS = 2;

export function shouldAsk(input: { available: boolean; permission: Permission; wishes: number; firstLaunch: boolean; ask: AskState | null; now: Date }): boolean {
  if (!input.available || input.firstLaunch || input.wishes < 1) return false;
  if (input.permission !== "undetermined") return false;
  const a = input.ask;
  if (!a) return true;
  if (a.answer === "yes") return false;
  return a.laters < MAX_LATERS && input.now.getTime() - new Date(a.at).getTime() >= ASK_AGAIN_MS;
}

/** What the phone allows: provisional is iOS's quiet delivery, until the person chooses Keep. */
export type Permission = "granted" | "provisional" | "denied" | "undetermined";
export const mayNotify = (p: Permission) => p === "granted" || p === "provisional";

/** A time for settings, like "9:00" or "18:30". */
export const timeLabel = (hour: number, minute: number) => `${hour}:${String(minute).padStart(2, "0")}`;
/** The pick's time half an hour earlier or later, kept between 6:00 and 22:00. */
export function stepTime(hour: number, minute: number, by: -1 | 1): { hour: number; minute: number } {
  const m = Math.min(22 * 60, Math.max(6 * 60, hour * 60 + minute + by * 30));
  return { hour: Math.floor(m / 60), minute: m % 60 };
}
