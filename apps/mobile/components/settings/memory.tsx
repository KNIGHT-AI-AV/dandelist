import { Text, View } from "react-native";
import type { Memory } from "../../lib/memory";
import { radius, type, usePalette } from "../../lib/theme";
import { ErrorLine, Glass } from "../lux";
import { RowAction } from "./kit";

/**
 * What the Dandy remembers about the person between conversations (api memory.ts; owner, 2026-10-31: "retain that
 * memory and retain its personality"): each line as it is kept, with Forget beside it, and Forget everything under
 * them. `busy` is the line being forgotten, or "all".
 */
export function MemoryCard({ memories, busy, error, onForget, onForgetAll }: { memories: Memory[]; busy: string | null; error: string | null; onForget(id: string): void; onForgetAll(): void }) {
  const p = usePalette();
  return (
    <Glass style={{ borderRadius: radius.lg, borderCurve: "continuous", padding: 20, gap: 16 }}>
      {memories.length ? (
        <View style={{ gap: 12 }} accessibilityRole="list">
          {memories.map((m) => (
            <View key={m.id} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Text style={[type.callout, { flex: 1, color: p.ink }]}>{m.text}</Text>
              <RowAction label="Forget" tone="quiet" busy={busy === m.id} disabled={!!busy} onPress={() => onForget(m.id)} />
            </View>
          ))}
        </View>
      ) : (
        <Text style={[type.callout, { color: p.ink2 }]}>Nothing yet. As you chat, the lasting things you mention about yourself will show up here.</Text>
      )}
      <ErrorLine>{error}</ErrorLine>
      {memories.length > 1 ? (
        <View style={{ alignItems: "flex-start" }}>
          <RowAction label="Forget everything" tone="danger" busy={busy === "all"} disabled={!!busy} onPress={onForgetAll} />
        </View>
      ) : null}
    </Glass>
  );
}
