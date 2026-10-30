import { useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import type { WishQuestion } from "../lib/agent";
import { answerAsk, pickedLine, reopenAsk, startAsk, timeUpAsk, type Ask } from "../lib/ask";
import { OWN } from "../lib/own";
import { answerOf, refineChanged } from "../lib/refine";
import { layout, type, usePalette } from "../lib/theme";
import { AskBar, AskRow, useAskClock } from "./ask";
import { Chip } from "./lux";

/**
 * The questions behind a price, opened only when the person asks (owner, 2026-10-29: "should only appear if the user
 * clicks into it"). Each shows the answer the hunt used, on one line; one is open at a time with its choices, plus
 * "Type your own" in every one, since the choices never cover everything (owner: "Jubilee is not here").
 *
 * A tap is the whole answer (owner, 2026-10-30: "if they click it, it should be enough"): a changed answer hunts again
 * at once, with no button in between, and an unchanged one just closes the panel. Left alone, the open question keeps
 * the Dandy's pick, the panel closes and the Dandy says which (lib/ask.ts).
 */
export function RefinePanel({
  questions,
  edits,
  onEdit,
  onHunt,
  onClose,
}: {
  questions: WishQuestion[];
  edits: Record<string, string>;
  onEdit(id: string, answer: string): void;
  /** Some answer changed: hunt again with these. */
  onHunt(edits: Record<string, string>): void;
  /** Nothing changed: close, with the Dandy's line when time ran out and it kept its pick. */
  onClose(note: string | null): void;
}) {
  const p = usePalette();
  const ids = questions.map((q) => q.id);
  // Every question already holds the hunt's answer; the first, which moves the price most, opens.
  const [ask, setAsk] = useState<Ask>(() => (ids[0] ? reopenAsk(startAsk(ids, ids), ids[0]) : startAsk(ids, ids)));
  // Questions whose own-answer field the person opened.
  const [typing, setTyping] = useState<Record<string, true>>({});
  const latest = useRef({ edits, ask });
  latest.current = { edits, ask };

  const settle = (next: Record<string, string>, note: string | null) => (refineChanged(questions, next) ? onHunt(next) : onClose(note));
  const answer = (id: string, value: string) => {
    onEdit(id, value);
    setAsk(answerAsk(latest.current.ask, ids, id));
    settle({ ...latest.current.edits, [id]: value }, null);
  };
  const clock = useAskClock(ask.open, ask.open !== null, (key) => {
    const { edits: now, ask: a } = latest.current;
    const q = questions.find((x) => x.id === key);
    setAsk(timeUpAsk(a, ids).ask);
    settle(now, q ? pickedLine([answerOf(q, now) || q.picked]) : null);
  });

  return (
    <View style={{ gap: 6 }}>
      {questions.map((q) => {
        const value = answerOf(q, edits);
        if (ask.open !== q.id) {
          return (
            <AskRow
              key={q.id}
              title={q.label}
              answer={value || q.picked}
              onPress={() => {
                clock.touch();
                setAsk(reopenAsk(ask, q.id));
              }}
            />
          );
        }
        const own = !!typing[q.id] || (!!value && !q.options.includes(value));
        return (
          <View key={q.id} style={{ gap: 10, paddingVertical: 4 }}>
            <Text style={[type.callout, { color: p.ink }]}>{q.label}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {q.options.map((c) => (
                <Chip
                  key={c}
                  label={c}
                  selected={!own && value === c}
                  onPress={() => {
                    setTyping(({ [q.id]: _, ...rest }) => rest);
                    answer(q.id, c);
                  }}
                />
              ))}
              <Chip
                label={OWN}
                selected={own}
                onPress={() => {
                  clock.touch();
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
                onSubmitEditing={() => value.trim() && answer(q.id, value.trim())}
                onFocus={() => clock.typing(true)}
                onBlur={() => clock.typing(false)}
                style={[type.body, { color: p.ink, borderBottomWidth: 1, borderBottomColor: p.line, paddingVertical: layout.stack.tight }]}
              />
            ) : null}
            <AskBar windowMs={clock.windowMs} round={clock.round} />
          </View>
        );
      })}
    </View>
  );
}
