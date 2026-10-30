import { Text, View } from "react-native";
import { layout, type, usePalette } from "../lib/theme";
import { Chip, QuietButton } from "./lux";

/**
 * Under a card the reading had to work out (owner, 2026-10-30: "one of those cats that look like a miniature lion, but
 * I forgot what they're called", then "no, not that one", "yeah, that's the one"): it says the card is a best guess,
 * "Yes, that's the one" keeps it and the row goes away, each other likely name hunts that one instead, and "Something
 * else" lets them say more. One tap does each. `center` sets it under a centred title.
 */
export function GuessRow({ others, onConfirm, onPick, onElse, center = false }: { others: string[]; onConfirm(): void; onPick(name: string): void; onElse?(): void; center?: boolean }) {
  const p = usePalette();
  return (
    <View style={{ gap: layout.stack.tight, alignItems: center ? "center" : "flex-start" }}>
      <Text style={[type.footnote, { color: p.ink2, textAlign: center ? "center" : "left" }]}>Best guess from what you said.</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: center ? "center" : "flex-start" }}>
        <Chip label="Yes, that's the one" selected onPress={onConfirm} />
        {others.map((name) => (
          <Chip key={name} label={name} onPress={() => onPick(name)} />
        ))}
      </View>
      {onElse ? <QuietButton label="Something else" onPress={onElse} /> : null}
    </View>
  );
}
