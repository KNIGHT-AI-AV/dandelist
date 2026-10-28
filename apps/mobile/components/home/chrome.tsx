import { useMemo } from "react";
import { Animated, Pressable, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { transcribeWish } from "../../lib/agent";
import { useAuth } from "../../lib/auth";
import { useDandy } from "../../lib/dandy";
import { usePress } from "../../lib/motion";
import { PAGES, PAGE_COUNT, type PageId } from "../../lib/pager";
import { layout, usePalette } from "../../lib/theme";
import { Composer, KeyboardDock } from "../inputs";
import { Wordmark } from "../lux";
import { ListeningStrip, MicButton, useVoiceWish } from "../voice/say-wish";
import { useHome } from "./bridge";
import { offsetNode, usePager } from "./pager";
import { ProfileAvatar } from "./profile-avatar";

/** What each page is called, for the dots' screen-reader names and the page headings. */
export function usePageNames(): Record<PageId, string> {
  const dandy = useDandy();
  return useMemo(() => ({ list: "The list", chat: dandy.name, details: "Details", money: "Money", settings: "Settings" }), [dandy.name]);
}

const DOT = 6;

/** Where you are on the ring: five dots, the front one drawn out into a short bar. Each one turns to its page. */
function Dots() {
  const p = usePalette();
  const { pos, page, go } = usePager();
  const names = usePageNames();
  const nodes = useMemo(
    () =>
      PAGES.map((_, i) => {
        const off = offsetNode(pos, i);
        return {
          stretch: off.interpolate({ inputRange: [-1, 0, 1], outputRange: [1, 2.6, 1], extrapolate: "clamp" }),
          opacity: off.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.35, 1, 0.35], extrapolate: "clamp" }),
        };
      }),
    [pos],
  );
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
      {PAGES.map((id, i) => (
        <Pressable key={id} accessibilityRole="tab" accessibilityLabel={names[id]} accessibilityState={{ selected: page === id }} onPress={() => go(id)} hitSlop={{ top: 12, bottom: 12 }} style={{ width: 18, height: 28, alignItems: "center", justifyContent: "center" }}>
          <Animated.View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: p.ink, opacity: nodes[i]!.opacity, transform: [{ scaleX: nodes[i]!.stretch }] }} />
        </Pressable>
      ))}
    </View>
  );
}

/**
 * The bar over every page: the wordmark (back to the list), the dots, and the profile picture (to settings). It
 * stays put while the pages slide under it.
 */
export function TopBar() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { go } = usePager();
  const press = usePress(0.94);
  const gutter = layout.gutter(width);
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: 0, left: 0, right: 0, paddingTop: insets.top, paddingHorizontal: gutter }}>
      <View pointerEvents="box-none" style={{ height: layout.headerBar, flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%", maxWidth: layout.list, alignSelf: "center" }}>
        <Pressable accessibilityRole="button" accessibilityLabel="The list" onPress={() => go("list")} hitSlop={8}>
          <Wordmark />
        </Pressable>
        <Dots />
        <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => go("settings")} onPressIn={press.onPressIn} onPressOut={press.onPressOut} style={{ width: layout.control.chip, height: layout.control.chip, alignItems: "flex-end", justifyContent: "center" }}>
          <Animated.View style={{ transform: [{ scale: press.scale }] }}>
            <ProfileAvatar size={34} />
          </Animated.View>
        </Pressable>
      </View>
    </View>
  );
}

/** How far the top of a page's content sits below the window's top: under the bar. */
export function useTopRoom(): number {
  const insets = useSafeAreaInsets();
  return insets.top + layout.headerBar;
}

/**
 * The composer under the list and the chat. It stays where it is while those two slide past, and sinks away on the
 * other pages. Typing on the list and sending turns to the chat with the words already sent.
 */
export function Dock() {
  const auth = useAuth();
  const dandy = useDandy();
  const home = useHome();
  const { pos, page } = usePager();
  const voice = useVoiceWish({
    transcribe: (wav) => transcribeWish(auth.api, wav),
    onHeard: home.setDraft,
    onError: () => {},
  });
  // 0 on the list and the chat, 1 a page or more away (see lib/pager dockDistance).
  const ring = useMemo(() => Animated.modulo(pos, PAGE_COUNT), [pos]);
  const opacity = useMemo(() => ring.interpolate({ inputRange: [0, 1, 2, PAGE_COUNT - 1, PAGE_COUNT], outputRange: [1, 1, 0, 0, 1], extrapolate: "clamp" }), [ring]);
  const sink = useMemo(() => ring.interpolate({ inputRange: [0, 1, 2, PAGE_COUNT - 1, PAGE_COUNT], outputRange: [0, 0, 56, 56, 0], extrapolate: "clamp" }), [ring]);
  const here = page === "list" || page === "chat";
  return (
    <Animated.View pointerEvents={here ? "box-none" : "none"} style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: 0, opacity, transform: [{ translateY: sink }] }} aria-hidden={!here}>
      <KeyboardDock onHeight={home.setDock} maxWidth={layout.column} fade={false}>
        <Composer
          value={home.draft}
          onChangeText={home.setDraft}
          onSend={home.ask}
          placeholder={`Tell ${dandy.name} what you want...`}
          label={`Message ${dandy.name}`}
          busy={home.busy}
          onFocusChange={(on) => home.setFocused(on && page === "list")}
          idleAction={voice.supported ? <MicButton voice={voice} compact /> : undefined}
          cover={voice.phase !== "idle" ? <ListeningStrip voice={voice} /> : undefined}
        />
      </KeyboardDock>
    </Animated.View>
  );
}

