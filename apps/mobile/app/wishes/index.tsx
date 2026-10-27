import { horizonCashOutlay, recurringBreakdown, upfrontCashCents } from "@dandelist/cost";
import { Redirect, router } from "expo-router";
import { ActivityIndicator, Image, Linking, Pressable, Text, View } from "react-native";
import { Badge } from "../../components/agent";
import { hostOf } from "../../lib/agent";
import { Body, Button, Card, ErrorText, Row, Screen, Title } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { formatCents } from "../../lib/money";
import { radius, space, type, usePalette } from "../../lib/theme";
import { useWishes } from "../../lib/wishes";

const KIND_LABEL = { buy: "Buy", own: "Own", do: "Do", visit: "Visit" } as const;
const TIER_LABEL = { must: "Must", nice: "Nice", dream: "Dream" } as const;

export default function Wishes() {
  const auth = useAuth();
  const { wishes, status, error, reload } = useWishes();
  const p = usePalette();
  if (auth.status === "signedOut") return <Redirect href="/sign-in" />;

  const items = wishes.map((w) => w.item);
  const monthly = recurringBreakdown(items).perMonth;

  return (
    <Screen>
      <Title>Wishes</Title>
      {status === "loading" && wishes.length === 0 ? (
        <ActivityIndicator color={p.accent} />
      ) : status === "error" ? (
        <Card>
          <ErrorText>{error}</ErrorText>
          <Button label="Try again" onPress={() => reload()} />
        </Card>
      ) : wishes.length === 0 ? (
        <Card>
          <Text style={[type.title, { color: p.ink }]}>Add your first wish</Text>
          <Body muted>Something to buy, a place to visit, a thing to do. Dandelist shows what it costs upfront, every month, and over the years.</Body>
          <Button label="Add a wish" onPress={() => router.push("/wishes/new")} />
        </Card>
      ) : (
        <>
          <Card>
            <Text style={[type.label, { color: p.muted }]}>{`Your life list · ${wishes.length} ${wishes.length === 1 ? "wish" : "wishes"}`}</Text>
            <Row label="Upfront" value={formatCents(upfrontCashCents(items))} />
            <Row label="Every month" value={formatCents(monthly)} hint="Running costs you'd actually pay" />
            <Row label="Over 5 years" value={formatCents(horizonCashOutlay(items, 5))} />
          </Card>
          <Button label="Add a wish" onPress={() => router.push("/wishes/new")} />
          <View style={{ gap: space.md }}>
            {wishes.map((w) => {
              const agent = w.details.agent;
              return (
                <View key={w.id} style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: p.line, backgroundColor: p.glass, overflow: "hidden" }}>
                  {agent?.imageUrl ? (
                    <View style={{ height: 150, backgroundColor: p.surface }}>
                      <Image source={{ uri: agent.imageUrl }} style={{ width: "100%", height: "100%" }} resizeMode="contain" accessibilityIgnoresInvertColors />
                    </View>
                  ) : null}
                  <View style={{ padding: space.lg, gap: space.sm }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
                      <Text style={[type.title, { color: p.ink, flexShrink: 1 }]}>{w.name}</Text>
                      <Text style={[type.small, { color: p.muted }]}>{`${KIND_LABEL[w.kind]} · ${TIER_LABEL[w.tier]}`}</Text>
                    </View>
                    <Row label="Upfront" value={formatCents(w.item.upfrontCents)} />
                    {w.item.recurring.length ? <Row label="Monthly" value={formatCents(recurringBreakdown([w.item]).perMonth)} /> : null}
                    {agent ? (
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, paddingTop: space.xs }}>
                        <Pressable accessibilityRole="link" onPress={() => Linking.openURL(agent.url)} style={{ flexShrink: 1 }}>
                          <Text style={[type.small, { color: p.accent }]} numberOfLines={1}>{`${agent.seller} · ${hostOf(agent.url)}`}</Text>
                        </Pressable>
                        <Badge verified={agent.status === "verified"} />
                      </View>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        </>
      )}
      <Button label="Sign out" kind="quiet" onPress={() => auth.signOut()} />
    </Screen>
  );
}
