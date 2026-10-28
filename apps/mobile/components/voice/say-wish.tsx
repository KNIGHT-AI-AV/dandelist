import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { transcribeWish } from "../../lib/agent";
import { ease, haptic, native, spring, step, useReducedMotion, usePress } from "../../lib/motion";
import { layout, type, usePalette } from "../../lib/theme";
import { AgentDot, Eyebrow, Glass } from "../lux";
import { BARS } from "./recorder-types";
import { useRecorder } from "./use-recorder";

type Api = (path: string, init?: RequestInit) => Promise<Response>;
export type VoicePhase = "idle" | "listening" | "hearing";

/**
 * Say your wish. Tap the microphone, say it the way you'd tell a friend, and it stops by itself when you pause; Muse
 * Voice Transcribe writes it down and the words land in the field to check before pricing. Typing stays one tap away.
 */
export function useVoiceWish({ api, onHeard, onError }: { api: Api; onHeard(text: string): void; onError(message: string | null): void }) {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const recorder = useRecorder({
    onClip: async (wav) => {
      setPhase("hearing");
      try {
        const text = await transcribeWish(api, wav);
        haptic.success();
        onHeard(text);
      } catch (e) {
        haptic.error();
        onError((e as Error).message);
      } finally {
        setPhase("idle");
      }
    },
    onError: (message) => {
      setPhase("idle");
      onError(message);
    },
  });
  const toggle = () => {
    if (phase === "hearing") return;
    if (recorder.listening) {
      haptic.select();
      return recorder.stop();
    }
    haptic.soft();
    onError(null);
    setPhase("listening");
    // When the microphone is refused, start() returns without listening and onError says why.
    void recorder.start();
  };
  // Listening shows only once the microphone is really open, so a permission prompt never sits over a fake panel.
  const live = phase === "listening" && recorder.listening;
  return { supported: recorder.supported, phase: live ? "listening" : phase === "hearing" ? "hearing" : "idle", levels: recorder.levels, elapsedMs: recorder.elapsedMs, toggle, cancel: recorder.cancel } as const;
}
export type VoiceWish = ReturnType<typeof useVoiceWish>;

const SIZE = layout.control.icon;

/** The microphone drawn in hairlines like the kit's other icons: a capsule, its cradle and a stem. */
function MicGlyph({ color }: { color: string }) {
  return (
    <View style={{ width: 16, height: 20, alignItems: "center" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={{ width: 8, height: 12, borderRadius: 4, borderWidth: 1.5, borderColor: color }} />
      <View style={{ position: "absolute", top: 6, width: 14, height: 9, borderWidth: 1.5, borderTopWidth: 0, borderColor: color, borderBottomLeftRadius: 7, borderBottomRightRadius: 7 }} />
      <View style={{ position: "absolute", top: 15, width: 1.5, height: 4, backgroundColor: color }} />
    </View>
  );
}

/**
 * The one voice control. Idle it is a glass circle; listening it fills with the accent, shows a stop square and
 * breathes with the voice (the halo follows the loudness on a critically damped spring); while the words are being
 * written it holds still with the agent dot.
 */
export function MicButton({ voice, compact = false }: { voice: VoiceWish; compact?: boolean }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const press = usePress(0.94);
  const halo = useRef(new Animated.Value(0)).current;
  const level = voice.levels.at(-1) ?? 0;
  useEffect(() => {
    if (reduced || voice.phase !== "listening") return halo.setValue(0);
    Animated.spring(halo, { toValue: Math.min(1, level * LOUD), ...spring.press, useNativeDriver: native }).start();
  }, [level, voice.phase, reduced, halo]);
  if (!voice.supported) return null;
  const listening = voice.phase === "listening";
  const label = listening ? "Finish speaking" : voice.phase === "hearing" ? "Writing down your wish" : "Say your wish";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: voice.phase === "hearing" }}
      onPress={voice.toggle}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      hitSlop={8}
    >
      <Animated.View style={{ width: SIZE, height: SIZE, transform: [{ scale: press.scale }] }}>
        {/* Inside the chat capsule there is no room for the halo; the bars beside it carry the voice instead. */}
        {listening && !compact ? (
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: SIZE,
              height: SIZE,
              borderRadius: SIZE / 2,
              backgroundColor: p.accent,
              opacity: halo.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.34] }),
              // Kept inside the side gutter at its loudest, so it never touches the screen edge.
              transform: [{ scale: halo.interpolate({ inputRange: [0, 1], outputRange: [1.12, 1.45] }) }],
            }}
          />
        ) : null}
        {listening ? (
          <View style={{ width: SIZE, height: SIZE, borderRadius: SIZE / 2, backgroundColor: p.accent, alignItems: "center", justifyContent: "center" }}>
            <View style={{ width: 13, height: 13, borderRadius: 3, borderCurve: "continuous", backgroundColor: p.onAccent }} />
          </View>
        ) : (
          <Glass style={{ width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: "center", justifyContent: "center" }}>
            {voice.phase === "hearing" ? <AgentDot busy size={8} /> : <MicGlyph color={p.ink} />}
          </Glass>
        )}
      </Animated.View>
    </Pressable>
  );
}

/** Speech reads at roughly 0.03 to 0.15 RMS after the browser's gain control; this maps a full voice to full height. */
const LOUD = 6;
const BAR_W = 3;
const BAR_GAP = 3;
const BAR_MAX = 40;
/** Bar height for a loudness reading. Loudness reads better on a curve: quiet speech still moves, a shout doesn't clip. */
const barHeight = (level: number, max: number) => Math.max(3, Math.min(max, 3 + Math.pow(Math.min(1, level * LOUD), 0.7) * (max - 3)));

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * What the field turns into while you speak: the voice drawn as bars that scroll in from the right, a running clock,
 * and one line saying what happens next. When the clip goes to Meta the bars settle flat and a light sweeps across
 * them until the words come back. It holds the field's own height, so nothing below it moves.
 */
export function ListeningPanel({ voice, height }: { voice: VoiceWish; height: number }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const enter = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const hearing = voice.phase === "hearing";
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: step.inMs, easing: ease.out, useNativeDriver: native }).start();
  }, [enter]);
  useEffect(() => {
    if (!hearing || reduced) return sweep.setValue(0);
    const loop = Animated.loop(Animated.timing(sweep, { toValue: 1, duration: 1100, easing: ease.inOut, useNativeDriver: native }));
    loop.start();
    return () => loop.stop();
  }, [hearing, reduced, sweep]);
  const frozen = useRef<number[]>([]);
  if (!hearing) frozen.current = voice.levels;
  const shown = hearing ? frozen.current : voice.levels;
  const bars = Array.from({ length: BARS }, (_, i) => shown[shown.length - BARS + i] ?? 0);
  const width = BARS * BAR_W + (BARS - 1) * BAR_GAP;

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      accessibilityLabel={hearing ? "Writing down your wish" : `Listening, ${clock(voice.elapsedMs)}`}
      style={{ height, justifyContent: "center", gap: layout.stack.tight, opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [reduced ? 0 : 6, 0] }) }] }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <AgentDot busy />
        <Eyebrow color={p.ink2}>{hearing ? "Muse Voice · writing it down" : "Listening"}</Eyebrow>
        {/* Beside the label, not at the far edge, where the microphone button sits. */}
        {!hearing ? <Text style={[type.figure, { color: p.ink3 }]}>{clock(voice.elapsedMs)}</Text> : null}
      </View>
      <View style={{ height: BAR_MAX, width, flexDirection: "row", alignItems: "center", gap: BAR_GAP, overflow: "hidden" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {bars.map((lv, i) => {
          const h = hearing ? 3 : barHeight(lv, BAR_MAX);
          return <View key={i} style={{ width: BAR_W, height: h, borderRadius: BAR_W / 2, backgroundColor: i === BARS - 1 && !hearing ? p.ink : p.ink2 }} />;
        })}
        {hearing && !reduced ? (
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              width: 48,
              backgroundColor: p.accent,
              opacity: 0.35,
              borderRadius: 24,
              transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-48, width] }) }],
            }}
          />
        ) : null}
      </View>
      <Text style={[type.footnote, { color: p.ink3 }]}>{hearing ? "One moment." : "Say it like you'd tell a friend. It stops when you pause."}</Text>
    </Animated.View>
  );
}

const STRIP_BARS = 22;
const STRIP_MAX = 20;

/**
 * The listening state inside the chat capsule, one line tall: the newest bars, the clock, and "Writing it down" while
 * Meta has the clip. The capsule keeps its height, so the conversation above doesn't move.
 */
export function ListeningStrip({ voice }: { voice: VoiceWish }) {
  const p = usePalette();
  const hearing = voice.phase === "hearing";
  const frozen = useRef<number[]>([]);
  if (!hearing) frozen.current = voice.levels;
  const shown = hearing ? frozen.current : voice.levels;
  const bars = Array.from({ length: STRIP_BARS }, (_, i) => shown[shown.length - STRIP_BARS + i] ?? 0);
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityLabel={hearing ? "Writing down your wish" : `Listening, ${clock(voice.elapsedMs)}`}
      style={{ flexDirection: "row", alignItems: "center", gap: layout.stack.tight }}
    >
      {hearing ? (
        <>
          <AgentDot busy />
          <Text style={[type.footnote, { color: p.ink2 }]}>Writing it down...</Text>
        </>
      ) : (
        <>
          <View style={{ height: STRIP_MAX, flexDirection: "row", alignItems: "center", gap: 2 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {bars.map((lv, i) => (
              <View key={i} style={{ width: 2, height: barHeight(lv, STRIP_MAX), borderRadius: 1, backgroundColor: i === STRIP_BARS - 1 ? p.ink : p.ink2 }} />
            ))}
          </View>
          <Text style={[type.figure, { color: p.ink3 }]}>{clock(voice.elapsedMs)}</Text>
        </>
      )}
    </View>
  );
}
