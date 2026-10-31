import { useState } from "react";
import { View } from "react-native";
import { space } from "../../lib/theme";
import { Chip } from "../lux";

/**
 * The answers to a question Dandy just asked, to tap instead of typing (owner, 2026-10-31: "simple click options or
 * questions"). The question is the line above it. One tap answers: the chosen answer stays lit and the rest go quiet,
 * and an older question in the chat can't be answered again.
 */
export function Choices({ options, live, onChoose }: { options: string[]; live: boolean; onChoose(option: string): void }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const open = live && !chosen;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[8] }} accessibilityRole="radiogroup">
      {options.map((o) => (
        <Chip
          key={o}
          label={o}
          selected={chosen === o}
          onPress={
            open
              ? () => {
                  setChosen(o);
                  onChoose(o);
                }
              : undefined
          }
        />
      ))}
    </View>
  );
}
