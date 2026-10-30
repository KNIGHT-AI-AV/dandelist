import { useRef, useState } from "react";
import { Text, View, useWindowDimensions, type TextInput } from "react-native";
import { haptic } from "../../lib/motion";
import { fonts, layout, type, usePalette, useType } from "../../lib/theme";
import { transcribeGuest } from "../../lib/welcome";
import { KeyboardDock, KeyboardScroll, dockRoom } from "../inputs";
import { ErrorLine, Eyebrow, PrimaryButton } from "../lux";
import { ListeningPanel, MicButton, useVoiceWish } from "../voice/say-wish";
import { FIELD_MIN, WISH_MAX, WishField } from "../wish-field";
import { Chip, Rise } from "./kit";

/**
 * The first wish (owner, 2026-10-28: "the next card is them using the actual AI part... phrased in a very enticing
 * and beautiful way"). Every way to add something is on this one screen: type it, say it (Muse Voice Transcribe, no
 * account needed), or tap an idea from the pool. Submitting starts the agent pricing it for real, and the person
 * goes straight on to this or that while it works.
 */
export function Ask({ ideas, initial, bottomInset, onSubmit }: { ideas: string[]; initial: string; bottomInset: number; onSubmit(text: string): void }) {
  const p = usePalette();
  const t = useType();
  const { width } = useWindowDimensions();
  const gutter = layout.gutter(width);
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState(0);
  const [dock, setDock] = useState<number>(layout.control.primary);
  const field = useRef<TextInput>(null);
  const voice = useVoiceWish({
    transcribe: transcribeGuest,
    onHeard: (words) => {
      setText(words.slice(0, WISH_MAX));
      setHeard((n) => n + 1);
    },
    onError: setError,
  });
  const submit = () => {
    const wish = text.trim();
    if (wish.length < 2) return setError("Tell us one thing, in a few words.");
    haptic.select();
    onSubmit(wish);
  };
  const wishField = <WishField ref={field} value={text} onChangeText={setText} onSubmit={submit} editable placeholder="A week at Amanzoe with my wife in May" inset={voice.supported ? layout.control.icon + layout.stack.tight : 0} />;

  return (
    <View style={{ flex: 1 }}>
      <KeyboardScroll dock={dock} contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: dockRoom(dock, bottomInset), gap: layout.stack.section, width: "100%", maxWidth: layout.column + 2 * gutter, alignSelf: "center" }}>
        <Rise style={{ gap: layout.stack.tight }}>
          <Eyebrow>Your first wish</Eyebrow>
          <Text accessibilityRole="header" style={[t.title1, { color: p.ink }]}>
            What would you love to <Text style={{ fontFamily: fonts.displayItalic, color: p.accentText }}>have</Text>?
          </Text>
          <Text style={[type.callout, { color: p.ink2, marginTop: layout.stack.tight }]}>Type it or say it, as plainly as you'd tell a friend. Your Dandy starts finding the real price while you keep going.</Text>
        </Rise>
        <Rise delay={60}>
          <View>
            {voice.phase !== "idle" ? <ListeningPanel voice={voice} height={FIELD_MIN + layout.stack.tight + 1} /> : heard ? <Rise key={heard}>{wishField}</Rise> : wishField}
            <View style={{ position: "absolute", top: 0, right: 0 }}>
              <MicButton voice={voice} />
            </View>
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
      </KeyboardScroll>
      <KeyboardDock onHeight={setDock}>
        <PrimaryButton label="Find the real price" disabled={voice.phase !== "idle"} onPress={submit} />
      </KeyboardDock>
    </View>
  );
}
