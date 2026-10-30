import { recurringBreakdown, upfrontCashCents } from "@dandelist/cost";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Keyboard, Pressable, RefreshControl, Text, View, useWindowDimensions, type ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { adoptWelcome, priceFirstWish } from "../../lib/adopt";
import { useAuth } from "../../lib/auth";
import { comfortableIncome } from "../../lib/comfort";
import { useMoney } from "../../lib/currency";
import { useDandy } from "../../lib/dandy";
import { ease, haptic, native, useReducedMotion } from "../../lib/motion";
import { recheckWish } from "../../lib/rechecks";
import { useSuggestions } from "../../lib/suggestions";
import { fonts, layout, radius, space, type, usePalette, useType } from "../../lib/theme";
import { loadWelcome, saveWelcome, toWishes } from "../../lib/welcome";
import { useWishes, type Wish } from "../../lib/wishes";
import { countLine, counted, worthOf } from "../../lib/worth";
import { rememberCard, type Rect } from "../../lib/zoom";
import { DandyAvatar } from "../dandy-avatar";
import { dockRoom } from "../inputs";
import { ActionSheet, SheetRow } from "../list/action-sheet";
import { delayFor } from "../list/choreo";
import { Presence, Rise } from "../list/presence";
import { ListSkeleton } from "../list/skeleton";
import { TodayCards } from "../list/today-cards";
import { TierControl } from "../list/tier-control";
import { WishFace } from "../list/wish-card";
import { Backdrop, Chip, Eyebrow, Glass, Hairline, Money, PrimaryButton, Shade } from "../lux";
import { useHome } from "./bridge";
import { geometry, revealAt, tailRoom } from "./card-metrics";
import { useTopRoom } from "./chrome";
import { DandyArea } from "./dandy-area";
import { GrowingCards, useCardLabel } from "./growing-cards";
import { usePager } from "./pager";
import { useHomeRemovals } from "./removals";

type Api = ReturnType<typeof useAuth>["api"];

/**
 * After any sign-in (code, Apple, Google, GitHub, Facebook), the list someone kept on the welcome screen becomes
 * their first wishes (Codex R01). Each one comes off the saved list only once the server has it, so a dropped
 * connection or a closed app loses nothing and the rest is tried again next time; a wish the account already holds
 * is not written twice. A first wish that couldn't be priced before sign-in is priced now, as the welcome promised.
 */
function useAdoptWelcome(ready: boolean, add: ReturnType<typeof useWishes>["add"], wishes: Wish[], api: Api) {
  const started = useRef(false);
  const have = useRef(wishes);
  have.current = wishes;
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    void (async () => {
      const kept = await loadWelcome();
      if (!kept?.kept) return;
      await adoptWelcome(kept, { have: () => have.current, add, save: saveWelcome, toWishes, price: (text) => priceFirstWish(api, text) });
    })().catch(() => {}); // Storage failure leaves the existing checkpoint for the next mount.
  }, [ready, add, api]);
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
  // The same three ideas the chat offers, made from their list and where they live.
  const suggestions = useSuggestions();
  const { wishes, status, error, reload, add, setTier } = useWishes();
  useAdoptWelcome(auth.status === "signedIn" && status === "ready", add, wishes, auth.api);
  const p = usePalette();
  const t = useType();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const top = useTopRoom();
  const late = useAfter(200);
  const gutter = layout.gutter(width);

  // One undo window for every page (a wish removed on Details leaves here too), with its toast at the host.
  const { pendingId, remove: removeWish, showError } = useHomeRemovals();
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

  // A priceless wish is on the list but in no sum; the count beside the total says how many (lib/worth.ts).
  const items = counted(visible).map((w) => w.item);
  const total = upfrontCashCents(items);
  const keepPerYear = recurringBreakdown(items).perMonth * 12;
  const income = comfortableIncome(total, keepPerYear);
  const count = countLine(visible);
  const loading = (status === "loading" || status === "idle") && wishes.length === 0;

  // The cards run edge to edge on a phone, and in a centred column on anything wider.
  const column = Math.min(width, layout.list + 2 * gutter);
  const g = useMemo(() => geometry(column), [column]);
  const scrollY = useRef(new Animated.Value(0)).current;
  const onScroll = useMemo(() => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: native }), [scrollY]);
  const [listTop, setListTop] = useState(0);
  const bottomRoom = dockRoom(home.dock || layout.control.primary, insets.bottom);
  // The focus line: the middle of what's visible between the top bar and the composer.
  const focus = (top + height - bottomRoom) / 2;

  // A chat card's "Added to your list": its wish comes to the focus line, opened up, as the list slides in.
  const scroller = useRef<ScrollView>(null);
  const reduced = useReducedMotion();
  const { shown, clearShown } = home;
  useEffect(() => {
    if (!shown) return;
    const i = visible.findIndex((w) => w.id === shown);
    if (i < 0 && status === "loading") return;
    if (i >= 0) scroller.current?.scrollTo({ y: revealAt(i, g, listTop, focus), animated: !reduced });
    clearShown();
  }, [shown, clearShown, visible, status, g, listTop, focus, reduced]);

  return (
    <View style={{ flex: 1 }}>
      <Animated.ScrollView
        ref={scroller}
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
          {/* Today's pick, and the ask about notifications, at the head of the list. */}
          <TodayCards />
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

      <FocusVeil on={home.focused} ideas={suggestions.items} onIdea={(i) => home.ask(i)} />

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
          {/* Money's amount is the person's own and the priceless has none, so there is no price to check again. */}
          {worthOf(quickWish) ? null : (
            <Rise delay={delayFor(3)}>
              <SheetRow label="Check the price again" onPress={() => closeQuick(() => void recheckWish(auth.api, quickWish, reload))} />
            </Rise>
          )}
          <Rise delay={delayFor(4)}>
            <SheetRow
              label="Remove"
              danger
              onPress={() => closeQuick(() => removeWish(quickWish, true))}
            />
          </Rise>
        </ActionSheet>
      ) : null}
    </View>
  );
}
