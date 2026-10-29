import { upfrontCashCents } from "@dandelist/cost";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DetailRow } from "../details/detail-row";
import { SearchField } from "../details/search-field";
import { TierPips } from "../details/tier-pips";
import { useDescriptions } from "../details/use-descriptions";
import { useWishSearch } from "../details/use-wish-search";
import { Presence, Swap } from "../list/presence";
import { Toast, type Note } from "../list/undo-toast";
import { useRemovals } from "../list/use-removals";
import { AgentDot, Eyebrow, Hairline, Money } from "../lux";
import { useMoney } from "../../lib/currency";
import { UNDO_MS } from "../../lib/removal";
import { layout, space, type, usePalette } from "../../lib/theme";
import { useWishes, type Wish, type WishTier } from "../../lib/wishes";
import { TIER_LABEL, TIER_RANK } from "../../lib/words";
import { useTopRoom } from "./chrome";

/** The tiers in scale order: Must have, Would love, Someday. */
const TIERS = (Object.keys(TIER_RANK) as WishTier[]).sort((a, b) => TIER_RANK[a] - TIER_RANK[b]);

const countOf = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A tier's heading: its mark on the scale, its name, and what its wishes come to. */
function TierHeading({ tier, cents, count }: { tier: WishTier; cents: number; count: number }) {
  const p = usePalette();
  const money = useMoney();
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${TIER_LABEL[tier]}, ${countOf(count, "wish", "wishes")}, ${money.format(cents)}`}
      style={{ flexDirection: "row", alignItems: "center", gap: space[8], paddingBottom: space[8] }}
    >
      <TierPips tier={tier} color={p.ink2} />
      <Eyebrow style={{ flex: 1 }}>{TIER_LABEL[tier]}</Eyebrow>
      <Money cents={cents} size="ledger15" color={p.ink2} align="right" />
    </View>
  );
}

/**
 * Details (owner, recording 03, renamed from "the plan"): every wish in one condensed list, grouped by how much it
 * is wanted, with the total and a subtotal per tier. Search finds wishes by meaning: instant matches on the phone,
 * then a ranking by meaning when those are weak. Tap a row to open the wish; swipe it either way to remove it, with
 * Undo in the toast. Sideways swipes anywhere else turn the page.
 */
export function DetailsPage() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const top = useTopRoom();
  const gutter = layout.gutter(width);
  const { wishes, status, remove } = useWishes();
  useDescriptions();

  const [errorNote, setErrorNote] = useState<Note | null>(null);
  const showError = useCallback((text: string) => setErrorNote({ key: `error:${Date.now()}`, text }), []);
  useEffect(() => {
    if (!errorNote) return;
    const timer = setTimeout(() => setErrorNote(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [errorNote]);
  const removals = useRemovals(remove, showError);
  const [claim, setClaim] = useState(0);
  const pendingId = removals.pending?.id;
  const begin = removals.remove;
  const removeWish = useCallback(
    (w: Wish) => {
      begin(w);
      // Undo takes the focus the removed row had (on the web, or with a screen reader on).
      setClaim((c) => c + 1);
    },
    [begin],
  );
  const openWish = useCallback((w: Wish) => router.push(`/wishes/${w.id}`), []);

  const [query, setQuery] = useState("");
  const search = useWishSearch(wishes, query);
  // The field only shows once there are wishes; a query left over from before can't hide an empty list.
  const searching = wishes.length > 0 && query.trim().length > 0;

  const visible = useMemo(() => wishes.filter((w) => w.id !== pendingId), [wishes, pendingId]);
  const byId = useMemo(() => new Map(wishes.map((w) => [w.id, w])), [wishes]);
  const groups = useMemo(
    () =>
      TIERS.map((tier) => {
        const rows = wishes.filter((w) => w.tier === tier).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const shown = rows.filter((w) => w.id !== pendingId);
        return { tier, rows, shown, cents: upfrontCashCents(shown.map((w) => w.item)) };
      }),
    [wishes, pendingId],
  );
  const found = search.ids.filter((id) => id !== pendingId);
  const total = upfrontCashCents(visible.map((w) => w.item));

  const pending = removals.pending;
  const note: Note | null = pending ? { key: pending.id, text: `Removed ${pending.name}`, action: { label: "Undo", onPress: () => removals.undo(pending.id) } } : errorNote;

  // Each row brings the rule above it, so a row that leaves takes its own rule along.
  const row = (w: Wish) => (
    <Presence key={w.id} show={w.id !== pendingId}>
      <Hairline />
      <DetailRow w={w} onOpen={openWish} onRemove={removeWish} />
    </Presence>
  );

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        style={{ scrollbarWidth: "thin", scrollbarColor: `rgba(${p.inkRgb},0.2) transparent` } as object}
        contentContainerStyle={{
          paddingTop: top + layout.stack.section,
          paddingBottom: insets.bottom + layout.control.field + space[48],
          paddingHorizontal: gutter,
          gap: layout.stack.section,
          width: "100%",
          maxWidth: layout.list + 2 * gutter,
          alignSelf: "center",
        }}
      >
        <View style={{ gap: layout.stack.tight }}>
          <Eyebrow>Details</Eyebrow>
          <Money cents={total} size="title" />
          <Swap k={String(visible.length)}>
            <Text style={[type.footnote, { color: p.ink2 }]}>{countOf(visible.length, "wish", "wishes")}</Text>
          </Swap>
        </View>

        {wishes.length ? <SearchField value={query} onChangeText={setQuery} placeholder="Search your wishes" /> : null}

        {searching ? (
          <View style={{ gap: space[8] }}>
            {found.length || search.working ? (
              <View style={{ flexDirection: "row", alignItems: "center", minHeight: 20, gap: space[8] }} accessibilityLiveRegion="polite" aria-live="polite">
                <Eyebrow style={{ flex: 1 }}>{found.length ? countOf(found.length, "match", "matches") : ""}</Eyebrow>
                {search.working ? (
                  <>
                    <AgentDot busy />
                    <Text style={[type.footnote, { color: p.ink3 }]}>Searching by meaning</Text>
                  </>
                ) : null}
              </View>
            ) : null}
            {found.length ? (
              <View>
                {search.ids.map((id) => {
                  const w = byId.get(id);
                  return w ? row(w) : null;
                })}
                <Hairline />
              </View>
            ) : search.working ? null : (
              <View accessibilityLiveRegion="polite" aria-live="polite" style={{ gap: space[4] }}>
                <Text style={[type.callout, { color: p.ink }]}>{`Nothing matches “${query.trim()}”.`}</Text>
                <Text style={[type.footnote, { color: p.ink2 }]}>Try a word like travel, home or family.</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={{ gap: layout.stack.section }}>
            {groups.map((g) => (
              <Presence key={g.tier} show={g.shown.length > 0}>
                <TierHeading tier={g.tier} cents={g.cents} count={g.shown.length} />
                {g.rows.map(row)}
                <Hairline />
              </Presence>
            ))}
            {status === "ready" && !visible.length ? <Text style={[type.callout, { color: p.ink2 }]}>Your wishes appear here once you add them.</Text> : null}
          </View>
        )}
      </ScrollView>

      <Toast note={note} bottom={insets.bottom + space[16]} side={gutter} claim={claim} onHold={removals.hold} onRelease={removals.release} />
    </View>
  );
}
