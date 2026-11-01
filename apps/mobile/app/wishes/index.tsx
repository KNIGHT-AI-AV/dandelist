import { Redirect, useIsFocused, useLocalSearchParams } from "expo-router";
import { useMemo, useRef } from "react";
import { Platform, View } from "react-native";
import { Atmosphere } from "../../components/atmosphere";
import { HomeProvider } from "../../components/home/bridge";
import { ChatPage } from "../../components/home/chat-page";
import { Dock, TopBar } from "../../components/home/chrome";
import { DetailsPage } from "../../components/home/details-page";
import { ListPage } from "../../components/home/list-page";
import { MoneyPage } from "../../components/home/money-page";
import { PagerProvider, PagerView } from "../../components/home/pager";
import { RemovalsProvider } from "../../components/home/removals";
import { SettingsPage } from "../../components/home/settings-page";
import { Grain } from "../../components/lux";
import { useAuth } from "../../lib/auth";
import { useFocusReturn } from "../../lib/focus-return";
import { PAGES, type PageId } from "../../lib/pager";
import { usePalette } from "../../lib/theme";

/**
 * The signed-in app: the list, the Dandy, the details, the money and settings on one ring, swiped sideways from
 * anywhere (owner, recording 03). One backdrop and one grain sit behind all of them, so only the content moves.
 * `?page=chat` opens on a page.
 */
export default function Home() {
  const p = usePalette();
  const auth = useAuth();
  const { page } = useLocalSearchParams<{ page?: string }>();
  const initial: PageId = PAGES.includes(page as PageId) ? (page as PageId) : "list";
  // A wish open over the list (wishes/[id], a transparent modal) leaves this screen mounted underneath.
  const focused = useIsFocused();
  // And when it closes, the keyboard goes back to where it was (the card the wish was opened from).
  const screen = useRef<View>(null);
  useFocusReturn(screen, focused);
  const pages = useMemo(() => ({ list: <ListPage />, chat: <ChatPage />, details: <DetailsPage />, money: <MoneyPage />, settings: <SettingsPage /> }), []);
  if (auth.status === "signedOut") return <Redirect href="/welcome" />;
  // Clipped: the dock sinks 56 below the screen on the other pages, and unclipped that made the web page itself
  // scroll, lifting the bar away and showing a white strip at the end of Settings (UI audit, 2026-10-31).
  return (
    // While a wish's page covers it, the web's keyboard and screen readers leave this screen alone: before, Tab went
    // through the bar's controls before the wish's own, and from its Back button into the list hidden underneath.
    <View ref={screen} style={{ flex: 1, backgroundColor: p.bg, overflow: "hidden" }} {...(Platform.OS === "web" ? { inert: !focused, "aria-hidden": !focused } : null)}>
      <Atmosphere />
      <PagerProvider initial={initial}>
        <HomeProvider>
          <RemovalsProvider>
            <PagerView pages={pages} />
            <TopBar />
            <Dock />
          </RemovalsProvider>
        </HomeProvider>
      </PagerProvider>
      <Grain />
    </View>
  );
}
