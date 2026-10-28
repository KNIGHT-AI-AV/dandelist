import type { LifeContext, Widget } from "@dandelist/catalogue/dream";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { haptic } from "../../lib/motion";
import { moneyIn } from "../../lib/dream";
import { fonts, radius, usePalette, type } from "../../lib/theme";
import { Field } from "../inputs";
import { TARGET } from "../inputs/tokens";
import { Eyebrow, Glass, PrimaryButton, Shade } from "../lux";
import { GlassReveal } from "../reveal";
import { Chip } from "../welcome/kit";

type HomeWidget = Extract<Widget, { kind: "home_builder" }>;
type CarWidget = Extract<Widget, { kind: "car_builder" }>;

/** Budget steps in the builder's own currency: "Up to €1M". */
const BUDGETS: [number, number | null][] = [[1, 100_000_000], [3, 300_000_000], [10, 1_000_000_000], [0, null]];
const symbolOf = (currency = "USD") => moneyIn(currency)(0).replace(/[\d.,\s]/g, "") || "$";
const ROOMS = [2, 3, 4, 5, 6];

function SearchBar({ primary, onPrimary, onJustSearch }: { primary: string; onPrimary(): void; onJustSearch(): void }) {
  const p = usePalette();
  return (
    <View style={{ gap: 6 }}>
      <PrimaryButton label={primary} onPress={onPrimary} />
      <Pressable accessibilityRole="button" onPress={onJustSearch} hitSlop={8} style={{ alignSelf: "center", paddingVertical: 8 }}>
        <Text style={[type.footnote, { fontFamily: fonts.label, color: p.ink2 }]}>Just search</Text>
      </Pressable>
    </View>
  );
}

/**
 * The home builder the agent opens from a description: pick the style from real photographs, toggle the features
 * it heard (and any it didn't), set the bedrooms and an optional budget. "Just search" skips straight to listings.
 */
export function HomeBuilder({ w, onApply, onSearchNow, onRegion }: { w: HomeWidget; onApply(values: Record<string, unknown>): void; onSearchNow(): void; onRegion(): void }) {
  const p = usePalette();
  const [styles, setStyles] = useState<string[]>(() => w.styles.filter((s) => s.on).map((s) => s.id));
  const symbol = symbolOf(w.currency);
  const [features, setFeatures] = useState(() => Object.fromEntries(w.features.map((f) => [f.id, f.on])));
  const [rooms, setRooms] = useState<number | null>(w.bedrooms);
  const [budget, setBudget] = useState<number | null>(w.budgetCents);
  const toggleStyle = (id: string) => {
    haptic.select();
    setStyles((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };
  return (
    <Glass style={{ padding: 18, gap: 18, borderRadius: radius.lg }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Eyebrow color={p.accentText}>Your home</Eyebrow>
        <Pressable accessibilityRole="button" accessibilityLabel={`In ${w.region}`} onPress={onRegion} hitSlop={8} style={{ minHeight: TARGET, justifyContent: "center" }}>
          <Text style={[type.footnote, { fontFamily: fonts.label, color: p.ink2 }]}>{`In ${w.region}  ▾`}</Text>
        </Pressable>
      </View>
      <View style={{ gap: 10 }}>
        <Text style={[type.title3, { color: p.ink }]}>Which feels like home?</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
          {w.styles.map((s) => {
            const on = styles.includes(s.id);
            return (
              <Pressable key={s.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={s.label} onPress={() => toggleStyle(s.id)}>
                <View style={{ width: 132, height: 172, borderRadius: radius.md, overflow: "hidden", borderWidth: on ? 2 : StyleSheet.hairlineWidth, borderColor: on ? p.accent : p.hair }}>
                  <GlassReveal uri={s.imageUrl ?? null} standby={require("../../assets/standby/life.jpg")} stage="clear" treatment="film" style={StyleSheet.absoluteFill} />
                  <Shade from={0.45} />
                  <View style={{ position: "absolute", left: 10, right: 10, bottom: 10, gap: 2 }}>
                    <Text style={[type.footnote, { fontFamily: fonts.label, color: p.ink }]}>{s.label}</Text>
                    {s.credit ? <Text style={[type.figure, { color: p.ink2 }]} numberOfLines={1}>{s.credit}</Text> : null}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <View style={{ gap: 10 }}>
        <Text style={[type.title3, { color: p.ink }]}>What it has</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {w.features.map((f) => (
            <Chip key={f.id} label={f.label} selected={!!features[f.id]} onPress={() => { haptic.select(); setFeatures((x) => ({ ...x, [f.id]: !x[f.id] })); }} />
          ))}
        </View>
      </View>
      <View style={{ gap: 10 }}>
        <Text style={[type.title3, { color: p.ink }]}>Bedrooms</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {ROOMS.map((r) => (
            <Chip key={r} label={r === 6 ? "6+" : String(r)} selected={rooms === r} onPress={() => setRooms(r)} />
          ))}
        </View>
      </View>
      <View style={{ gap: 10 }}>
        <Text style={[type.title3, { color: p.ink }]}>Budget</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {BUDGETS.map(([millions, cents]) => (
            <Chip key={millions} label={cents === null ? "No limit" : `Up to ${symbol}${millions}M`} selected={budget === cents} onPress={() => setBudget(cents)} />
          ))}
        </View>
      </View>
      <SearchBar primary="Find homes" onPrimary={() => onApply({ styles, features: Object.keys(features).filter((k) => features[k]), bedrooms: rooms, budgetCents: budget })} onJustSearch={onSearchNow} />
    </Glass>
  );
}

/**
 * Carvana-style: one step at a time, each a rail of cards with what it costs, priced from the maker's page. Options
 * take several picks; every other step takes one. "Price this build" makes it the wish; "Just search" finds real cars.
 */
export function CarBuilder({ w, onApply }: { w: CarWidget; onApply(values: Record<string, unknown>): void }) {
  const p = usePalette();
  const money = moneyIn(w.currency);
  const multi = (id: string) => id === "options";
  const [picked, setPicked] = useState<Record<string, string[]>>(() => Object.fromEntries(w.steps.filter((s) => s.selected).map((s) => [s.id, s.selected!.split(",")])));
  const choose = (step: string, id: string) => {
    haptic.select();
    setPicked((x) => {
      const now = x[step] ?? [];
      return { ...x, [step]: multi(step) ? (now.includes(id) ? now.filter((c) => c !== id) : [...now, id]) : [id] };
    });
  };
  const values = () => Object.fromEntries(Object.entries(picked).map(([k, v]) => [k, multi(k) ? v : v[0]]));
  return (
    <Glass style={{ padding: 18, gap: 20, borderRadius: radius.lg }}>
      <Eyebrow color={p.accentText}>Build your car</Eyebrow>
      {w.steps.map((step) => (
        <View key={step.id} style={{ gap: 10 }}>
          <Text style={[type.title3, { color: p.ink }]}>{step.title}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {step.choices.map((c) => {
              const on = (picked[step.id] ?? []).includes(c.id);
              return (
                <Pressable key={c.id} accessibilityRole={multi(step.id) ? "checkbox" : "radio"} accessibilityState={multi(step.id) ? { checked: on } : { selected: on }} onPress={() => choose(step.id, c.id)}>
                  <View style={{ width: 168, borderRadius: radius.md, overflow: "hidden", borderWidth: on ? 2 : StyleSheet.hairlineWidth, borderColor: on ? p.accent : p.hair, backgroundColor: p.surface }}>
                    {c.imageUrl ? (
                      <View style={{ height: 96 }}>
                        <GlassReveal uri={c.imageUrl} standby={require("../../assets/standby/drive.jpg")} stage="clear" treatment="film" style={StyleSheet.absoluteFill} />
                      </View>
                    ) : null}
                    <View style={{ padding: 12, gap: 4 }}>
                      <Text style={[type.label, { color: p.ink }]}>{c.label}</Text>
                      {c.priceCents ? <Text style={[type.figure, { color: p.accentText }]}>{step.id === "trim" ? money(c.priceCents) : `+ ${money(c.priceCents)}`}</Text> : null}
                      {c.detail ? <Text style={[type.footnote, { color: p.ink2 }]} numberOfLines={2}>{c.detail}</Text> : null}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ))}
      <SearchBar primary="Price this build" onPrimary={() => onApply({ ...values(), done: true })} onJustSearch={() => onApply({ ...values(), search: true })} />
    </Glass>
  );
}

const PLACES: NonNullable<LifeContext["home"]>[] = [
  { country: "MT", label: "Malta" },
  { country: "PT", city: "Lisbon", label: "Lisbon" },
  { country: "AE", city: "Dubai", label: "Dubai" },
  { country: "MC", label: "Monaco" },
  { country: "US", city: "Miami", region: "FL", label: "Miami" },
  { country: "US", city: "Los Angeles", region: "CA", label: "Los Angeles" },
  { country: "US", city: "New York", region: "NY", label: "New York" },
  { country: "GB", city: "London", label: "London" },
  { country: "ID", region: "Bali", label: "Bali" },
  { country: "IT", region: "Lake Como", label: "Lake Como" },
];

/** Where regional things are priced. Popular places, or type any place. */
export function RegionPicker({ current, onPick }: { current: LifeContext["home"]; onPick(home: NonNullable<LifeContext["home"]>): void }) {
  const p = usePalette();
  const [text, setText] = useState("");
  return (
    <Glass style={{ padding: 18, gap: 14, borderRadius: radius.lg }}>
      <Eyebrow color={p.accentText}>Where you'll live</Eyebrow>
      <Text style={[type.callout, { color: p.ink2 }]}>Homes, staff, services and running costs are priced for this place.</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {PLACES.map((pl) => (
          <Chip key={pl.label} label={pl.label} selected={current?.label === pl.label} onPress={() => { haptic.select(); onPick(pl); }} />
        ))}
      </View>
      {/* A place, not an address: no address autofill (it would offer where they live now), but corrected spelling. */}
      <Field
        label="Somewhere else"
        labelHidden
        surface="plain"
        value={text}
        onChangeText={setText}
        placeholder="Somewhere else"
        autoCapitalize="words"
        autoCorrect
        spellCheck
        autoComplete="off"
        textContentType="none"
        returnKeyType="done"
        onSubmitEditing={() => text.trim() && onPick({ country: "", label: text.trim() })}
      />
    </Glass>
  );
}
