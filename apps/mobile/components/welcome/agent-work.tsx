import { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { DANDY_COLORS, DANDY_NAME_MAX, PERSONAS, SHAPES, cleanName, saveDandy, useDandy, type Dandy } from "../../lib/dandy";
import { ease, haptic, native, useReducedMotion } from "../../lib/motion";
import { fonts, layout, radius, type, usePalette, useType } from "../../lib/theme";
import { streamPreview, type PreviewEvent, type WelcomeState } from "../../lib/welcome";
import { DandyAvatar } from "../dandy-avatar";
import { AgentDot, EdgeFade, Eyebrow, Glass, Icon } from "../lux";
import { Chip, Rise } from "./kit";

type Row = { id: string; state: "running" | "done"; text: string };
export type Result = Extract<PreviewEvent, { type: "result" }>;

/** A row enters when the server sends it; "running" breathes the dot until the server says it's done. */
function AgentRow({ row }: { row: Row }) {
  const p = usePalette();
  return (
    <Rise style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 24 }}>
      <View style={{ width: 17, alignItems: "center" }}>{row.state === "running" ? <AgentDot busy /> : <Icon name="check" color={p.accentText} size={14} />}</View>
      <Text style={[type.footnote, { flex: 1, color: row.state === "running" ? p.ink2 : p.ink }]}>{row.text}</Text>
    </Rise>
  );
}

/** A labelled group of choices on the customisation card. */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ gap: 10 }}>
      <Eyebrow color={p.ink3}>{label}</Eyebrow>
      {children}
    </View>
  );
}

/**
 * While the agent prices the whole list (owner, 2026-10-28: "this is when the user gets to customise their agent"),
 * the person meets their Dandy: a name, one of four personalities that changes how it speaks, one of five shapes and
 * one of ten house colours. The mark updates as they choose. The pricing runs underneath as a few quiet rows, the
 * first wish's live trail first when it is still being priced (`waiting`); the plan starts once it lands (`ready`).
 */
export function AgentWork({ state, ready, waiting, onResult, onRestart }: { state: WelcomeState; ready: boolean; waiting: { title: string; line: string } | null; onResult(r: Result): void; onRestart(): void }) {
  const p = usePalette();
  const t = useType();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const gutter = layout.gutter(width);
  const saved = useDandy();
  const [dandy, setDandy] = useState<Dandy>(saved);
  const [name, setName] = useState(saved.name);
  const [rows, setRows] = useState<Row[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const queue = useRef<PreviewEvent[]>([]);
  const added = useRef(0);
  const pop = useRef(new Animated.Value(1)).current;

  // The saved Dandy arrives a moment after mount on first load.
  useEffect(() => {
    setDandy(saved);
    setName(saved.name);
  }, [saved]);

  /** A choice lands on the mark with a small spring, a tick, and is kept on this device at once. */
  const choose = (next: Partial<Dandy>) => {
    const d = { ...dandy, ...next };
    setDandy(d);
    saveDandy({ ...d, name: cleanName(name) });
    haptic.select();
    if (reduced) return;
    pop.setValue(0.86);
    Animated.spring(pop, { toValue: 1, mass: 1, stiffness: 320, damping: 16, useNativeDriver: native }).start();
  };
  const keepName = () => {
    const n = cleanName(name);
    setName(n);
    saveDandy({ ...dandy, name: n });
  };

  useEffect(() => {
    if (!ready) return;
    if (attempt) {
      setRows([]);
      setError(null);
      queue.current = [];
      added.current = 0;
    }
    const ctrl = new AbortController();
    let draining = false;
    const drain = async () => {
      if (draining) return;
      draining = true;
      while (queue.current.length) {
        const e = queue.current.shift()!;
        if (e.type === "row") {
          setRows((rs) => (rs.some((r) => r.id === e.id) ? rs.map((r) => (r.id === e.id ? e : r)) : [...rs, e]));
          if (e.state === "done" && added.current < 1200) {
            added.current += 350;
            await new Promise((r) => setTimeout(r, 350));
          }
        } else if (e.type === "result") {
          setResult(e);
          onResult(e);
        }
      }
      draining = false;
    };
    // fetch() rejects with a TypeError ("Failed to fetch") when the network is down; say that in plain words.
    streamPreview(state, (e) => {
      queue.current.push(e);
      void drain();
    }, ctrl.signal).catch((e: Error) => !ctrl.signal.aborted && setError(e instanceof TypeError ? "Couldn't reach Dandelist. Check your connection." : e.message));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, ready]);

  const shown = { ...dandy, name: name || dandy.name };
  const swatch = 30;
  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 8 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={{ paddingHorizontal: gutter, gap: layout.stack.section, maxWidth: layout.column + 2 * gutter, width: "100%", alignSelf: "center" }}>
          <Rise style={{ alignItems: "center", gap: layout.stack.base }}>
            <Animated.View style={{ transform: [{ scale: pop }] }}>
              <DandyAvatar dandy={shown} size={88} />
            </Animated.View>
            <View style={{ alignItems: "center", gap: layout.stack.tight }}>
              <Eyebrow>Meet your Dandy</Eyebrow>
              <Text accessibilityRole="header" style={[t.title1, { color: p.ink, textAlign: "center" }]}>
                Make it <Text style={{ fontFamily: fonts.displayItalic, color: p.accentText }}>yours</Text>.
              </Text>
              <Text style={[type.callout, { color: p.ink2, textAlign: "center" }]}>It's pricing your list right now. Give it a name and a way of talking while it works.</Text>
            </View>
          </Rise>

          <Glass style={{ padding: layout.cardPad, gap: 10 }}>
            {waiting ? (
              <View style={{ gap: 6 }}>
                <AgentRow row={{ id: "wish", state: "running", text: `Finding the real price of ${waiting.title}` }} />
                {waiting.line ? <Text style={[type.footnote, { fontFamily: fonts.titleItalic, color: p.ink2, marginLeft: 29 }]}>{waiting.line}</Text> : null}
              </View>
            ) : null}
            {rows.map((r) => (
              <AgentRow key={r.id} row={r} />
            ))}
            {!rows.length && !waiting && !error ? <AgentRow row={{ id: "start", state: "running", text: "Starting on your list" }} /> : null}
            {result ? <AgentRow row={{ id: "ready", state: "done", text: `${shown.name} has your list ready.` }} /> : null}
            {error ? <Text style={[type.callout, { color: p.danger }]}>{error}</Text> : null}
            {error ? (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Chip label="Try again" onPress={() => setAttempt((n) => n + 1)} style={{ flex: 1 }} />
                <Chip label="Change my picks" onPress={onRestart} style={{ flex: 1 }} />
              </View>
            ) : null}
          </Glass>

          <Rise delay={60} style={{ gap: layout.stack.section }}>
            <Group label="Its name">
              <Glass style={{ borderRadius: radius.control, borderCurve: "continuous", paddingHorizontal: 16 }}>
                <TextInput
                  value={name}
                  onChangeText={(v) => setName(v.slice(0, DANDY_NAME_MAX))}
                  onBlur={keepName}
                  onSubmitEditing={keepName}
                  placeholder="Dandy"
                  placeholderTextColor={p.ink3}
                  accessibilityLabel="Your Dandy's name"
                  autoCapitalize="words"
                  autoCorrect={false}
                  maxLength={DANDY_NAME_MAX}
                  returnKeyType="done"
                  style={[type.title3, { color: p.ink, height: layout.control.field, fontFamily: fonts.titleItalic }, Platform.OS === "web" ? ({ outlineWidth: 0, outlineStyle: "none" } as object) : null]}
                />
              </Glass>
            </Group>

            <Group label="Its personality">
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }} accessibilityRole="radiogroup">
                {PERSONAS.map((pe) => {
                  const on = dandy.persona === pe.id;
                  return (
                    <Pressable key={pe.id} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${pe.name}. ${pe.line}`} onPress={() => choose({ persona: pe.id })} style={{ flexBasis: "47%", flexGrow: 1 }}>
                      <Glass intensity={on ? 70 : 40} style={{ minHeight: 88, borderRadius: radius.control, borderCurve: "continuous", padding: 14, gap: 4, borderColor: on ? p.accent : p.line }}>
                        <Text style={[type.title3, { color: p.ink }]}>{pe.name}</Text>
                        <Text style={[type.footnote, { color: p.ink2 }]}>{pe.line}</Text>
                      </Glass>
                    </Pressable>
                  );
                })}
              </View>
            </Group>

            <Group label="Its shape">
              <View style={{ flexDirection: "row", justifyContent: "space-between" }} accessibilityRole="radiogroup">
                {SHAPES.map((s) => {
                  const on = dandy.shape === s;
                  return (
                    <Pressable key={s} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={s} onPress={() => choose({ shape: s })} hitSlop={6}>
                      <View style={{ width: 56, height: 56, borderRadius: radius.control, borderCurve: "continuous", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: on ? p.accent : p.hair }}>
                        <DandyAvatar dandy={{ ...shown, shape: s }} size={34} />
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </Group>

            <Group label="Its colour">
              <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 }} accessibilityRole="radiogroup">
                {DANDY_COLORS.map((c) => {
                  const on = dandy.color === c.id;
                  return (
                    <Pressable key={c.id} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={c.name} onPress={() => choose({ color: c.id })} hitSlop={4} style={{ width: "20%", alignItems: "center" }}>
                      <View style={{ width: swatch + 8, height: swatch + 8, borderRadius: (swatch + 8) / 2, borderWidth: on ? 1.5 : 0, borderColor: p.ink, alignItems: "center", justifyContent: "center" }}>
                        <View style={{ width: swatch, height: swatch, borderRadius: swatch / 2, backgroundColor: c.hex, borderWidth: 1, borderColor: p.hair }} />
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </Group>
          </Rise>
        </View>
      </ScrollView>
      {/* A scroll edge, not a hard cut: the card fades into the page before it reaches the header. */}
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: layout.stack.section, transform: [{ scaleY: -1 }] }}>
        <EdgeFade height={layout.stack.section} />
      </View>
    </View>
  );
}

/** Fades a block in once, used for the step's own "continue" action when the work is done. */
export function Appear({ when, children }: { when: boolean; children: React.ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (when) Animated.timing(v, { toValue: 1, duration: 300, easing: ease.out, useNativeDriver: native }).start();
  }, [when, v]);
  if (!when) return null;
  return <Animated.View style={{ opacity: v }}>{children}</Animated.View>;
}
