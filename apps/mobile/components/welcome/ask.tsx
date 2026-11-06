import { useRef, useState } from "react";
import { Platform, Text, View, useWindowDimensions, type TextInput } from "react-native";
import { haptic } from "../../lib/motion";
import { placeAgain, restTop, rests, type Frame } from "../../lib/rest-top";
import { fonts, layout, type, usePalette, useType } from "../../lib/theme";
import { KeyboardDock, KeyboardScroll, dockRoom } from "../inputs";
import { ErrorLine, Eyebrow, PrimaryButton } from "../lux";
import { WishField } from "../wish-field";
import { Chip, Rise } from "./kit";

/**
 * The first wish (owner, 2026-10-28: "the next card is them using the actual AI part... phrased in a very enticing
 * and beautiful way"): type it, or tap an idea from the pool. Since 2026-11-06 it is kept, not sent: AI prices it once
 * they have an account that has accepted how Dandelist uses AI (the owner: "the first thing they do when they login to
 * their account or make their account"), so saying it, which a model writes down, waits for the list too.
 */
export function Ask({ ideas, initial, bottomInset, onSubmit }: { ideas: string[]; initial: string; bottomInset: number; onSubmit(text: string): void }) {
  const p = usePalette();
  const t = useType();
  const { width } = useWindowDimensions();
  const gutter = layout.gutter(width);
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [dock, setDock] = useState<number>(layout.control.primary);
  const field = useRef<TextInput>(null);
  // On a wide screen the words rest at the optical centre of the room above the button (lib/rest-top.ts), measured
  // while the screen is untouched and kept once someone types or taps an idea, so nothing moves under them.
  const [frame, setFrame] = useState<Frame | null>(null);
  const [block, setBlock] = useState(0);
  const submit = () => {
    const wish = text.trim();
    if (wish.length < 2) return setError("Tell us one thing, in a few words.");
    haptic.select();
    onSubmit(wish);
  };
  const untouched = text === initial && !error;
  const below = dockRoom(dock, bottomInset);
  const top = rests(Platform.OS === "web", width) && frame && block ? restTop(frame.height, below, block) : 0;
  const wishField = <WishField ref={field} value={text} onChangeText={setText} onSubmit={submit} editable placeholder="A week at Amanzoe with my wife in May" />;

  return (
    <View style={{ flex: 1 }}>
      <KeyboardScroll
        dock={dock}
        onLayout={(e) => {
          const next = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
          setFrame((prev) => (placeAgain(prev, next) ? next : prev));
        }}
        contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: top, paddingBottom: below, width: "100%", maxWidth: layout.column + 2 * gutter, alignSelf: "center" }}
      >
        <View
          onLayout={(e) => {
            if (untouched || !block) setBlock(e.nativeEvent.layout.height);
          }}
          style={{ gap: layout.stack.section }}
        >
          <Rise style={{ gap: layout.stack.tight }}>
            <Eyebrow>Your first wish</Eyebrow>
            <Text accessibilityRole="header" style={[t.title1, { color: p.ink }]}>
              What would you love to <Text style={{ fontFamily: fonts.displayItalic, color: p.accentText }}>have</Text>?
            </Text>
            <Text style={[type.callout, { color: p.ink2, marginTop: layout.stack.tight }]}>Type it in a few words.</Text>
          </Rise>
          <Rise delay={60}>
            <View>
              {wishField}
            </View>
          </Rise>
          <Rise delay={120} style={{ gap: layout.stack.tight }}>
            <Eyebrow color={p.ink3}>Or start from an idea</Eyebrow>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: layout.stack.tight }}>
              {ideas.map((idea) => (
                <Chip key={idea} label={idea} selected={text === idea} onPress={() => { haptic.select(); setText(idea); setError(null); field.current?.focus(); }} />
              ))}
            </View>
          </Rise>
          <ErrorLine>{error}</ErrorLine>
        </View>
      </KeyboardScroll>
      <KeyboardDock onHeight={setDock}>
        <PrimaryButton label="Continue" onPress={submit} />
      </KeyboardDock>
    </View>
  );
}
