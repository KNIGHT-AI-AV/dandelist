import type { LifeContext, Widget } from "@dandelist/catalogue/dream";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { haptic } from "../../lib/motion";
import { formatCents } from "../../lib/money";
import { fonts, radius, usePalette } from "../../lib/theme";
import { Eyebrow, Glass, PrimaryButton, Shade } from "../lux";
import { GlassReveal } from "../reveal";
import { Chip } from "../welcome/kit";

type HomeWidget = Extract<Widget, { kind: "home_builder" }>;
type CarWidget = Extract<Widget, { kind: "car_builder" }>;

const BUDGETS: [string, number | null][] = [["Up to $1M", 100_000_000], ["Up to $3M", 300_000_000], ["Up to $10M", 1_000_000_000], ["No limit", null]];
const ROOMS = [2, 3, 4, 5, 6];

function SearchBar({ primary, onPrimary, onJustSearch }: { primary: string; onPrimary(): void; onJustSearch(): void }) {
  const p = usePalette();
  return (
    <View style={{ gap: 6 }}>
      <PrimaryButton label={primary} onPress={onPrimary} />
      <Pressable accessibilityRole="button" onPress={onJustSearch} hitSlop={8} style={{ alignSelf: "center", paddingVertical: 8 }}>
        <Text style={{ fontFamily: fonts.label, fontSize: 13.5, color: p.ink2 }}>Just search</Text>
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
  const [styles, setStyles] = useState<string[]>([]);
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
        <Eyebrow color={p.accent}>Your home</Eyebrow>
        <Pressable accessibilityRole="button" onPress={onRegion} hitSlop={8}>
          <Text style={{ fontFamily: fonts.label, fontSize: 12.5, color: p.ink2 }}>{`In ${w.region}  ▾`}</Text>
        </Pressable>
      </View>
      <View style={{ gap: 10 }}>
        <Text style={{ fontFamily: fonts.display, fontSize: 22, color: p.ink }}>Which feels like home?</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
          {w.styles.map((s) => {
            const on = styles.includes(s.id);
            return (
              <Pressable key={s.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={s.label} onPress={() => toggleStyle(s.id)}>
                <View style={{ width: 132, height: 172, borderRadius: radius.md, overflow: "hidden", borderWidth: on ? 2 : StyleSheet.hairlineWidth, borderColor: on ? p.accent : p.hair }}>
                  <GlassReveal uri={s.imageUrl ?? null} standby={require("../../assets/standby/life.jpg")} stage="clear" treatment="film" style={StyleSheet.absoluteFill} />
                  <Shade from={0.45} />
                  <Text style={{ position: "absolute", left: 10, right: 10, bottom: 10, fontFamily: fonts.label, fontSize: 13, color: p.ink }}>{s.label}</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <View style={{ gap: 10 }}>
        <Text style={{ fontFamily: fonts.display, fontSize: 22, color: p.ink }}>What it has</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {w.features.map((f) => (
            <Chip key={f.id} label={f.label} selected={!!features[f.id]} onPress={() => { haptic.select(); setFeatures((x) => ({ ...x, [f.id]: !x[f.id] })); }} />
          ))}
        </View>
      </View>
      <View style={{ gap: 10 }}>
        <Text style={{ fontFamily: fonts.display, fontSize: 22, color: p.ink }}>Bedrooms</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {ROOMS.map((r) => (
            <Chip key={r} label={r === 6 ? "6+" : String(r)} selected={rooms === r} onPress={() => setRooms(r)} />
          ))}
        </View>
      </View>
      <View style={{ gap: 10 }}>
        <Text style={{ fontFamily: fonts.display, fontSize: 22, color: p.ink }}>Budget</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {BUDGETS.map(([label, cents]) => (
            <Chip key={label} label={label} selected={budget === cents} onPress={() => setBudget(cents)} />
          ))}
        </View>
      </View>
      <SearchBar primary="Find homes" onPrimary={() => onApply({ styles, features: Object.keys(features).filter((k) => features[k]), bedrooms: rooms, budgetCents: budget })} onJustSearch={onSearchNow} />
    </Glass>
  );
}

/** Carvana-style: one step at a time, each a rail of cards with what it adds to the price. */
export function CarBuilder({ w, onApply, onSearchNow }: { w: CarWidget; onApply(values: Record<string, unknown>): void; onSearchNow(): void }) {
  const p = usePalette();
  const [picked, setPicked] = useState<Record<string, string>>(() => Object.fromEntries(w.steps.filter((s) => s.selected).map((s) => [s.id, s.selected!])));
  return (
    <Glass style={{ padding: 18, gap: 20, borderRadius: radius.lg }}>
      <Eyebrow color={p.accent}>Build your car</Eyebrow>
      {w.steps.map((step) => (
        <View key={step.id} style={{ gap: 10 }}>
          <Text style={{ fontFamily: fonts.display, fontSize: 22, color: p.ink }}>{step.title}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {step.choices.map((c) => {
              const on = picked[step.id] === c.id;
              return (
                <Pressable key={c.id} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => { haptic.select(); setPicked((x) => ({ ...x, [step.id]: c.id })); }}>
                  <View style={{ width: 168, borderRadius: radius.md, overflow: "hidden", borderWidth: on ? 2 : StyleSheet.hairlineWidth, borderColor: on ? p.accent : p.hair, backgroundColor: p.surface }}>
                    {c.imageUrl ? (
                      <View style={{ height: 96 }}>
                        <GlassReveal uri={c.imageUrl} standby={require("../../assets/standby/drive.jpg")} stage="clear" treatment="film" style={StyleSheet.absoluteFill} />
                      </View>
                    ) : null}
                    <View style={{ padding: 12, gap: 4 }}>
                      <Text style={{ fontFamily: fonts.label, fontSize: 14, color: p.ink }}>{c.label}</Text>
                      {c.detail ? <Text style={{ fontFamily: fonts.body, fontSize: 12, color: p.ink2 }} numberOfLines={2}>{c.detail}</Text> : null}
                      {c.priceCents != null ? <Text style={{ fontFamily: fonts.figure, fontSize: 12, color: p.accent }}>{c.priceCents ? `+ ${formatCents(c.priceCents)}` : "Included"}</Text> : null}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ))}
      <SearchBar primary="Find this car" onPrimary={() => onApply(picked)} onJustSearch={onSearchNow} />
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
      <Eyebrow color={p.accent}>Where you'll live</Eyebrow>
      <Text style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: p.ink2 }}>Homes, staff, services and running costs are priced for this place.</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {PLACES.map((pl) => (
          <Chip key={pl.label} label={pl.label} selected={current?.label === pl.label} onPress={() => { haptic.select(); onPick(pl); }} />
        ))}
      </View>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Somewhere else"
        placeholderTextColor={p.ink3}
        onSubmitEditing={() => text.trim() && onPick({ country: "", label: text.trim() })}
        style={{ minHeight: 48, paddingHorizontal: 16, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: p.hair, color: p.ink, fontFamily: fonts.body, fontSize: 15 }}
      />
    </Glass>
  );
}
