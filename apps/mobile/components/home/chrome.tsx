import { useMemo, useRef } from "react";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Animated, Pressable, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { transcribeWish } from "../../lib/agent";
import { useAuth } from "../../lib/auth";
import { useDandy } from "../../lib/dandy";
import { usePress } from "../../lib/motion";
import { PAGES, PAGE_COUNT, type PageId } from "../../lib/pager";
import { layout, space, usePalette } from "../../lib/theme";
import { PageSizeProvider } from "../../lib/page-size";
import { Composer, KeyboardDock } from "../inputs";
import { Icon, Wordmark } from "../lux";
import { ListeningStrip, MicButton, useVoiceWish } from "../voice/say-wish";
import { useHome } from "./bridge";
import { offsetNode, usePager } from "./pager";
import { SoundButton } from "../sound-button";
import { HelpButton } from "../help";
import { ProfileAvatar } from "./profile-avatar";

/** What each page is called, for the dots' screen-reader names and the page headings. */
export function usePageNames(): Record<PageId, string> {
  const dandy = useDandy();
  return useMemo(() => ({ list: "The list", chat: dandy.name, details: "Details", money: "Money", settings: "Settings" }), [dandy.name]);
}

const DOT = 6;

/**
 * Where you are on the ring: five dots, the front one drawn out into a short bar (in a spread, both pages in view).
 * Each one turns to its page.
 */
function Dots() {
  const p = usePalette();
  const { pos, span, shows, go } = usePager();
  const names = usePageNames();
  const nodes = useMemo(
    () =>
      PAGES.map((_, i) => {
        const off = offsetNode(pos, i);
        const inputRange = span === 2 ? [-1, 0, 1, 2] : [-1, 0, 1];
        const out = (edge: number, mid: number) => (span === 2 ? [edge, mid, mid, edge] : [edge, mid, edge]);
        return {
          stretch: off.interpolate({ inputRange, outputRange: out(1, 2.6), extrapolate: "clamp" }),
          opacity: off.interpolate({ inputRange, outputRange: out(0.35, 1), extrapolate: "clamp" }),
        };
      }),
    [pos, span],
  );
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
      {PAGES.map((id, i) => (
        <Pressable key={id} accessibilityRole="tab" accessibilityLabel={names[id]} accessibilityState={{ selected: shows(id) }} onPress={() => go(id)} hitSlop={{ top: 12, bottom: 12 }} style={{ width: 18, height: 28, alignItems: "center", justifyContent: "center" }}>
          <Animated.View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: p.ink, opacity: nodes[i]!.opacity, transform: [{ scaleX: nodes[i]!.stretch }] }} />
        </Pressable>
      ))}
    </View>
  );
}

/** Narrower than this, the bar keeps the wordmark, dots and photo only; the theme stays a row in settings. */
const PALETTE_FROM = 360;
/**
 * From here the note fits beside the palette: wordmark 98, dots 98, note and palette 88, gap 12 and photo 50 make 346
 * of the 350 a 390 pt phone leaves inside its gutters. Narrower, sound stays the switch in settings.
 */
const SOUND_FROM = 388;
/** From here the help button fits too: 346 plus its 44 pt target inside the 390 a 430 pt phone leaves. Narrower, help is a row in settings. */
const HELP_FROM = 430;
/** The space between the palette's touch area and the photo's, so one thumb never lands on both. */
const PALETTE_GAP = 12;
/** How far above the bar's foot its controls end: the 34 pt photo, the tallest, is centred in the 44 pt bar. */
const CONTROLS_CLEAR = 5;

/**
 * Colours one tap away (owner, 2026-10-29: "Put a color palette near the profile picture ... far enough away that
 * someone does not accidentally hit both ... no border or bubble"). A bare glyph in the theme's accent inside its
 * own 44 pt target; a press dims it, and a second tap while the chooser opens does nothing.
 */
export function PaletteButton() {
  const p = usePalette();
  const opening = useRef(false);
  const open = () => {
    if (opening.current) return;
    opening.current = true;
    router.push("/theme");
    setTimeout(() => (opening.current = false), 800);
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Change theme"
      onPress={open}
      style={({ pressed }) => ({ width: layout.control.icon, height: layout.control.icon, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.55 : 1 })}
    >
      <Icon name="palette" size={22} color={p.accentText} />
    </Pressable>
  );
}

/**
 * The bar over every page: the wordmark (back to the list), the dots, sound on and off, the palette (to the themes)
 * and the profile picture (to settings). It stays put while the pages slide under it. In a spread it runs across both
 * pages, the wordmark and dots over the left one and the buttons over the right, so nothing sits on the fold.
 */
export function TopBar() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { go, span, width: pageWidth } = usePager();
  const spread = span === 2;
  const press = usePress(0.94);
  const gutter = layout.gutter(spread ? pageWidth : width);
  const mark = (
    <Pressable accessibilityRole="button" accessibilityLabel="The list" onPress={() => go("list")} hitSlop={8}>
      <Wordmark />
    </Pressable>
  );
  const p = usePalette();
  const edge = insets.top + layout.headerBar;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: 0, left: 0, right: 0, paddingTop: insets.top, paddingHorizontal: gutter }}>
      {/* A scroll edge, not a bar: the page colour fades out under the wordmark, so content passing beneath stays legible. */}
      <LinearGradient pointerEvents="none" colors={[`rgba(${p.bgRgb}, 0.94)`, `rgba(${p.bgRgb}, 0.7)`, `rgba(${p.bgRgb}, 0)`]} locations={[0, 0.6, 1]} style={{ position: "absolute", top: 0, left: 0, right: 0, height: edge + 28 }} />
      {/* And under the bar's own controls a stronger wash that ends at the bar's foot (owner's screenshot, 2026-11-01: a
          quote scrolled under the bar showed at about half brightness behind the wordmark). Below the bar nothing
          changes, so a page's first line at rest is no dimmer than before. */}
      <LinearGradient pointerEvents="none" colors={[`rgba(${p.bgRgb}, 0.85)`, `rgba(${p.bgRgb}, 0.85)`, `rgba(${p.bgRgb}, 0)`]} locations={[0, (edge - CONTROLS_CLEAR) / edge, 1]} style={{ position: "absolute", top: 0, left: 0, right: 0, height: edge }} />
      <View pointerEvents="box-none" style={{ height: layout.headerBar, flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%", maxWidth: spread ? undefined : layout.list, alignSelf: "center" }}>
        {spread ? (
          <View pointerEvents="box-none" style={{ flexDirection: "row", alignItems: "center", gap: space[24] }}>
            {mark}
            <Dots />
          </View>
        ) : (
          <>
            {mark}
            <Dots />
          </>
        )}
        <View pointerEvents="box-none" style={{ flexDirection: "row", alignItems: "center", gap: PALETTE_GAP }}>
          {width >= PALETTE_FROM ? (
            // The note and the palette side by side, each its own 44 pt target; the gap keeps the palette off the photo.
            <View pointerEvents="box-none" style={{ flexDirection: "row", alignItems: "center" }}>
              {width >= HELP_FROM ? <HelpButton /> : null}
              {width >= SOUND_FROM ? <SoundButton /> : null}
              <PaletteButton />
            </View>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => go("settings")} onPressIn={press.onPressIn} onPressOut={press.onPressOut} style={{ width: layout.control.chip, height: layout.control.chip, alignItems: "flex-end", justifyContent: "center" }}>
            <Animated.View style={{ transform: [{ scale: press.scale }] }}>
              <ProfileAvatar size={34} />
            </Animated.View>
          </Pressable>
        </View>
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
 * other pages. Typing on the list and sending turns to the chat with the words already sent. In a spread it belongs to
 * the chat's page: it sits under the chat, moves with it, and fades as the chat leaves the spread.
 */
export function Dock() {
  const auth = useAuth();
  const dandy = useDandy();
  const home = useHome();
  const { pos, page, span, width: pageWidth } = usePager();
  const spread = span === 2;
  const { height } = useWindowDimensions();
  const voice = useVoiceWish({
    transcribe: (wav) => transcribeWish(auth.api, wav),
    onHeard: home.setDraft,
    onError: () => {},
  });
  // 0 on the list and the chat, 1 a page or more away (see lib/pager dockDistance).
  const ring = useMemo(() => Animated.modulo(pos, PAGE_COUNT), [pos]);
  const opacity = useMemo(() => ring.interpolate({ inputRange: [0, 1, 2, PAGE_COUNT - 1, PAGE_COUNT], outputRange: [1, 1, 0, 0, 1], extrapolate: "clamp" }), [ring]);
  const sink = useMemo(() => ring.interpolate({ inputRange: [0, 1, 2, PAGE_COUNT - 1, PAGE_COUNT], outputRange: [0, 0, 56, 56, 0], extrapolate: "clamp" }), [ring]);
  const chat = useMemo(() => offsetNode(pos, PAGES.indexOf("chat")), [pos]);
  const follow = useMemo(() => ({ x: Animated.multiply(chat, pageWidth), opacity: chat.interpolate({ inputRange: [-1, 0, 1, 2], outputRange: [0, 1, 1, 0], extrapolate: "clamp" }) }), [chat, pageWidth]);
  // In a spread this is exactly when the chat is in view: beside the list, or in front of Details.
  const here = page === "list" || page === "chat";
  return (
    <Animated.View
      pointerEvents={here ? "box-none" : "none"}
      style={spread ? { position: "absolute", left: 0, width: pageWidth, bottom: 0, top: 0, opacity: follow.opacity, transform: [{ translateX: follow.x }] } : { position: "absolute", left: 0, right: 0, bottom: 0, top: 0, opacity, transform: [{ translateY: sink }] }}
      aria-hidden={!here}
    >
      <PageSizeProvider width={pageWidth} height={height}>
      <KeyboardDock onHeight={home.setDock} maxWidth={layout.column}>
        <Composer
          ref={home.composer}
          value={home.draft}
          onChangeText={home.setDraft}
          onSend={home.ask}
          placeholder={`Tell ${dandy.name} what you want...`}
          label={`Message ${dandy.name}`}
          busy={home.busy}
          // Whether the list's ideas show follows the layout too (components/home/bridge.tsx).
          onFocusChange={home.setFocused}
          idleAction={voice.supported ? <MicButton voice={voice} compact /> : undefined}
          cover={voice.phase !== "idle" ? <ListeningStrip voice={voice} /> : undefined}
        />
      </KeyboardDock>
      </PageSizeProvider>
    </Animated.View>
  );
}

