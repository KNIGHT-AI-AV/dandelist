import type { Widget } from "@dandelist/catalogue/dream";
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { changeApplied, changeSession, ordered, type ChangeOps } from "../../lib/list-order";
import { haptic } from "../../lib/motion";
import { radius, type, usePalette } from "../../lib/theme";
import { useWishes } from "../../lib/wishes";
import { useHomeRemovals } from "../home/removals";
import { ErrorLine, Eyebrow, Glass, PrimaryButton, QuietButton } from "../lux";

const TIER = { must: "Must have", nice: "Nice to have", dream: "Dream" } as const;
const SHOWN = 5;

/**
 * A change to their list that their Dandy suggests (owner, 2026-10-30): the new top of the list, tier moves and what
 * leaves it, then Apply. Nothing changes before the tap; after it, one Undo puts the order and tiers back as they were
 * before the first attempt, even after a partial failure and a retry (a removal has its own Undo in the toast), and See
 * list shows the result. A reopened chat shows it as done.
 */
export function ListChangeCard({ w, onShowOnList }: { w: Extract<Widget, { kind: "list_change" }>; onShowOnList?(wishId: string): void }) {
  const p = usePalette();
  const { wishes, reorder, setTier } = useWishes();
  const removals = useHomeRemovals();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useRef(changeSession(w)).current;
  const [, redraw] = useState(0);
  // A wish waiting out its removal's undo window is already gone from every page.
  const listed = wishes.filter((x) => x.id !== removals.pendingId);
  const done = changeApplied(w, listed);
  const name = (id: string) => wishes.find((x) => x.id === id)?.name;
  const after = w.order.length ? ordered(listed, w.order) : listed;
  const top = after.filter((x) => !w.remove.includes(x.id)).slice(0, SHOWN);
  const moved = new Map(w.tiers.map((t) => [t.id, t.tier]));
  const leaving = w.remove.slice(0, 1).map(name).filter(Boolean);
  const ops: ChangeOps = {
    reorder,
    setTier,
    remove: (id) => {
      const x = wishes.find((y) => y.id === id);
      if (x) removals.remove(x, false);
    },
  };

  const act = async (step: () => Promise<void>, celebrate = false) => {
    setBusy(true);
    setError(null);
    try {
      await step();
      if (celebrate) haptic.success();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      redraw((n) => n + 1);
    }
  };

  return (
    <Glass style={{ padding: 16, gap: 14, borderRadius: radius.lg }}>
      <View style={{ gap: 4 }}>
        <Eyebrow color={p.accentText}>Your list</Eyebrow>
        <Text style={[type.title3, { color: p.ink }]}>{w.title}</Text>
      </View>
      <View style={{ gap: 8 }} accessibilityLabel={`The top of your list: ${top.map((x) => x.name).join(", ")}`}>
        {top.map((x, i) => (
          <View key={x.id} style={{ flexDirection: "row", alignItems: "baseline", gap: 10 }}>
            <Text style={[type.figure, { color: p.ink3, minWidth: 16 }]}>{i + 1}</Text>
            <Text numberOfLines={1} style={[type.callout, { color: p.ink, flexShrink: 1 }]}>
              {x.name}
            </Text>
            {moved.has(x.id) ? <Text style={[type.figure, { color: p.accentText }]}>{TIER[moved.get(x.id)!]}</Text> : null}
          </View>
        ))}
        {after.filter((x) => !w.remove.includes(x.id)).length > SHOWN ? (
          <Text style={[type.figure, { color: p.ink3 }]}>{`and ${after.filter((x) => !w.remove.includes(x.id)).length - SHOWN} more`}</Text>
        ) : null}
      </View>
      {leaving.length ? <Text style={[type.callout, { color: p.danger }]}>{`Leaves your list: ${leaving.join(", ")}`}</Text> : null}
      {error ? <ErrorLine>{error}</ErrorLine> : null}
      {done ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Text style={[type.label, { color: p.ink2 }]}>Done</Text>
          <View style={{ flexDirection: "row", gap: 4 }}>
            {session.canUndo && !busy ? <QuietButton label="Undo" onPress={() => void act(() => session.undo(ops))} /> : null}
            {top[0] ? <QuietButton label="See list" color={p.accentText} onPress={() => onShowOnList?.(top[0]!.id)} /> : null}
          </View>
        </View>
      ) : (
        <View style={{ gap: 4 }}>
          <PrimaryButton label="Apply" busy={busy} onPress={() => void act(() => session.apply(listed, ops), true)} />
          {/* After a part of it failed: put the list back as it was before the first try. */}
          {session.canUndo && !busy ? <QuietButton label="Undo" onPress={() => void act(() => session.undo(ops))} /> : null}
        </View>
      )}
    </Glass>
  );
}
