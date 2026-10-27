import { equivalentMonthly, horizonCashOutlay, recurringBreakdown, type Item, type Period } from "@dandelist/cost";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Chip, ErrorLine, Eyebrow, GlassField, PrimaryButton, QuietButton } from "../../components/lux";
import { Statement } from "../../components/statement";
import { parseDollars } from "../../lib/money";
import { layout, type, usePalette, useType } from "../../lib/theme";
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

export default function ManualWish() {
  const { add } = useWishes();
  const p = usePalette();
  const t = useType();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const gutter = layout.gutter(width);
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

  const choiceRow = <T extends string>(label: string, options: { value: T; label: string }[], value: T, onChange: (v: T) => void) => (
    <View style={{ gap: 8 }}>
      <Eyebrow>{label}</Eyebrow>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((o) => (
          <Chip key={o.value} label={o.label} selected={o.value === value} onPress={() => onChange(o.value)} />
        ))}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: insets.top + layout.contentTop, paddingBottom: insets.bottom + 40, paddingHorizontal: gutter, gap: 20, width: "100%", maxWidth: layout.list + 2 * gutter, alignSelf: "center" }}>
        <View style={{ gap: layout.stack.tight }}>
          <Eyebrow>New wish</Eyebrow>
          <Text accessibilityRole="header" style={[t.title1, { color: p.ink }]}>Enter it yourself</Text>
        </View>
        <GlassField label="What is it?" value={name} onChangeText={setName} placeholder="Leica Q3, a week in Lisbon..." />
        {choiceRow("Type", KINDS, kind, setKind)}
        {choiceRow("How much you want it", TIERS, tier, setTier)}
        <GlassField label="Price upfront (USD)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" inputMode="decimal" placeholder="2,400" />
        <GlassField label="Running cost (USD, optional)" value={running} onChangeText={setRunning} keyboardType="decimal-pad" inputMode="decimal" placeholder="30" />
        {choiceRow("Running cost is paid", PERIODS, period, setPeriod)}
        {choiceRow("Look ahead", HORIZONS, horizon, setHorizon)}
        {preview ? (
          <Statement item={{ id: "preview", upfrontCents: upfrontCents ?? 0, recurring: recurringCents ? [{ amountCents: recurringCents, period }] : [] }} years={years} />
        ) : (
          <Text style={[type.callout, { color: p.ink2 }]}>Enter amounts as numbers to see the costs.</Text>
        )}
        <ErrorLine>{error}</ErrorLine>
        <PrimaryButton label="Save wish" commit busy={busy} onPress={save} />
        <QuietButton label="Cancel" onPress={() => (router.canGoBack() ? router.back() : router.replace("/wishes"))} />
      </ScrollView>
    </View>
  );
}
