import { horizonCashOutlay, recurringBreakdown, upfrontCashCents } from "@dandelist/cost";
import { Redirect, router } from "expo-router";
import { Text, View } from "react-native";
import { Body, Button, Card, Row, Screen, Title } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { formatCents } from "../../lib/money";
import { space, type, usePalette } from "../../lib/theme";
import { useWishes } from "../../lib/wishes";

const KIND_LABEL = { buy: "Buy", own: "Own", do: "Do", visit: "Visit" } as const;

export default function Wishes() {
  const auth = useAuth();
  const { wishes } = useWishes();
  const p = usePalette();
  if (auth.status === "signedOut") return <Redirect href="/sign-in" />;

  const items = wishes.map((w) => w.item);
  const monthly = recurringBreakdown(items).perMonth;

  return (
    <Screen>
      <Title>Wishes</Title>
      {wishes.length === 0 ? (
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
            {wishes.map((w) => (
              <Card key={w.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
                  <Text style={[type.title, { color: p.ink, flexShrink: 1 }]}>{w.name}</Text>
                  <Text style={[type.small, { color: p.muted }]}>{KIND_LABEL[w.kind]}</Text>
                </View>
                <Row label="Upfront" value={formatCents(w.item.upfrontCents)} />
                {w.item.recurring.length ? <Row label="Monthly" value={formatCents(recurringBreakdown([w.item]).perMonth)} /> : null}
              </Card>
            ))}
          </View>
        </>
      )}
      <Button label="Sign out" kind="quiet" onPress={() => auth.signOut()} />
    </Screen>
  );
}
