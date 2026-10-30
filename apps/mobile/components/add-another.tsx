import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { joinAnd } from "../lib/ask";
import { useDandy } from "../lib/dandy";
import { layout, type, usePalette } from "../lib/theme";
import { queueWish } from "../lib/wish-queue";
import { Composer, KeyboardDock } from "./inputs";
import { Icon } from "./lux";

/**
 * Adding the next wish while one is still being found (owner, 2026-10-30: "While users are waiting for their items to
 * pop up with the pricing and pictures, we should prompt them if they want to add more onto the queue"). Nothing waits
 * on it and nothing covers the card being made.
 */

/** The chat's quiet line under the cards being found: a tap puts the cursor in the composer. */
export function AddAnotherPrompt({ onPress }: { onPress(): void }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({ alignSelf: "flex-start", minHeight: layout.control.icon, flexDirection: "row", alignItems: "center", gap: 8, opacity: pressed ? 0.6 : 1 })}
    >
      <Icon name="plus" size={14} color={p.accentText} />
      <Text style={[type.label, { color: p.ink2 }]}>Add another while you wait</Text>
    </Pressable>
  );
}

/**
 * The New wish screen's composer while its wish is being priced. What is sent joins the chat's queue (lib/wish-queue)
 * and is priced there in turn, so this screen keeps to its own wish; the line above says where each one went.
 */
export function AddAnotherDock({ onHeight }: { onHeight?(height: number): void }) {
  const p = usePalette();
  const dandy = useDandy();
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string[]>([]);
  return (
    <KeyboardDock onHeight={onHeight}>
      <View style={{ gap: layout.stack.tight }}>
        <Text accessibilityLiveRegion="polite" style={[type.footnote, { color: p.ink2, textAlign: "center" }]} numberOfLines={2}>
          {sent.length ? `Up next in the chat: ${joinAnd(sent.slice(-3))}` : "Add another while you wait"}
        </Text>
        <Composer
          value={text}
          onChangeText={setText}
          onSend={(t) => {
            if (!queueWish(t)) return;
            setSent((s) => [...s, t]);
            setText("");
          }}
          placeholder={`Tell ${dandy.name} what else you want...`}
          label="Add another wish"
        />
      </View>
    </KeyboardDock>
  );
}
