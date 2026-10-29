import { Redirect, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { View } from "react-native";
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
  const pages = useMemo(() => ({ list: <ListPage />, chat: <ChatPage />, details: <DetailsPage />, money: <MoneyPage />, settings: <SettingsPage /> }), []);
  if (auth.status === "signedOut") return <Redirect href="/welcome" />;
  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
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
