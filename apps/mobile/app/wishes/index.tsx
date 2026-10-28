import { recurringBreakdown, upfrontCashCents } from "@dandelist/cost";
import { Redirect, router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, RefreshControl, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AgentDot, Backdrop, EdgeFade, Eyebrow, Glass, Grain, Hairline, Icon, Money, PrimaryButton, QuietButton, Shade, Wordmark } from "../../components/lux";
import { Atmosphere } from "../../components/atmosphere";
import { ActionSheet, SheetRow } from "../../components/list/action-sheet";
import { choreo, delayFor } from "../../components/list/choreo";
import { AVATAR, CARD_GAP, DOCK_END, DOCK_LIFT, DOCK_PILL, DOCK_SEND, EMPTY_HEIGHT, cardHeights, toastBottom } from "../../components/list/metrics";
import { Presence, Rise, Swap } from "../../components/list/presence";
import { ListSkeleton } from "../../components/list/skeleton";
import { TierControl } from "../../components/list/tier-control";
import { Toast, type Note } from "../../components/list/undo-toast";
import { useRemovals } from "../../components/list/use-removals";
import { WishCard, WishFace, cardLabel } from "../../components/list/wish-card";
import { useAuth } from "../../lib/auth";
import { formatCents } from "../../lib/money";
import { haptic, usePress } from "../../lib/motion";
import { UNDO_MS } from "../../lib/removal";
import { layout, radius, space, type, usePalette, useType } from "../../lib/theme";
import { loadWelcome, saveWelcome, toWishes } from "../../lib/welcome";
import { useWishes, type Wish } from "../../lib/wishes";
import { hostOf, midSentence, whenChecked } from "../../lib/words";
import { rememberCard, type Rect } from "../../lib/zoom";

/**
 * After any sign-in (code, Apple, Google, GitHub), the list someone kept on the welcome screen becomes their first
 * wishes. It runs once: the saved picks are cleared before the wishes are added, so a reload can't add them twice.
 */
function useAdoptWelcome(ready: boolean, add: ReturnType<typeof useWishes>["add"]) {
  const started = useRef(false);
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    void (async () => {
      const kept = await loadWelcome();
      if (!kept?.kept || (!kept.items.length && !kept.wish?.option)) return;
      await saveWelcome(null);
      for (const w of toWishes(kept)) await add(w).catch(() => null);
    })();
  }, [ready, add]);
}

/** True once `ms` have passed: waits under a second show nothing rather than a flash (NN/g, UI audit P2-26). */
function useAfter(ms: number) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOn(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return on;
}

/** Loading placeholders wait this long, so a quick load shows nothing rather than a flash. */
const SKELETON_AFTER_MS = 200;

const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export default function LifeList() {
  const auth = useAuth();
  const { wishes, status, error, reload, add, remove, setTier } = useWishes();
  useAdoptWelcome(auth.status === "signedIn" && status === "ready", add);
  const p = usePalette();
  const t = useType();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const late = useAfter(SKELETON_AFTER_MS);
  const avatarPress = usePress(choreo.pressedSmall);
  const dockPress = usePress();
  // When the wishes arrive after the screen (a cold start), the page builds itself top to bottom. When they are
  // already here, the screen arrives with its navigation transition and nothing replays.
  const [arriving] = useState(() => wishes.length === 0);
  const appear = (order: number) => (arriving ? delayFor(order) : undefined);
  // Cards that turn up later (a refresh, a delete the server refused) rise in rather than pop.
  const [onScreenAtStart] = useState(() => new Set(wishes.map((w) => w.id)));
  const cardAppear = (w: Wish, order: number) => (arriving ? delayFor(order) : onScreenAtStart.has(w.id) ? undefined : 0);

  // Notes in the toast that aren't undo: a failed delete, tier change or refresh.
  const [errorNote, setErrorNote] = useState<Note | null>(null);
  const showError = useCallback((text: string) => setErrorNote({ key: `error:${Date.now()}`, text }), []);
  useEffect(() => {
    if (!errorNote) return;
    const timer = setTimeout(() => setErrorNote(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [errorNote]);

  const removals = useRemovals(remove, showError);
  // Focus requests for the toast's Undo (see Toast's `claim`).
  const [claim, setClaim] = useState(0);
  const pendingId = removals.pending?.id;
  const hidden = useMemo(() => new Set(pendingId ? [pendingId] : []), [pendingId]);
  const visible = useMemo(() => wishes.filter((w) => !hidden.has(w.id)), [wishes, hidden]);
  const heights = useMemo(() => cardHeights(wishes.map((w) => w.id), hidden), [wishes, hidden]);

  // Quick actions: which card, where it sits, and what to do once the sheet has left. The sheet shows the store's
  // copy of the wish (so a tier change shows at once) and keeps its own while a removal plays out under it.
  const [quick, setQuick] = useState<{ wish: Wish; at: Rect } | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const afterQuick = useRef<(() => void) | null>(null);
  const quickWish = quick ? (wishes.find((w) => w.id === quick.wish.id) ?? quick.wish) : null;
  const closeQuick = useCallback((then?: () => void) => {
    afterQuick.current = then ?? null;
    setQuickOpen(false);
  }, []);
  const dismissQuick = useCallback(() => closeQuick(), [closeQuick]);
  const onQuickClosed = useCallback(() => {
    const then = afterQuick.current;
    afterQuick.current = null;
    setQuick(null);
    then?.();
  }, []);

  const [pulling, setPulling] = useState(false);
  const refresh = useCallback(async () => {
    setPulling(true);
    await reload();
    setPulling(false);
  }, [reload]);
  // A failed refresh keeps the list on screen and says so in the toast; the full error state is for an empty list.
  useEffect(() => {
    if (status === "error" && error && wishes.length) showError(error);
  }, [status, error]); // eslint-disable-line react-hooks/exhaustive-deps

  // App Store rule 5.1.1(v): accounts can be deleted from inside the app. A second tap confirms.
  const deleteAccount = async () => {
    if (!confirmDelete) return setConfirmDelete(true);
    const res = await auth.api("/me", { method: "DELETE" }).catch(() => null);
    if (res?.ok || res?.status === 204) await auth.signOut();
  };
  if (auth.status === "signedOut") return <Redirect href="/sign-in" />;

  const openWish = (w: Wish, at?: Rect) => {
    // The detail zooms out of this card: remember where it is (by id, not by view) before navigating.
    if (at) rememberCard(w.id, at);
    router.push(`/wishes/${w.id}`);
  };
  const openQuick = (w: Wish, at: Rect) => {
    haptic.select();
    setQuick({ wish: w, at });
    setQuickOpen(true);
  };
  const removeWish = (w: Wish, focusUndo: boolean) => {
    removals.remove(w);
    if (focusUndo) setClaim((c) => c + 1);
  };

  const items = visible.map((w) => w.item);
  const monthly = recurringBreakdown(items).perMonth;
  // The briefing is the agent's most recent real check, never an invented event (a typical price has no page).
  const latest = visible.filter((w) => w.details.agent?.url).sort((a, b) => b.details.agent!.checkedAt.localeCompare(a.details.agent!.checkedAt))[0];
  const gutter = layout.gutter(width);
  const dock = layout.dockHeight(insets.bottom);
  const count = `${visible.length} ${visible.length === 1 ? "wish" : "wishes"}`;
  const runLine = monthly ? `${formatCents(monthly)} a month to run · ${count}` : count;
  const briefing = latest
    ? `Priced ${midSentence(latest.name)} at ${formatCents(latest.item.upfrontCents)}, ${latest.details.agent!.status === "verified" ? "checked on" : "an estimate from"} ${hostOf(latest.details.agent!.url)} ${whenChecked(latest.details.agent!.checkedAt)}.`
    : "";
  const loading = (status === "loading" || status === "idle") && wishes.length === 0;
  const pendingNote = removals.pending;
  const note: Note | null = pendingNote
    ? { key: pendingNote.id, text: `Removed ${pendingNote.name}`, action: { label: "Undo", onPress: () => removals.undo(pendingNote.id) } }
    : errorNote;

  const menuRows: { label: string; go(): void }[] = [
    { label: "The plan", go: () => router.push("/plan") },
    { label: "Theme", go: () => router.push("/theme") },
    { label: "Enter a wish yourself", go: () => router.push("/wishes/manual") },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <Atmosphere />
      <ScrollView
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={refresh} tintColor={p.accent} colors={[p.accent]} progressBackgroundColor={p.surface} progressViewOffset={insets.top} />}
        style={{ scrollbarWidth: "thin", scrollbarColor: `rgba(${p.inkRgb},0.2) transparent` } as object}
        contentContainerStyle={{ paddingTop: insets.top, paddingBottom: dock, paddingHorizontal: gutter, width: "100%", maxWidth: layout.list + 2 * gutter, alignSelf: "center" }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", height: layout.headerBar }}>
          <Wordmark />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Menu"
            accessibilityState={{ expanded: menu }}
            onPress={() => setMenu((m) => !m)}
            onPressIn={avatarPress.onPressIn}
            onPressOut={avatarPress.onPressOut}
            style={{ width: layout.control.chip, height: layout.control.chip, alignItems: "center", justifyContent: "center" }}
          >
            <Animated.View style={{ width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, borderWidth: 1, borderColor: p.line, backgroundColor: p.surface, alignItems: "center", justifyContent: "center", transform: [{ scale: avatarPress.scale }] }}>
              <Text style={[type.label, { color: p.ink2 }]}>{(auth.user?.email ?? "·").slice(0, 1).toUpperCase()}</Text>
            </Animated.View>
          </Pressable>
        </View>

        <Presence show={menu}>
          <Glass style={{ marginTop: layout.stack.tight, paddingVertical: space[4] }}>
            {menuRows.map((row, i) => (
              <Rise key={row.label} delay={delayFor(i)}>
                <QuietButton label={row.label} onPress={() => { setMenu(false); row.go(); }} />
              </Rise>
            ))}
            <Rise delay={delayFor(3)}>
              <QuietButton label="Sign out" onPress={() => auth.signOut()} />
            </Rise>
            <Rise delay={delayFor(4)}>
              <QuietButton label="Privacy" onPress={() => { setMenu(false); router.push("/privacy"); }} />
            </Rise>
            <Rise delay={delayFor(5)}>
              <QuietButton label="Terms" onPress={() => { setMenu(false); router.push("/terms"); }} />
            </Rise>
            <Rise delay={delayFor(6)}>
              <Swap k={confirmDelete ? "confirm" : "ask"}>
                <QuietButton label={confirmDelete ? "Tap again to delete everything" : "Delete my account"} onPress={deleteAccount} />
              </Swap>
            </Rise>
          </Glass>
        </Presence>

        {/* The content area. The loading placeholders lie over it and cross-fade into what arrives. */}
        <View>
          <Presence show={visible.length > 0} appear={appear(0)}>
            <View style={{ paddingTop: layout.stack.section, gap: layout.stack.tight }}>
              <Eyebrow>The life you want</Eyebrow>
              <Money cents={upfrontCashCents(items)} size="hero" />
              <Swap k={runLine}>
                <Text style={[type.footnote, { color: p.ink2 }]}>{runLine}</Text>
              </Swap>
              <Pressable accessibilityRole="link" onPress={() => router.push("/plan")} style={{ alignSelf: "flex-start", minHeight: layout.control.chip, justifyContent: "center" }}>
                <Text style={[type.label, { color: p.accentText }]}>See when you can have it all</Text>
              </Pressable>
            </View>
          </Presence>

          <Presence show={!!latest} appear={appear(1)}>
            {latest ? (
              <Glass style={{ marginTop: layout.stack.base, padding: layout.cardPad, gap: layout.stack.tight }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space[8] }}>
                  <AgentDot />
                  <Eyebrow>Your agent</Eyebrow>
                </View>
                <Swap k={briefing}>
                  <Text style={[type.callout, { color: p.ink }]}>{briefing}</Text>
                </Swap>
              </Glass>
            ) : null}
          </Presence>

          <View style={{ marginTop: layout.stack.base }}>
            {wishes.map((w, i) => (
              <Presence key={w.id} show={!hidden.has(w.id)} height={heights.get(w.id)} gap={CARD_GAP} appear={cardAppear(w, i + 2)}>
                <WishCard w={w} hidden={hidden.has(w.id)} onOpen={openWish} onQuick={openQuick} onRemove={(x) => removeWish(x, true)} />
              </Presence>
            ))}

            <Presence show={status === "error" && wishes.length === 0} appear={0}>
              <Glass style={{ padding: layout.cardPad, gap: space[12] }}>
                <Text style={[type.callout, { color: p.danger }]}>{error}</Text>
                <PrimaryButton label="Try again" onPress={() => reload()} />
              </Glass>
            </Presence>

            <Presence show={status === "ready" && visible.length === 0} appear={0}>
              <View style={{ height: EMPTY_HEIGHT, borderRadius: radius.lg, borderCurve: "continuous", overflow: "hidden", justifyContent: "flex-end", padding: layout.cardPad, gap: space[12] }}>
                <Backdrop source={require("../../assets/backdrop.jpg")} />
                <Shade from={0.1} />
                <Eyebrow color={p.ink}>Your first wish</Eyebrow>
                <Text style={[t.title1, { color: p.ink }]}>Price the life you want.</Text>
                <Text style={[type.callout, { color: p.ink2 }]}>Tell the agent what you want. It finds the real price and what it costs over the years.</Text>
              </View>
            </Presence>
          </View>

          <Presence show={late && loading} appear={0} collapse={false} rise={false} style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
            <ListSkeleton />
          </Presence>
        </View>
      </ScrollView>

      <EdgeFade height={dock} />
      <Toast note={note} bottom={toastBottom(insets.bottom)} side={gutter} claim={claim} onHold={removals.hold} onRelease={removals.release} />
      <View style={{ position: "absolute", left: 0, right: 0, bottom: insets.bottom + DOCK_LIFT, alignItems: "center", paddingHorizontal: gutter, pointerEvents: "box-none" }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Tell me what you want" onPress={() => router.push("/dream")} onPressIn={dockPress.onPressIn} onPressOut={dockPress.onPressOut} style={{ width: "100%", maxWidth: layout.list }}>
          <Animated.View style={{ transform: [{ scale: dockPress.scale }] }}>
            <Glass intensity={60} style={{ height: DOCK_PILL, borderRadius: radius.pill, flexDirection: "row", alignItems: "center", paddingLeft: layout.cardPad, paddingRight: DOCK_END }}>
              <Text style={[type.body, { flex: 1, color: p.ink2 }]}>Tell me what you want...</Text>
              <View style={{ width: DOCK_SEND, height: DOCK_SEND, borderRadius: DOCK_SEND / 2, backgroundColor: p.ink, alignItems: "center", justifyContent: "center" }}>
                <Icon name="plus" color={p.onAccent} />
              </View>
            </Glass>
          </Animated.View>
        </Pressable>
      </View>
      <Grain />

      {quick && quickWish ? (
        <ActionSheet
          anchor={quick.at}
          open={quickOpen}
          label={quickWish.name}
          onRequestClose={dismissQuick}
          onClosed={onQuickClosed}
          preview={
            <Pressable accessibilityRole="button" accessibilityLabel={cardLabel(quickWish)} onPress={() => closeQuick(() => openWish(quickWish, quick.at))} style={{ flex: 1, borderRadius: radius.lg, borderCurve: "continuous", overflow: "hidden" }}>
              <WishFace w={quickWish} still />
            </Pressable>
          }
        >
          <Rise delay={delayFor(1)}>
            <TierControl value={quickWish.tier} onChange={(tier) => setTier(quickWish.id, tier).catch((e: unknown) => showError(errorText(e, "Couldn't save the wish.")))} />
          </Rise>
          <Rise delay={delayFor(2)}>
            <Hairline style={{ marginVertical: space[8] }} />
            <SheetRow label="Open" onPress={() => closeQuick(() => openWish(quickWish, quick.at))} />
          </Rise>
          <Rise delay={delayFor(3)}>
            <SheetRow
              label="Remove"
              danger
              onPress={() => {
                // The card fades out under its lifted copy while the sheet leaves, so the two read as one.
                removeWish(quickWish, false);
                closeQuick(() => setClaim((c) => c + 1));
              }}
            />
          </Rise>
        </ActionSheet>
      ) : null}
    </View>
  );
}
