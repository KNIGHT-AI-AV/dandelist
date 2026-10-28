import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { ease, native, useReducedMotion } from "../lib/motion";
import { METRICS, REPEATS, REST, cellsOf, emWidth, lineAt, normalize, plan, target, wheelTables, type Cell, type Mode, type Trend, type WheelCmd } from "../lib/odometer-plan";
import { fonts, serif, usePalette } from "../lib/theme";
import { EdgeMask } from "./odometer-mask";

/**
 * Money that rolls like a mechanical odometer (UI audit §2). Every digit is a wheel keyed by its place value, so
 * the units wheel stays the units wheel whatever the length. A change rolls the moving wheels in the direction of
 * the change, settling left to right on expo-out; new place values enter on 0 and fade in while the row widens.
 *
 * Modes: `ui` (the Life pill, totals: the last of six wheels lands at 795 ms and unchanged digits stay still),
 * `cinema` (the title price and the reveal: every wheel spins, 2/2/1/1 extra turns, landing at 1.2 s) and
 * `instant` (slider drags). Crisp digits roll through a soft edge fade, all driven by one native clock per wheel,
 * with a slight vertical stretch at speed and, on the web, a stepped blur. Reduced motion swaps the figure with a
 * 100/160 ms crossfade.
 */

const COLUMN = Array.from({ length: REPEATS * 10 }, (_, i) => String(i % 10)).join("\n");
const HIDDEN = { accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" as const, ...(Platform.OS === "web" ? { "aria-hidden": true } : {}) };
const COALESCE_MS = 120;
// The web reads a composite figure as one labelled image (as NumberFlow does); phones read it as text.
const ROLE = Platform.OS === "web" ? ("image" as const) : ("text" as const);

export const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

export interface OdometerProps {
  cents: number;
  /** Turns cents into the figure; whole dollars by default. */
  format?: (cents: number) => string;
  mode?: Mode;
  size?: number;
  /** Bodoni (the optical cut is picked by size) or DM Mono. */
  family?: "bodoni" | "mono";
  color?: string;
  /** The `$` at half size in ink2, its top on the digits' top (Money hero). */
  smallPrefix?: boolean;
  /** Colour of the half-size `$` (ink2 by default). */
  prefixColor?: string;
  /** A soft glow around the glyphs (the reveal's champagne light). */
  glow?: string;
  /** Tracking in px (hero figures run −0.02 em). */
  tracking?: number;
  /** Which edge stays put when the figure grows: the `$` (left) or the units (right). */
  align?: "left" | "right";
  /** Roll in place on mount, landing on the same digits (the reveal, the title price). Cinema by default. */
  rollOnMount?: boolean | Mode;
  /** Called on the frame the last wheel lands. */
  onLand?: () => void;
  /** On an increase the figure warms to the accent and back (Coinbase's pulse; never red on a decrease). */
  pulse?: boolean;
  /** Screen-reader announcement after a change, debounced by 1 s. */
  announce?: (figure: string) => string;
  /** Android live region for figures that change after the person acts (the Life pill). */
  live?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Odometer(props: OdometerProps) {
  const reduced = useReducedMotion();
  return reduced ? <Crossfade {...props} /> : <Rolling {...props} />;
}

function useLook({ size = 22, family = "mono", color, smallPrefix = false, prefixColor, glow, tracking = 0 }: OdometerProps) {
  const p = usePalette();
  const H = Math.round(size * 1.18);
  const P = Math.round(size * 0.18);
  // Reel pitch: digits on the wheel sit further apart than the figure's line, so a passing digit has left the
  // window before the next arrives. iOS draws a taller line from the bottom, so phones keep the figure's own line.
  const L = Platform.OS === "web" ? Math.round(size * 1.6) : H;
  // The edge fade runs past the pad into the empty space above and below the digits, so passing digits dissolve.
  const F = P + Math.round(size * 0.16);
  const m = METRICS[family];
  const fontFamily = family === "bodoni" ? serif(size) : fonts.figure;
  const text: TextStyle = { fontFamily, fontSize: size, lineHeight: H, color: color ?? p.ink, textAlign: "center", includeFontPadding: false, fontVariant: ["tabular-nums", "lining-nums"], ...(glow ? { textShadowColor: glow, textShadowRadius: size * 0.25, textShadowOffset: { width: 0, height: 0 } } : null) };
  const widthOf = (c: Pick<Cell, "kind" | "char">) => {
    if (c.kind === "prefix" && smallPrefix) return emWidth(c, family) * size * 0.5 + size * 0.04;
    return emWidth(c, family) * size + tracking * (c.kind === "prefix" || c.kind === "suffix" ? c.char.length : 1);
  };
  // The half-size `$` sits with its top on the digits' top (fontTools: digits reach 0.73 em, `$` 0.83 em).
  const mid = (m.ascent - m.descent) / 2;
  const prefixLift = smallPrefix ? size * (mid - 0.73) - size * 0.5 * (mid - 0.83) : 0;
  return { p, H, P, L, F, text, widthOf, prefixLift, size, smallPrefix, prefixColor: prefixColor ?? p.ink2 };
}

type Look = ReturnType<typeof useLook>;
type Shown = Cell & { exiting?: boolean };

function Rolling(props: OdometerProps) {
  const { cents, format = dollars, mode = "ui", align = "left", rollOnMount = false, onLand, pulse = false, announce, live = false, style } = props;
  const look = useLook(props);
  const { p, H, P, F, widthOf } = look;
  const figure = format(cents);

  const [cells, setCells] = useState<Shown[]>(() => cellsOf(figure));
  const [cmds, setCmds] = useState<Record<string, { id: number; cmd: WheelCmd | "instant" }>>({});
  const seq = useRef(0);
  const opacity = useRef(new Map<string, Animated.Value>()).current;
  const opacityOf = (key: string, start = 1) => {
    if (!opacity.has(key)) opacity.set(key, new Animated.Value(start));
    return opacity.get(key)!;
  };
  const widthNow = (list: Shown[]) => list.filter((c) => !c.exiting).reduce((s, c) => s + widthOf(c), 0);
  const width = useRef(new Animated.Value(widthNow(cells))).current;
  const glow = useRef(new Animated.Value(0)).current;
  const shown = useRef({ figure, cents, cells: cellsOf(figure) });
  const lastAt = useRef(0);
  const timers = useRef<{ hold?: ReturnType<typeof setTimeout>; land?: ReturnType<typeof setTimeout>; drop?: ReturnType<typeof setTimeout>; say?: ReturnType<typeof setTimeout> }>({});
  const latest = useRef({ mode, onLand, announce, pulse, format });
  latest.current = { mode, onLand, announce, pulse, format };

  const apply = (nextCents: number, forced?: Mode) => {
    const nextFigure = latest.current.format(nextCents);
    const prev = shown.current;
    const next = cellsOf(nextFigure);
    const m = forced ?? latest.current.mode;
    const trend: Trend = nextCents < prev.cents ? -1 : 1;
    shown.current = { figure: nextFigure, cents: nextCents, cells: next };
    clearTimeout(timers.current.land);
    clearTimeout(timers.current.drop);

    if (m === "instant") {
      const all: Record<string, { id: number; cmd: "instant" }> = {};
      for (const c of next) if (c.kind === "digit") all[c.key] = { id: ++seq.current, cmd: "instant" };
      next.forEach((c) => opacityOf(c.key).setValue(1));
      setCmds((old) => ({ ...old, ...all }));
      setCells(next);
      width.stopAnimation();
      width.setValue(widthNow(next));
      latest.current.onLand?.();
      return;
    }

    const pl = plan(prev.cells, next, m, trend);
    const nextKeys = new Set(next.map((c) => c.key));
    const leaving = prev.cells.filter((c) => !nextKeys.has(c.key)).map((c) => ({ ...c, exiting: true }));
    const merged = [...next, ...leaving].sort((a, b) => b.place - a.place);

    const issued: Record<string, { id: number; cmd: WheelCmd }> = {};
    for (const [key, cmd] of Object.entries(pl.wheels)) {
      issued[key] = { id: ++seq.current, cmd };
      const o = opacityOf(key, cmd.enter ? 0 : 1);
      if (cmd.enter) {
        o.setValue(0);
        Animated.timing(o, { toValue: 1, duration: 300, delay: cmd.delay, easing: ease.out, useNativeDriver: native }).start();
      } else if (cmd.exit) {
        Animated.timing(o, { toValue: 0, duration: 250, delay: cmd.delay + 0.35 * cmd.duration, easing: ease.out, useNativeDriver: native }).start();
      } else o.setValue(1);
    }
    for (const [key, f] of Object.entries(pl.fades)) {
      const o = opacityOf(key, f.from);
      o.setValue(f.from);
      Animated.timing(o, { toValue: f.to, duration: f.duration, delay: f.delay, easing: ease.out, useNativeDriver: native }).start();
    }
    setCmds((old) => ({ ...old, ...issued }));
    setCells(merged);
    Animated.timing(width, { toValue: widthNow(next), duration: Math.max(1, pl.widthMs), easing: ease.expo, useNativeDriver: false }).start();

    if (leaving.length) timers.current.drop = setTimeout(() => setCells((cs) => cs.filter((c) => !c.exiting)), pl.landsAt + 30);
    const land = latest.current.onLand;
    if (land) timers.current.land = setTimeout(land, Math.max(0, pl.landsAt - 16));
    if (latest.current.pulse && trend > 0 && nextCents !== prev.cents) {
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 120, easing: ease.out, useNativeDriver: false }),
        Animated.timing(glow, { toValue: 0, duration: 600, easing: ease.out, useNativeDriver: false }),
      ]).start();
    }
    const say = latest.current.announce;
    if (say && nextCents !== prev.cents) {
      clearTimeout(timers.current.say);
      timers.current.say = setTimeout(() => AccessibilityInfo.announceForAccessibility(say(nextFigure)), 1000);
    }
  };

  // A change rolls at once; changes under 120 ms apart are held and rolled once with the newest value (§2.7).
  useEffect(() => {
    if (cents === shown.current.cents && figure === shown.current.figure) return;
    const now = Date.now();
    const quick = now - lastAt.current < COALESCE_MS || timers.current.hold !== undefined;
    lastAt.current = now;
    if (mode === "instant" || !quick) {
      clearTimeout(timers.current.hold);
      timers.current.hold = undefined;
      apply(cents);
      return;
    }
    clearTimeout(timers.current.hold);
    timers.current.hold = setTimeout(() => {
      timers.current.hold = undefined;
      apply(cents);
    }, COALESCE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cents, figure]);

  useEffect(() => {
    if (rollOnMount) apply(cents, rollOnMount === true ? "cinema" : rollOnMount);
    const t = timers.current;
    return () => Object.values(t).forEach((x) => clearTimeout(x));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const color = pulse ? glow.interpolate({ inputRange: [0, 1], outputRange: [props.color ?? p.ink, p.accentText] }) : props.color ?? p.ink;

  // Each cell sits at a fixed distance from the row's right edge, so only the row width animates.
  let right = 0;
  const placed = [...cells]
    .sort((a, b) => a.place - b.place)
    .map((c) => {
      const w = widthOf(c);
      const at = c.kind === "prefix" ? null : right;
      if (c.kind !== "prefix") right += w;
      return { c, w, at };
    });

  return (
    <View
      style={[{ height: H, alignSelf: align === "right" ? "flex-end" : "flex-start" }, style]}
      accessible
      accessibilityRole={ROLE}
      accessibilityLabel={figure}
      accessibilityLiveRegion={live ? "polite" : "none"}
    >
      <View style={{ marginTop: -P }} pointerEvents="none" {...HIDDEN}>
        <EdgeMask pad={F}>
          <Animated.View style={{ width, height: H + 2 * P }}>
            {placed.map(({ c, w, at }) => {
              const pos: ViewStyle = at === null ? { left: 0 } : { right: at };
              const o = opacity.get(c.key);
              if (c.kind === "digit") {
                const cmd = cmds[c.key];
                return (
                  <Animated.View key={c.key} style={[{ position: "absolute", top: 0, width: w, height: H + 2 * P, opacity: o ?? 1 }, pos]}>
                    <Wheel look={look} width={w} start={cmd?.cmd === "instant" || !cmd ? c.digit! : (cmd.cmd as WheelCmd).enter ? 0 : c.digit!} id={cmd?.id ?? 0} cmd={cmd?.cmd} color={color} />
                  </Animated.View>
                );
              }
              return (
                <Animated.View key={c.key} style={[{ position: "absolute", top: P, width: w, height: H, opacity: o ?? 1 }, pos]}>
                  <Glyph look={look} cell={c} color={color} />
                </Animated.View>
              );
            })}
          </Animated.View>
        </EdgeMask>
      </View>
    </View>
  );
}

/** A separator, the decimal point, the prefix or a suffix. */
function Glyph({ look, cell, color }: { look: Look; cell: Cell; color: string | Animated.AnimatedInterpolation<string> }) {
  const { text, size, smallPrefix, prefixLift, prefixColor } = look;
  if (cell.kind === "prefix" && smallPrefix) {
    return <Animated.Text style={[text, { fontSize: size * 0.5, color: prefixColor, textAlign: "left", transform: [{ translateY: prefixLift }] }]}>{cell.char}</Animated.Text>;
  }
  return <Animated.Text style={[text, { color, textAlign: cell.kind === "prefix" ? "left" : "center" }]}>{cell.char}</Animated.Text>;
}

type Roll = { progress: Animated.Value; tables: ReturnType<typeof wheelTables>; to: number; ty: Animated.AnimatedInterpolation<number> | Animated.Value; speed: Animated.AnimatedInterpolation<number> | Animated.Value; moving: boolean };

/** Where the column sits for a (fractional) line: that line's digit centred in the visible box. */
const yOf = (look: Pick<Look, "H" | "P" | "L">, line: number) => look.P + (look.H - look.L) / 2 - line * look.L;

const restRoll = (line: number, look: Pick<Look, "H" | "P" | "L">): Roll => ({
  progress: new Animated.Value(0),
  tables: { input: [0, 1], line: [line, line], speed: [0, 0], total: 1 },
  to: line,
  ty: new Animated.Value(yOf(look, line)),
  speed: new Animated.Value(0),
  moving: false,
});

/** One digit wheel: a column of 0–9 repeated, moved by a single native clock (§2.4). */
function Wheel({ look, width, start, id, cmd, color }: { look: Look; width: number; start: number; id: number; cmd?: WheelCmd | "instant"; color: string | Animated.AnimatedInterpolation<string> }) {
  const { H, P, L, text } = look;
  const [roll, setRoll] = useState<Roll>(() => restRoll(REST + start, look));
  const live = useRef({ roll, startedAt: 0, running: false });
  live.current.roll = roll;

  useEffect(() => {
    if (!cmd || !id) return;
    const cur = live.current;
    const begin = (from: number, interrupted: boolean, remaining: number) => {
      if (cmd === "instant") return setRoll(restRoll(REST + start, look));
      const to = target(from, cmd.digit, cmd.trend, cmd.turns);
      if (Math.abs(to - from) < 1e-6) return setRoll(restRoll(normalize(from), look));
      const delay = interrupted ? 0 : cmd.delay;
      const duration = interrupted ? Math.max(320, remaining) : cmd.duration;
      const tables = wheelTables(from, to, delay, duration, cmd.detent);
      const progress = new Animated.Value(0);
      setRoll({
        progress,
        tables,
        to,
        ty: progress.interpolate({ inputRange: tables.input, outputRange: tables.line.map((l) => yOf(look, l)) }),
        speed: progress.interpolate({ inputRange: tables.input, outputRange: tables.speed }),
        moving: true,
      });
    };
    if (cur.running) {
      // Caught mid-roll: continue from exactly where the wheel is, never from its old resting digit (§2.7).
      const r = cur.roll;
      r.progress.stopAnimation((value) => {
        cur.running = false;
        const remaining = Math.max(0, r.tables.total - (Date.now() - cur.startedAt));
        begin(normalize(lineAt(r.tables, value)), true, remaining);
      });
    } else begin(normalize(cur.roll.to), false, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Start the clock once the new tables are attached, so the first frame is exactly where the wheel already is.
  useLayoutEffect(() => {
    if (!roll.moving) return;
    const cur = live.current;
    cur.running = true;
    cur.startedAt = Date.now();
    Animated.timing(roll.progress, { toValue: 1, duration: roll.tables.total, easing: Easing.linear, useNativeDriver: native }).start(({ finished }) => {
      if (!finished || live.current.roll !== roll) return;
      cur.running = false;
      setRoll(restRoll(normalize(roll.to), look));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roll, H, P, L]);

  // Web motion blur in three steps (none, light, full) as the wheel speeds up: a blur radius that changed every
  // frame would make the browser redraw the whole column each frame, which stutters on a phone.
  const textRef = useRef<Text | null>(null);
  // On the web the Text is a DOM node, so its style can be set directly between React renders.
  const dom = () => (textRef.current as unknown as { style?: { filter: string } } | null)?.style;
  useEffect(() => {
    if (Platform.OS !== "web" || !roll.moving) return;
    let level = -1;
    const s = roll.speed as Animated.AnimatedInterpolation<number>;
    const id = s.addListener(({ value }) => {
      const next = value > 0.6 ? 2 : value > 0.3 ? 1 : 0;
      const style = dom();
      if (next === level || !style) return;
      level = next;
      style.filter = next ? `blur(${(next * 0.025 * H).toFixed(1)}px)` : "";
    });
    return () => {
      s.removeListener(id);
      const style = dom();
      if (style) style.filter = "";
    };
  }, [roll, H]);

  const column = (offset: number, alpha: number) => (
    <Animated.View
      style={{
        position: "absolute",
        left: 0,
        width,
        top: 0,
        opacity: offset === 0 ? roll.speed.interpolate({ inputRange: [0, 1], outputRange: [1, 0.88] }) : roll.speed.interpolate({ inputRange: [0, 1], outputRange: [0, alpha] }),
        transform: [{ translateY: offset === 0 ? roll.ty : Animated.add(roll.ty, offset * L) }],
      }}
    >
      <Animated.Text ref={offset === 0 ? textRef : undefined} style={[text, { color, width, lineHeight: L }]}>{COLUMN}</Animated.Text>
    </Animated.View>
  );

  return (
    <Animated.View style={{ width, height: H + 2 * P, overflow: "hidden", transform: [{ scaleY: roll.speed.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] }) }] }}>
      {column(0, 1)}
    </Animated.View>
  );
}

/** Reduced motion: no roll, no blur, no width animation; the old figure fades out in 100 ms and the new in 160 ms. */
function Crossfade(props: OdometerProps) {
  const { cents, format = dollars, onLand, announce, live = false, style, align = "left" } = props;
  const look = useLook(props);
  const { text, p, size, smallPrefix, H, prefixLift, prefixColor } = look;
  const figure = format(cents);
  const [shown, setShown] = useState(figure);
  const o = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (figure === shown) return;
    Animated.timing(o, { toValue: 0, duration: 100, useNativeDriver: native }).start(() => {
      setShown(figure);
      Animated.timing(o, { toValue: 1, duration: 160, useNativeDriver: native }).start();
    });
    onLand?.();
    if (announce) AccessibilityInfo.announceForAccessibility(announce(figure));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [figure]);
  useEffect(() => {
    if (props.rollOnMount) onLand?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const hasPrefix = smallPrefix && /^\D/.test(shown);
  return (
    <Animated.View style={[{ height: H, flexDirection: "row", alignSelf: align === "right" ? "flex-end" : "flex-start", opacity: o }, style]} accessible accessibilityRole={ROLE} accessibilityLabel={figure} accessibilityLiveRegion={live ? "polite" : "none"}>
      {hasPrefix ? <Text style={[text, { fontSize: size * 0.5, color: prefixColor, marginRight: size * 0.04, transform: [{ translateY: prefixLift }] }]}>{shown[0]}</Text> : null}
      <Text style={[text, { color: props.color ?? p.ink, letterSpacing: props.tracking }]}>{hasPrefix ? shown.slice(1) : shown}</Text>
    </Animated.View>
  );
}
