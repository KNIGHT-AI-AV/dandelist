import { recurringBreakdown, upfrontCashCents } from "@dandelist/cost";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Keyboard, Pressable, RefreshControl, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../lib/auth";
import { comfortableIncome } from "../../lib/comfort";
import { useMoney } from "../../lib/currency";
import { useDandy } from "../../lib/dandy";
import { ease, haptic, native, useReducedMotion } from "../../lib/motion";
import { recheckWish } from "../../lib/rechecks";
import { UNDO_MS } from "../../lib/removal";
import { fonts, layout, radius, space, type, usePalette, useType } from "../../lib/theme";
import { loadWelcome, saveWelcome, toWishes } from "../../lib/welcome";
import { useWishes, type Wish } from "../../lib/wishes";
import { rememberCard, type Rect } from "../../lib/zoom";
import { DandyAvatar } from "../dandy-avatar";
import { dockRoom } from "../inputs";
import { ActionSheet, SheetRow } from "../list/action-sheet";
import { delayFor } from "../list/choreo";
import { Presence, Rise } from "../list/presence";
import { ListSkeleton } from "../list/skeleton";
import { TierControl } from "../list/tier-control";
import { Toast, type Note } from "../list/undo-toast";
import { useRemovals } from "../list/use-removals";
import { WishFace } from "../list/wish-card";
import { Backdrop, Chip, Eyebrow, Glass, Hairline, Money, PrimaryButton, Shade } from "../lux";
import { useHome } from "./bridge";
import { geometry, tailRoom } from "./card-metrics";
import { useTopRoom } from "./chrome";
import { DandyArea } from "./dandy-area";
import { GrowingCards, useCardLabel } from "./growing-cards";
import { usePager } from "./pager";

/**
 * After any sign-in (code, Apple, Google, GitHub, Facebook), the list someone kept on the welcome screen becomes
 * their first wishes. It runs once: the saved picks are cleared before the wishes are added, so a reload can't add
 * them twice.
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

const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
/** Until the Dandy's own suggestions arrive (lib/suggestions), these start a thought. */
const STARTERS = ["A weekend in Positano", "A Rolex Daytona", "A house with a view of the sea"];

/**
 * The field at the bottom has focus on the list: the list steps back and the Dandy comes forward with a few ideas,
 * so the page turns into the Dandy's own space while the words are typed (owner, recording 03).
 */
function FocusVeil({ on, ideas, onIdea }: { on: boolean; ideas: string[]; onIdea(text: string): void }) {
  const p = usePalette();
  const t = useType();
  const dandy = useDandy();
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  // Stays touchable while it fades out, so a tap on an idea that blurs the field still lands.
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (on) setLive(true);
    Animated.timing(v, { toValue: on ? 1 : 0, duration: reduced ? 0 : on ? 280 : 220, easing: ease.out, useNativeDriver: native }).start(({ finished }) => finished && !on && setLive(false));
  }, [on, v, reduced]);
  if (!live && !on) return null;
  return (
    <Animated.View pointerEvents={on || live ? "auto" : "none"} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: v }}>
      <Pressable accessibilityLabel="Close" onPress={Keyboard.dismiss} style={{ flex: 1, backgroundColor: `rgba(${p.bgRgb}, 0.86)` }} />
      <Animated.View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: "34%", alignItems: "center", gap: layout.stack.base, paddingHorizontal: layout.gutter(400), transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>
        <DandyAvatar dandy={dandy} size={44} />
        <Text style={[t.title2, { color: p.ink, textAlign: "center", fontFamily: fonts.titleItalic }]}>{`What should ${dandy.name} find for you?`}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: space[8] }}>
          {ideas.map((i) => (
            <Chip key={i} label={i} onPress={() => onIdea(i)} />
          ))}
        </View>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * The list (owner, recording 03): the total in the middle with the income that carries it comfortably (tap for the
 * money page), the Dandy's corner, then every wish as a full-width photograph, the one at the focus line opened up.
 * Swipe a card either way to remove it (with undo); hold it for its quick actions, including a fresh price check.
 */
export function ListPage() {
  const auth = useAuth();
  const home = useHome();
  const pager = usePager();
  const money = useMoney();
  const label = useCardLabel();
  const { wishes, status, error, reload, add, remove, setTier } = useWishes();
  useAdoptWelcome(auth.status === "signedIn" && status === "ready", add);
  const p = usePalette();
  const t = useType();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const top = useTopRoom();
  const late = useAfter(200);
  const gutter = layout.gutter(width);

  // Notes in the toast that aren't undo: a failed delete, tier change or refresh.
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
  const visible = useMemo(() => wishes.filter((w) => w.id !== pendingId), [wishes, pendingId]);

  // Quick actions: which card, where it sits, and what to do once the sheet has left.
  const [quick, setQuick] = useState<{ wish: Wish; at: Rect } | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const afterQuick = useRef<(() => void) | null>(null);
  const quickWish = quick ? (wishes.find((w) => w.id === quick.wish.id) ?? quick.wish) : null;
  const closeQuick = useCallback((then?: () => void) => {
    afterQuick.current = then ?? null;
    setQuickOpen(false);
  }, []);
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
  useEffect(() => {
    if (status === "error" && error && wishes.length) showError(error);
  }, [status, error]); // eslint-disable-line react-hooks/exhaustive-deps

  const openWish = (w: Wish, at?: Rect) => {
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
  const total = upfrontCashCents(items);
  const keepPerYear = recurringBreakdown(items).perMonth * 12;
  const income = comfortableIncome(total, keepPerYear);
  const count = `${visible.length} ${visible.length === 1 ? "wish" : "wishes"}`;
  const loading = (status === "loading" || status === "idle") && wishes.length === 0;
  const pendingNote = removals.pending;
  const note: Note | null = pendingNote ? { key: pendingNote.id, text: `Removed ${pendingNote.name}`, action: { label: "Undo", onPress: () => removals.undo(pendingNote.id) } } : errorNote;

  // The cards run edge to edge on a phone, and in a centred column on anything wider.
  const column = Math.min(width, layout.list + 2 * gutter);
  const g = useMemo(() => geometry(column), [column]);
  const scrollY = useRef(new Animated.Value(0)).current;
  const onScroll = useMemo(() => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: native }), [scrollY]);
  const [listTop, setListTop] = useState(0);
  const bottomRoom = dockRoom(home.dock || layout.control.primary, insets.bottom);
  // The focus line: the middle of what's visible between the top bar and the composer.
  const focus = (top + height - bottomRoom) / 2;

  return (
    <View style={{ flex: 1 }}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={refresh} tintColor={p.accent} colors={[p.accent]} progressBackgroundColor={p.surface} progressViewOffset={top} />}
        style={{ scrollbarWidth: "none" } as object}
        contentContainerStyle={{ paddingTop: top, paddingBottom: visible.length ? tailRoom(height, focus, g, bottomRoom) : bottomRoom }}
      >
        <View style={{ paddingHorizontal: gutter, width: "100%", maxWidth: layout.list + 2 * gutter, alignSelf: "center", gap: layout.stack.base }}>
          <Presence show={visible.length > 0} appear={0}>
            <View style={{ alignItems: "center", paddingTop: layout.stack.base, gap: 6 }}>
              <Eyebrow>The list</Eyebrow>
              <Pressable accessibilityRole="button" accessibilityLabel={`${money.format(total)}. Comfortable on ${money.format(income)} a year. Open money.`} onPress={() => pager.go("money")} style={{ alignItems: "center", gap: 4 }}>
                <Money cents={total} size="hero" style={{ alignSelf: "center" }} />
                <Text style={[type.callout, { color: p.ink2, textAlign: "center" }]}>
                  {"Comfortable on "}
                  <Text style={{ color: p.accentText }}>{money.compact(income)}</Text>
                  {" a year"}
                </Text>
              </Pressable>
              <Text style={[type.footnote, { color: p.ink3 }]}>{count}</Text>
            </View>
          </Presence>
          <Rise delay={delayFor(1)}>
            <DandyArea onOpen={() => pager.go("chat")} />
          </Rise>
        </View>

        <View onLayout={(e) => setListTop(e.nativeEvent.layout.y)} style={{ marginTop: layout.stack.base, width: column, alignSelf: "center" }}>
          {visible.length ? (
            <GrowingCards wishes={visible} g={g} scrollY={scrollY} listTop={listTop} focus={focus} width={column} onOpen={openWish} onQuick={openQuick} onRemove={(w) => removeWish(w, true)} />
          ) : null}

          <View style={{ paddingHorizontal: gutter }}>
            <Presence show={status === "error" && wishes.length === 0} appear={0}>
              <Glass style={{ padding: layout.cardPad, gap: space[12] }}>
                <Text style={[type.callout, { color: p.danger }]}>{error}</Text>
                <PrimaryButton label="Try again" onPress={() => reload()} />
              </Glass>
            </Presence>
            <Presence show={status === "ready" && visible.length === 0} appear={0}>
              <View style={{ height: 2 * g.rest, borderRadius: radius.lg, borderCurve: "continuous", overflow: "hidden", justifyContent: "flex-end", padding: layout.cardPad, gap: space[12] }}>
                <Backdrop source={require("../../assets/backdrop.jpg")} />
                <Shade from={0.1} />
                <Eyebrow color={p.ink}>Your first wish</Eyebrow>
                <Text style={[t.title1, { color: p.ink }]}>What do you want?</Text>
                <Text style={[type.callout, { color: p.ink2 }]}>Say it below. You get the real price, and what it costs to keep.</Text>
              </View>
            </Presence>
            <Presence show={late && loading} appear={0} collapse={false} rise={false}>
              <ListSkeleton />
            </Presence>
          </View>
        </View>
      </Animated.ScrollView>

      <FocusVeil on={home.focused} ideas={STARTERS} onIdea={(i) => home.ask(i)} />
      <Toast note={note} bottom={bottomRoom - space[12]} side={gutter} claim={claim} onHold={removals.hold} onRelease={removals.release} />

      {quick && quickWish ? (
        <ActionSheet
          anchor={quick.at}
          open={quickOpen}
          label={quickWish.name}
          onRequestClose={() => closeQuick()}
          onClosed={onQuickClosed}
          preview={
            <Pressable accessibilityRole="button" accessibilityLabel={label(quickWish)} onPress={() => closeQuick(() => openWish(quickWish, quick.at))} style={{ flex: 1, overflow: "hidden" }}>
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
            <SheetRow label="Check the price again" onPress={() => closeQuick(() => void recheckWish(auth.api, quickWish, reload))} />
          </Rise>
          <Rise delay={delayFor(4)}>
            <SheetRow
              label="Remove"
              danger
              onPress={() => {
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
