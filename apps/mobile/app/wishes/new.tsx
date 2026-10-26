import { equivalentMonthly, horizonCashOutlay, recurringBreakdown, type Item, type Period } from "@dandelist/cost";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Text } from "react-native";
import { Body, Button, Card, ErrorText, Field, Row, Screen, Segmented, Title } from "../../components/ui";
import { formatCents, parseDollars } from "../../lib/money";
import { type, usePalette } from "../../lib/theme";
import { useWishes, type WishKind, type WishTier } from "../../lib/wishes";

const KINDS: { value: WishKind; label: string }[] = [
  { value: "buy", label: "Buy" },
  { value: "own", label: "Own" },
  { value: "do", label: "Do" },
  { value: "visit", label: "Visit" },
];
const TIERS: { value: WishTier; label: string }[] = [
  { value: "must", label: "Must" },
  { value: "nice", label: "Nice" },
  { value: "dream", label: "Dream" },
];
const PERIODS: { value: Period; label: string }[] = [
  { value: "month", label: "Monthly" },
  { value: "year", label: "Yearly" },
  { value: "week", label: "Weekly" },
];
const HORIZONS = [
  { value: "1", label: "1 year" },
  { value: "3", label: "3 years" },
  { value: "5", label: "5 years" },
  { value: "10", label: "10 years" },
];

export default function NewWish() {
  const { add } = useWishes();
  const p = usePalette();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<WishKind>("buy");
  const [tier, setTier] = useState<WishTier>("nice");
  const [price, setPrice] = useState("");
  const [running, setRunning] = useState("");
  const [period, setPeriod] = useState<Period>("month");
  const [horizon, setHorizon] = useState("5");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const upfrontCents = price.trim() ? parseDollars(price) : 0;
  const recurringCents = running.trim() ? parseDollars(running) : 0;
  const years = Number(horizon);

  const preview = useMemo(() => {
    if (upfrontCents === null || recurringCents === null) return null;
    const item: Item = { id: "preview", upfrontCents, recurring: recurringCents ? [{ amountCents: recurringCents, period }] : [] };
    const total = horizonCashOutlay([item], years);
    return { monthly: recurringBreakdown([item]).perMonth, total, equivalent: equivalentMonthly(total, years) };
  }, [upfrontCents, recurringCents, period, years]);

  async function save() {
    if (!name.trim()) return setError("Give the wish a name.");
    if (upfrontCents === null) return setError("Enter the price as a number, like 2400 or 2,400.50.");
    if (recurringCents === null) return setError("Enter the running cost as a number, or leave it empty.");
    setBusy(true);
    setError(null);
    try {
      await add({ name, kind, tier, upfrontCents, recurringCents, period });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the wish.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>New wish</Title>
      <Field label="What is it?" value={name} onChangeText={setName} placeholder="Leica Q3, a week in Lisbon…" />
      <Segmented<WishKind> label="Type" options={KINDS} value={kind} onChange={setKind} />
      <Segmented<WishTier> label="How much you want it" options={TIERS} value={tier} onChange={setTier} />
      <Field label="Price upfront (USD)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" inputMode="decimal" placeholder="2,400" />
      <Field label="Running cost (USD, optional)" value={running} onChangeText={setRunning} keyboardType="decimal-pad" inputMode="decimal" placeholder="30" />
      <Segmented<Period> label="Running cost is paid" options={PERIODS} value={period} onChange={setPeriod} />
      <Segmented label="Look ahead" options={HORIZONS} value={horizon} onChange={setHorizon} />

      {preview ? (
        <Card>
          <Text style={[type.label, { color: p.muted }]}>What it really costs</Text>
          <Row label="Upfront" value={formatCents(upfrontCents ?? 0)} />
          <Row label="Every month" value={formatCents(preview.monthly)} hint="The running cost you'd actually pay" />
          <Row label={`Over ${years} ${years === 1 ? "year" : "years"}`} value={formatCents(preview.total)} />
          <Row label="Spread per month" value={formatCents(preview.equivalent)} hint={`The ${years}-year total spread evenly. Not a bill.`} />
        </Card>
      ) : (
        <Body muted>Enter amounts as numbers to see the costs.</Body>
      )}

      <ErrorText>{error}</ErrorText>
      <Button label="Save wish" busy={busy} onPress={save} />
      <Button label="Cancel" kind="quiet" onPress={() => router.back()} />
    </Screen>
  );
}
