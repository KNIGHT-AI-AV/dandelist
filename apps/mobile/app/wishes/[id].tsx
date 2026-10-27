import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AgentDot, ErrorLine, Eyebrow, Glass, Grain, Photo, QuietButton, Shade } from "../../components/lux";
import { Statement, Take } from "../../components/statement";
import { useAuth } from "../../lib/auth";
import { fonts, usePalette } from "../../lib/theme";
import { useWishes } from "../../lib/wishes";
import { KIND_LABEL, TIER_LABEL, agentLine } from "../../lib/words";

const MAX_W = 520;

export default function WishDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const auth = useAuth();
  const { wishes, status, remove } = useWishes();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (auth.status === "signedOut") return <Redirect href="/sign-in" />;

  const w = wishes.find((x) => x.id === id);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/wishes"));
  if (!w) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg, alignItems: "center", justifyContent: "center", gap: 16 }}>
        {status === "loading" || status === "idle" ? <ActivityIndicator color={p.accent} /> : <Text style={{ fontFamily: fonts.body, color: p.ink2 }}>That wish wasn't found.</Text>}
        <QuietButton label="Back to your list" onPress={() => router.replace("/wishes")} />
      </View>
    );
  }
  const a = w.details.agent;

  async function onRemove() {
    if (!confirm) return setConfirm(true);
    try {
      await remove(w!.id);
      router.replace("/wishes");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        <View style={{ height: 470, width: "100%" }}>
          <Photo uri={a?.imageUrl} kind={w.kind} />
          <Shade from={0.2} />
        </View>
        <View style={{ marginTop: -150, paddingHorizontal: 24, gap: 6, width: "100%", maxWidth: MAX_W, alignSelf: "center" }}>
          <Eyebrow>{[KIND_LABEL[w.kind], TIER_LABEL[w.tier], a?.seller].filter(Boolean).join(" · ")}</Eyebrow>
          <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 40, lineHeight: 43, color: p.ink }}>{w.name}</Text>
        </View>
        <View style={{ paddingHorizontal: 16, marginTop: 20, gap: 20, width: "100%", maxWidth: MAX_W, alignSelf: "center" }}>
          <Statement item={w.item} monthlyHint={w.item.recurring.map((r) => r.label).filter(Boolean).join(", ")} />
          {a?.explanation ? <Take>{a.explanation}</Take> : null}
          <View style={{ gap: 8, paddingHorizontal: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {a ? <AgentDot /> : null}
              <Text style={{ fontFamily: fonts.body, fontSize: 13, color: p.ink2 }}>{agentLine(w)}</Text>
            </View>
            {a && a.source.currency !== "USD" ? (
              <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: p.ink3 }}>{`Listed at ${a.source.price.toLocaleString("en-US")} ${a.source.currency}, converted at ${a.source.rate} on ${a.source.rateDate}.`}</Text>
            ) : null}
            {a ? (
              <Pressable accessibilityRole="link" onPress={() => Linking.openURL(a.url)} hitSlop={8} style={{ alignSelf: "flex-start" }}>
                <Text style={{ fontFamily: fonts.label, fontSize: 13.5, color: p.accent }}>Open the source page</Text>
              </Pressable>
            ) : null}
          </View>
          <ErrorLine>{error}</ErrorLine>
          <QuietButton label={confirm ? "Tap again to remove it" : "Remove from my list"} onPress={onRemove} style={{ alignSelf: "flex-start" }} />
        </View>
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={back} hitSlop={10} style={{ position: "absolute", top: insets.top + 10, left: 16 }}>
        <Glass style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontFamily: fonts.body, fontSize: 20, color: p.ink, marginTop: -3 }}>‹</Text>
        </Glass>
      </Pressable>
      <Grain />
    </View>
  );
}
