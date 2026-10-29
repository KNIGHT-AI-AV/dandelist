import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import type { WishQuestion } from "../lib/agent";
import { haptic } from "../lib/motion";
import { OWN } from "../lib/own";
import { answerOf, refineChanged } from "../lib/refine";
import { layout, type, usePalette } from "../lib/theme";
import { Chip, Hairline, PrimaryButton } from "./lux";

/**
 * The questions behind a price, opened only when the person asks (owner, 2026-10-29: "should only appear if the user
 * clicks into it"). Each shows the answer the hunt used and its choices, plus "Type your own" in every one, since the
 * choices never cover everything (owner: "Jubilee is not here").
 */
export function RefinePanel({ questions, edits, onEdit, onHunt }: { questions: WishQuestion[]; edits: Record<string, string>; onEdit(id: string, answer: string): void; onHunt(): void }) {
  const p = usePalette();
  // Questions whose own-answer field the person opened.
  const [typing, setTyping] = useState<Record<string, true>>({});
  return (
    <>
      {questions.map((q) => {
        const value = answerOf(q, edits);
        const own = !!typing[q.id] || (!!value && !q.options.includes(value));
        return (
          <View key={q.id} style={{ gap: 10 }}>
            <Hairline />
            <Text style={[type.callout, { color: p.ink }]}>{q.label}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {q.options.map((c) => (
                <Chip
                  key={c}
                  label={c}
                  selected={!own && value === c}
                  onPress={() => {
                    haptic.select();
                    setTyping(({ [q.id]: _, ...rest }) => rest);
                    onEdit(q.id, c);
                  }}
                />
              ))}
              <Chip
                label={OWN}
                selected={own}
                onPress={() => {
                  haptic.select();
                  setTyping((t) => ({ ...t, [q.id]: true }));
                  if (q.options.includes(value)) onEdit(q.id, "");
                }}
              />
            </View>
            {own ? (
              <TextInput
                value={value}
                onChangeText={(v) => onEdit(q.id, v.slice(0, 60))}
                placeholder="Your own answer"
                placeholderTextColor={p.ink3}
                accessibilityLabel={q.label}
                autoFocus={!!typing[q.id]}
                returnKeyType="done"
                style={[type.body, { color: p.ink, borderBottomWidth: 1, borderBottomColor: p.line, paddingVertical: layout.stack.tight }]}
              />
            ) : null}
          </View>
        );
      })}
      <PrimaryButton label="Hunt again with these" disabled={!refineChanged(questions, edits)} onPress={onHunt} />
    </>
  );
}
