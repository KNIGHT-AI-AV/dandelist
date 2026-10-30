import type { Widget } from "@dandelist/catalogue/dream";
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { changeApplied, ordered, undoOf, type ListChange as Change } from "../../lib/list-order";
import { haptic } from "../../lib/motion";
import { radius, type, usePalette } from "../../lib/theme";
import { useWishes, type Wish } from "../../lib/wishes";
import { useHomeRemovals } from "../home/removals";
import { ErrorLine, Eyebrow, Glass, PrimaryButton, QuietButton } from "../lux";

const TIER = { must: "Must have", nice: "Nice to have", dream: "Dream" } as const;
const SHOWN = 5;

/**
 * A change to their list that their Dandy suggests (owner, 2026-10-30): the new top of the list, tier moves and what
 * leaves it, then Apply. Nothing changes before the tap; after it, one Undo puts the order and tiers back (a removal
 * has its own Undo in the toast) and See list shows the result. A reopened chat shows it as done.
 */
export function ListChangeCard({ w, onShowOnList }: { w: Extract<Widget, { kind: "list_change" }>; onShowOnList?(wishId: string): void }) {
  const p = usePalette();
  const { wishes, reorder, setTier } = useWishes();
  const removals = useHomeRemovals();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const undo = useRef<Change | null>(null);
  // A wish waiting out its removal's undo window is already gone from every page.
  const listed = wishes.filter((x) => x.id !== removals.pendingId);
  const done = changeApplied(w, listed);
  const name = (id: string) => wishes.find((x) => x.id === id)?.name;
  const after = w.order.length ? ordered(listed, w.order) : listed;
  const top = after.filter((x) => !w.remove.includes(x.id)).slice(0, SHOWN);
  const moved = new Map(w.tiers.map((t) => [t.id, t.tier]));
  const leaving = w.remove.map(name).filter(Boolean);

  const run = async (change: Change, removing: Wish[]) => {
    if (change.order.length) await reorder(change.order);
    for (const t of change.tiers) await setTier(t.id, t.tier);
    for (const x of removing) removals.remove(x, false);
  };

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      undo.current = undoOf(w, wishes);
      await run(w, wishes.filter((x) => w.remove.includes(x.id)));
      haptic.success();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const putBack = async () => {
    if (!undo.current) return;
    setBusy(true);
    setError(null);
    try {
      await run(undo.current, []);
      undo.current = null;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
            {undo.current ? <QuietButton label="Undo" onPress={() => void putBack()} /> : null}
            {top[0] ? <QuietButton label="See list" color={p.accentText} onPress={() => onShowOnList?.(top[0]!.id)} /> : null}
          </View>
        </View>
      ) : (
        <PrimaryButton label="Apply" busy={busy} onPress={() => void apply()} />
      )}
    </Glass>
  );
}
