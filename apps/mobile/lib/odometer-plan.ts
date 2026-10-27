/**
 * The odometer's arithmetic, kept free of React Native so it can be tested (UI audit §2). The component in
 * `components/odometer.tsx` turns these plans into Animated values.
 *
 * A figure is a row of cells keyed by place value: `d0` is the units digit, `d1` the tens, `s3` the thousands
 * comma, `dot` the decimal point, `f1`/`f2` the cents, `prefix` the `$`. Keys never depend on string length, so the
 * units wheel stays the units wheel when the figure grows from $9,999 to $10,000 and nothing remounts.
 */

export type Mode = "ui" | "cinema" | "instant";
export type Trend = 1 | -1;

/** Each wheel is one column of 0–9 repeated; it rests in lines REST…REST+9 and can travel ±40 lines from there. */
export const REPEATS = 9;
export const REST = 40;

/** Solves a CSS cubic-bezier for y at x, like Easing.bezier, without React Native. */
export function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - x;
      const d = dx(t);
      if (Math.abs(err) < 1e-6) return sy(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      if (sx(t) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

export const EXPO = bezier(0.16, 1, 0.3, 1);

export type CellKind = "digit" | "sep" | "dot" | "prefix" | "suffix";
export interface Cell {
  key: string;
  kind: CellKind;
  char: string;
  /** Digits only. */
  digit?: number;
  /** Left-to-right sort position: larger is further left. */
  place: number;
}

/** Splits a formatted figure ("$107,529", "$49.99") into place-keyed cells. */
export function cellsOf(text: string): Cell[] {
  const m = text.match(/^([^0-9]*)([0-9][0-9,]*)(\.([0-9]+))?(.*)$/);
  if (!m) return text ? [{ key: "prefix", kind: "prefix", char: text, place: 1e6 }] : [];
  const [, pre, int, , frac = "", suf] = m;
  const cells: Cell[] = [];
  if (pre) cells.push({ key: "prefix", kind: "prefix", char: pre, place: 1e6 });
  let digitsRight = 0;
  const intCells: Cell[] = [];
  for (let i = int!.length - 1; i >= 0; i--) {
    const ch = int![i]!;
    if (ch === ",") intCells.push({ key: `s${digitsRight}`, kind: "sep", char: ch, place: 2 * digitsRight - 1 });
    else {
      intCells.push({ key: `d${digitsRight}`, kind: "digit", char: ch, digit: Number(ch), place: 2 * digitsRight });
      digitsRight++;
    }
  }
  cells.push(...intCells.reverse());
  if (frac) {
    cells.push({ key: "dot", kind: "dot", char: ".", place: -1 });
    frac.split("").forEach((ch, i) => cells.push({ key: `f${i + 1}`, kind: "digit", char: ch, digit: Number(ch), place: -2 * (i + 1) }));
  }
  if (suf) cells.push({ key: "suffix", kind: "suffix", char: suf, place: -1e6 });
  return cells;
}

/**
 * Where a wheel resting (or caught mid-roll) at line `cur` should travel to show `digit`: forward (or, falling,
 * backward) to the next occurrence of the digit, then `turns` full turns. A wheel already on its digit spins
 * exactly `turns` turns, so the reveal's in-place roll is 2/2/1/1 turns and an unchanged `ui` digit stays still.
 */
export function target(cur: number, digit: number, trend: Trend, turns: number): number {
  const d = ((cur % 10) + 10) % 10;
  const base = cur - d;
  let t = base + digit;
  if (trend > 0 && t < cur - 1e-9) t += 10;
  if (trend < 0 && t > cur + 1e-9) t -= 10;
  return t + trend * 10 * turns;
}

/** Brings a line back into the rest window; the column repeats every 10 lines, so this is invisible. */
export const normalize = (line: number) => REST + (((line % 10) + 10) % 10);

/**
 * The position curve for one roll: plain expo-out, or for the cinema units and tens a "clunk" that overshoots by
 * 0.06 of a line at t = 0.86 and eases back by t = 1.
 */
export function curve(detent: boolean, dist: number): (t: number) => number {
  if (!detent || dist === 0) return EXPO;
  const o = 0.06 / Math.abs(dist);
  return (t) => (t <= 0.86 ? (1 + o) * EXPO(t / 0.86) : 1 + o - o * EXPO((t - 0.86) / 0.14));
}

const N = 28;
const T = Array.from({ length: N + 1 }, (_, k) => k / N);
/** Lines per second that read as full blur. */
const FULL_BLUR = 30;

/**
 * One clock per wheel (§2.4): progress runs 0→1 linearly over delay + duration, and position and speed are read
 * from these piecewise-linear tables, so the blur tracks the real motion frame for frame on the native driver.
 * The delay is a flat stretch at the start, so a waiting wheel shows no blur.
 */
export function wheelTables(fromLine: number, toLine: number, delayMs: number, durMs: number, detent: boolean) {
  const dist = toLine - fromLine;
  const f = curve(detent, dist);
  const total = delayMs + durMs;
  const at = (t: number) => (delayMs + t * durMs) / total;
  const line = T.map((t) => fromLine + dist * f(t));
  const speed = T.map((_, k) => {
    const a = T[Math.max(0, k - 1)]!;
    const b = T[Math.min(N, k + 1)]!;
    const v = (Math.abs(dist) * Math.abs(f(b) - f(a))) / (b - a) / (durMs / 1000);
    return Math.min(1, v / FULL_BLUR);
  });
  // Blur ramps in over the first sample (a frame or two) and out as the digit lands, never during a delay.
  speed[0] = 0;
  speed[N] = 0;
  const input = T.map(at);
  if (delayMs > 0) return { input: [0, ...input], line: [fromLine, ...line], speed: [0, ...speed], total };
  return { input, line, speed, total };
}

/** Where a wheel is at progress p of a roll built by wheelTables. */
export function lineAt(tables: { input: number[]; line: number[] }, p: number): number {
  const { input, line } = tables;
  if (p <= input[0]!) return line[0]!;
  for (let i = 1; i < input.length; i++) {
    if (p <= input[i]!) {
      const span = input[i]! - input[i - 1]!;
      const k = span ? (p - input[i - 1]!) / span : 1;
      return line[i - 1]! + (line[i]! - line[i - 1]!) * k;
    }
  }
  return line[line.length - 1]!;
}

export interface WheelCmd {
  digit: number;
  trend: Trend;
  turns: number;
  delay: number;
  duration: number;
  detent: boolean;
  /** A new place value: starts on 0, transparent, and fades in over 300 ms. */
  enter: boolean;
  /** A place value that is leaving: rolls to 0 and fades out from 35% of its roll. */
  exit: boolean;
}

export interface Plan {
  wheels: Record<string, WheelCmd>;
  /** Separators and the decimal point: when each fades in or out, in ms from the start. */
  fades: Record<string, { from: 0 | 1; to: 0 | 1; delay: number; duration: number }>;
  /** How long the row width takes to settle (the rank-0 wheel's duration). */
  widthMs: number;
  /** When the last wheel lands, for the landing haptic. */
  landsAt: number;
}

const TIMING = {
  ui: { base: 520, per: 30, stagger: 25, turns: (order: number, changed: boolean) => (order === 0 && changed ? 1 : 0) },
  cinema: { base: 800, per: 50, stagger: 30, turns: (order: number) => (order <= 1 ? 2 : 1) },
};

/**
 * Plans a change from `prev` to `next` (§2.2, §2.6). Moving wheels are ranked from the most significant (r = 0),
 * so the figure settles left to right and the units land last. In `ui` mode unchanged digits stay still; in
 * `cinema` every wheel spins, so a figure can roll in place and land on the same digits (the reveal).
 */
export function plan(prev: Cell[], next: Cell[], mode: "ui" | "cinema", trend: Trend): Plan {
  const t = TIMING[mode];
  const before = new Map(prev.map((c) => [c.key, c]));
  const after = new Map(next.map((c) => [c.key, c]));
  const digits = next.filter((c) => c.kind === "digit").sort((a, b) => a.place - b.place);
  type Move = { key: string; place: number; cmd: Omit<WheelCmd, "delay" | "duration"> };
  const moves: Move[] = [];
  digits.forEach((c, order) => {
    const old = before.get(c.key);
    const enter = !old || old.kind !== "digit";
    const changed = enter || old!.digit !== c.digit;
    const turns = mode === "cinema" ? t.turns(order, changed) : TIMING.ui.turns(order, changed);
    if (!changed && turns === 0) return;
    moves.push({ key: c.key, place: c.place, cmd: { digit: c.digit!, trend, turns, detent: mode === "cinema" && order <= 1, enter, exit: false } });
  });
  for (const c of prev) {
    if (c.kind === "digit" && !after.has(c.key)) moves.push({ key: c.key, place: c.place, cmd: { digit: 0, trend: -1, turns: 0, detent: false, enter: false, exit: true } });
  }
  moves.sort((a, b) => b.place - a.place);
  const wheels: Record<string, WheelCmd> = {};
  let landsAt = 0;
  moves.forEach((m, r) => {
    const delay = t.stagger * r;
    const duration = t.base + t.per * r;
    wheels[m.key] = { ...m.cmd, delay, duration };
    landsAt = Math.max(landsAt, delay + duration);
  });
  const widthMs = moves.length ? t.base : 0;
  const fades: Plan["fades"] = {};
  for (const c of next) {
    if ((c.kind === "sep" || c.kind === "dot") && !before.has(c.key)) fades[c.key] = { from: 0, to: 1, delay: Math.round(0.4 * t.base), duration: 200 };
  }
  for (const c of prev) {
    if ((c.kind === "sep" || c.kind === "dot") && !after.has(c.key)) fades[c.key] = { from: 1, to: 0, delay: Math.round(0.35 * t.base), duration: 200 };
  }
  return { wheels, fades, widthMs, landsAt };
}

/** Em widths from the bundled fonts (fontTools): Bodoni's tabular digits are 0.58 em, DM Mono is 0.6 throughout. */
export const METRICS: Record<"bodoni" | "mono", { digit: number; glyph: Record<string, number>; fallback: number; ascent: number; descent: number; cap: number }> = {
  bodoni: { digit: 0.58, glyph: { $: 0.554, ",": 0.214, ".": 0.2, " ": 0.25, "+": 0.6, "/": 0.32 }, fallback: 0.55, ascent: 1.125, descent: 0.4, cap: 0.75 },
  mono: { digit: 0.6, glyph: {}, fallback: 0.6, ascent: 0.992, descent: 0.31, cap: 0.7 },
};

/** Width of a cell in em. */
export function emWidth(cell: Pick<Cell, "kind" | "char">, family: "bodoni" | "mono"): number {
  const m = METRICS[family];
  if (cell.kind === "digit") return m.digit;
  return cell.char.split("").reduce((s, ch) => s + (/\d/.test(ch) ? m.digit : m.glyph[ch] ?? m.fallback), 0);
}
