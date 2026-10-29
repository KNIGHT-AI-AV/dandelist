import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Platform, Pressable, Text, TextInput, View } from "react-native";
import { DANDY_COLORS, DANDY_NAME_MAX, PERSONAS, SHAPES, cleanName, saveDandy, useDandy, type Dandy } from "../../lib/dandy";
import { haptic, native, useReducedMotion } from "../../lib/motion";
import { fonts, layout, radius, type, usePalette } from "../../lib/theme";
import { DandyAvatar } from "../dandy-avatar";
import { Eyebrow, Glass } from "../lux";

/**
 * Customising the Dandy (owner, 2026-10-28): a name, one of four personalities that changes how it speaks, one of five
 * shapes and one of ten house colours. Shared by the welcome flow ("Meet your Dandy") and settings. Every choice is
 * kept on this device at once, so the mark everywhere follows it.
 */

/** The Dandy being edited: what is shown, the name as typed, and a small spring on the mark when a choice lands. */
export interface DandyDraft {
  dandy: Dandy;
  /** `dandy` with the name as typed so far, for the mark and any line that names it. */
  shown: Dandy;
  name: string;
  setName(name: string): void;
  keepName(): void;
  choose(next: Partial<Dandy>): void;
  /** Scale for the mark: 1 at rest, a quick pop after each choice. */
  pop: Animated.Value;
}

export function useDandyDraft(): DandyDraft {
  const reduced = useReducedMotion();
  const saved = useDandy();
  const [dandy, setDandy] = useState<Dandy>(saved);
  const [name, setName] = useState(saved.name);
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

  return { dandy, shown: { ...dandy, name: name || dandy.name }, name, setName: (v) => setName(v.slice(0, DANDY_NAME_MAX)), keepName, choose, pop };
}

/** A labelled group of choices. */
export function Group({ label, children }: { label: string; children: ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ gap: 10 }}>
      <Eyebrow color={p.ink3}>{label}</Eyebrow>
      {children}
    </View>
  );
}

/** The four groups: its name, its personality, its shape, its colour. The parent sets the gap between them. */
export function DandyFields({ draft }: { draft: DandyDraft }) {
  const p = usePalette();
  const { dandy, shown, name, setName, keepName, choose } = draft;
  const swatch = 30;
  return (
    <>
      <Group label="Its name">
        <Glass style={{ borderRadius: radius.control, borderCurve: "continuous", paddingHorizontal: 16 }}>
          <TextInput
            value={name}
            onChangeText={setName}
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
    </>
  );
}

/** The editor for settings: the mark with its name and personality above the four groups. */
export function DandyEditor() {
  const p = usePalette();
  const draft = useDandyDraft();
  const persona = PERSONAS.find((x) => x.id === draft.dandy.persona);
  return (
    <View style={{ gap: layout.stack.section }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: layout.stack.base }}>
        <Animated.View style={{ transform: [{ scale: draft.pop }] }}>
          <DandyAvatar dandy={draft.shown} size={64} />
        </Animated.View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[type.title3, { color: p.ink, fontFamily: fonts.titleItalic }]} numberOfLines={1}>{draft.shown.name}</Text>
          {persona ? <Text style={[type.footnote, { color: p.ink2 }]}>{`${persona.name}. ${persona.line}`}</Text> : null}
        </View>
      </View>
      <DandyFields draft={draft} />
    </View>
  );
}
