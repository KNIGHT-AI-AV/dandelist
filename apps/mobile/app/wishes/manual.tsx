import type { Period } from "@dandelist/cost";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { Text, View, useWindowDimensions, type TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Field, FieldError, KeyboardDock, KeyboardScroll, MoneyField, dockRoom } from "../../components/inputs";
import { Chip, Eyebrow, PrimaryButton, QuietButton } from "../../components/lux";
import { Statement } from "../../components/statement";
import { haptic } from "../../lib/motion";
import { layout, space, usePalette, useType } from "../../lib/theme";
import { useWishes, type WishKind, type WishTier } from "../../lib/wishes";
import { Atmosphere } from "../../components/atmosphere";

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

const NAME_MISSING = "Give the wish a name.";

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
  const [upfrontCents, setUpfrontCents] = useState<number | null>(null);
  const [recurringCents, setRecurringCents] = useState<number | null>(null);
  const [period, setPeriod] = useState<Period>("month");
  const [horizon, setHorizon] = useState("5");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The docked Save button's height, measured; one primary button until the first layout.
  const [dock, setDock] = useState<number>(layout.control.primary);
  const nameInput = useRef<TextInput>(null);
  const priceInput = useRef<TextInput>(null);
  const runningInput = useRef<TextInput>(null);

  const upfront = upfrontCents ?? 0;
  const recurring = recurringCents ?? 0;
  const years = Number(horizon);
  const nameError = name.trim() ? null : NAME_MISSING;

  async function save() {
    setSubmitted(true);
    if (nameError) {
      haptic.error();
      nameInput.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    haptic.soft();
    try {
      await add({ name, kind, tier, upfrontCents: upfront, recurringCents: recurring, period });
      router.back();
    } catch (e) {
      haptic.error();
      setError(e instanceof Error ? e.message : "Couldn't save the wish.");
    } finally {
      setBusy(false);
    }
  }

  const choiceRow = <T extends string>(label: string, options: { value: T; label: string }[], value: T, onChange: (v: T) => void) => (
    <View style={{ gap: layout.stack.tight }}>
      <Eyebrow>{label}</Eyebrow>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: layout.stack.tight }}>
        {options.map((o) => (
          <Chip key={o.value} label={o.label} selected={o.value === value} onPress={() => onChange(o.value)} />
        ))}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <Atmosphere />
      <KeyboardScroll dock={dock} contentContainerStyle={{ paddingTop: insets.top + layout.contentTop, paddingBottom: dockRoom(dock, insets.bottom), paddingHorizontal: gutter, gap: space[20], width: "100%", maxWidth: layout.list + 2 * gutter, alignSelf: "center" }}>
        <View style={{ gap: layout.stack.tight }}>
          <Eyebrow>New wish</Eyebrow>
          <Text accessibilityRole="header" style={[t.title1, { color: p.ink }]}>Enter it yourself</Text>
        </View>
        <Field
          ref={nameInput}
          label="What is it?"
          value={name}
          onChangeText={setName}
          placeholder="Leica Q3, a week in Lisbon..."
          autoCapitalize="sentences"
          autoCorrect
          spellCheck
          autoComplete="off"
          textContentType="none"
          next={priceInput}
          error={nameError}
          submitted={submitted}
        />
        {choiceRow("Type", KINDS, kind, setKind)}
        {choiceRow("How much you want it", TIERS, tier, setTier)}
        <MoneyField ref={priceInput} label="Price upfront (USD)" cents={upfrontCents} onChangeCents={setUpfrontCents} placeholder="$2,400" next={runningInput} />
        <MoneyField ref={runningInput} label="Running cost (USD, optional)" cents={recurringCents} onChangeCents={setRecurringCents} placeholder="$30" returnKeyType="done" />
        {choiceRow("Running cost is paid", PERIODS, period, setPeriod)}
        {choiceRow("Look ahead", HORIZONS, horizon, setHorizon)}
        <Statement item={{ id: "preview", upfrontCents: upfront, recurring: recurring ? [{ amountCents: recurring, period }] : [] }} years={years} />
        <FieldError message={error} />
        <QuietButton label="Cancel" onPress={() => (router.canGoBack() ? router.back() : router.replace("/wishes"))} />
      </KeyboardScroll>
      <KeyboardDock onHeight={setDock}>
        <PrimaryButton label="Save wish" busy={busy} onPress={save} />
      </KeyboardDock>
    </View>
  );
}
