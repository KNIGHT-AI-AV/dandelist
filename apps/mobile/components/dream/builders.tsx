import type { LifeContext, Widget } from "@dandelist/catalogue/dream";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { haptic } from "../../lib/motion";
import { moneyIn } from "../../lib/dream";
import { MAX_OWN, OWN, addOwn } from "../../lib/own";
import { carSelectionSummary, carSelectionValues, commitCarDrafts, initialCarSelection, removeCarOwn } from "../../lib/car-selection";
import { fonts, layout, radius, usePalette, type } from "../../lib/theme";
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
 * "Type your own" for a builder section (owner, 2026-10-29: every generated section gets one). Typed entries sit with
 * the offered chips, picked; tapping one takes it out. `children` are the section's own chips, in the same row.
 */
function OwnRow({ label, own, draft, onDraft, onCommit, onRemove, children }: { label: string; own: string[]; draft: string | null; onDraft(v: string | null): void; onCommit(): void; onRemove(v: string): void; children?: ReactNode }) {
  const p = usePalette();
  return (
    <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {children}
        {own.map((o) => (
          <Chip key={`own-${o}`} label={o} selected onPress={() => { haptic.select(); onRemove(o); }} />
        ))}
        {own.length < MAX_OWN ? <Chip label={OWN} selected={draft !== null} onPress={() => { haptic.select(); onDraft(draft === null ? "" : null); }} /> : null}
      </View>
      {draft !== null ? (
        <TextInput
          value={draft}
          onChangeText={(v) => onDraft(v.slice(0, 40))}
          placeholder="Your own answer"
          placeholderTextColor={p.ink3}
          accessibilityLabel={label}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={onCommit}
          style={[type.body, { color: p.ink, borderBottomWidth: 1, borderBottomColor: p.line, paddingVertical: layout.stack.tight }]}
        />
      ) : null}
    </>
  );
}

/**
 * The home builder the agent opens from a description: pick the style from real photographs, toggle the features
 * it heard (and any it didn't), type any style or feature it didn't offer, set the bedrooms and an optional budget.
 * "Just search" skips straight to listings. Where it searches comes from Settings (the person's home) or from the
 * chat; there is no place pill here.
 */
export function HomeBuilder({ w, onApply, onSearchNow }: { w: HomeWidget; onApply(values: Record<string, unknown>): void; onSearchNow(): void }) {
  const p = usePalette();
  const [styles, setStyles] = useState<string[]>(() => w.styles.filter((s) => s.on).map((s) => s.id));
  const symbol = symbolOf(w.currency);
  const [features, setFeatures] = useState(() => Object.fromEntries(w.features.map((f) => [f.id, f.on])));
  const [rooms, setRooms] = useState<number | null>(w.bedrooms);
  const [budget, setBudget] = useState<number | null>(w.budgetCents);
  // Typed styles and features, and each section's open field (null when closed). The server takes typed entries as
  // they are: a typed style or feature goes into the search by its own words.
  const [ownStyles, setOwnStyles] = useState<string[]>([]);
  const [ownFeatures, setOwnFeatures] = useState<string[]>([]);
  const [styleDraft, setStyleDraft] = useState<string | null>(null);
  const [featureDraft, setFeatureDraft] = useState<string | null>(null);
  const toggleStyle = (id: string) => {
    haptic.select();
    setStyles((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };
  const commitStyle = () => {
    const r = addOwn(styleDraft ?? "", w.styles, ownStyles);
    if (r.pick) setStyles((s) => (s.includes(r.pick!) ? s : [...s, r.pick!]));
    setOwnStyles(r.own);
    setStyleDraft(null);
  };
  const commitFeature = () => {
    const r = addOwn(featureDraft ?? "", w.features, ownFeatures);
    if (r.pick) setFeatures((x) => ({ ...x, [r.pick!]: true }));
    setOwnFeatures(r.own);
    setFeatureDraft(null);
  };
  const apply = () => {
    // Whatever is still in an open field counts, as if its return key had been pressed.
    const s = addOwn(styleDraft ?? "", w.styles, ownStyles);
    const f = addOwn(featureDraft ?? "", w.features, ownFeatures);
    const styleIds = s.pick && !styles.includes(s.pick) ? [...styles, s.pick] : styles;
    const featureIds = Object.keys(features).filter((k) => features[k] || k === f.pick);
    onApply({ styles: [...styleIds, ...s.own], features: [...featureIds, ...f.own], bedrooms: rooms, budgetCents: budget });
  };
  return (
    <Glass style={{ padding: 18, gap: 18, borderRadius: radius.lg }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Eyebrow color={p.accentText}>Your home</Eyebrow>
        {w.region ? (
          <View style={{ minHeight: TARGET, justifyContent: "center", flexShrink: 1, paddingLeft: 12 }}>
            <Text style={[type.footnote, { fontFamily: fonts.label, color: p.ink2 }]} numberOfLines={1}>{`In ${w.region}`}</Text>
          </View>
        ) : null}
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
        <OwnRow label="Which feels like home?" own={ownStyles} draft={styleDraft} onDraft={setStyleDraft} onCommit={commitStyle} onRemove={(o) => setOwnStyles((x) => x.filter((y) => y !== o))} />
      </View>
      <View style={{ gap: 10 }}>
        <Text style={[type.title3, { color: p.ink }]}>What it has</Text>
        <OwnRow label="What it has" own={ownFeatures} draft={featureDraft} onDraft={setFeatureDraft} onCommit={commitFeature} onRemove={(o) => setOwnFeatures((x) => x.filter((y) => y !== o))}>
          {w.features.map((f) => (
            <Chip key={f.id} label={f.label} selected={!!features[f.id]} onPress={() => { haptic.select(); setFeatures((x) => ({ ...x, [f.id]: !x[f.id] })); }} />
          ))}
        </OwnRow>
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
        <Text style={[type.title3, { color: p.ink }]}>Price</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {BUDGETS.map(([millions, cents]) => (
            <Chip key={millions} label={cents === null ? "No limit" : `Up to ${symbol}${millions}M`} selected={budget === cents} onPress={() => setBudget(cents)} />
          ))}
        </View>
      </View>
      <SearchBar primary="Find homes" onPrimary={apply} onJustSearch={onSearchNow} />
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
  const [selection, setSelection] = useState(() => initialCarSelection(w));
  const [drafts, setDrafts] = useState<Record<string, string | null>>({});
  const choose = (step: string, id: string) => {
    haptic.select();
    setSelection((x) => {
      const now = x.picked[step] ?? [];
      const picked = { ...x.picked, [step]: multi(step) ? (now.includes(id) ? now.filter((c) => c !== id) : [...now, id]) : [id] };
      if (step === "model" && (x.own.model?.length || now[0] !== id)) for (const s of w.steps) if (s.id !== "model") picked[s.id] = [];
      return { picked, own: multi(step) ? x.own : { ...x.own, [step]: [] } };
    });
    if (!multi(step)) setDrafts((x) => ({ ...x, [step]: null }));
  };
  const pending = commitCarDrafts(w, selection, drafts);
  const summary = carSelectionSummary(w, pending);
  const apply = (action: "done" | "search") => {
    setSelection(pending);
    setDrafts({});
    onApply({ ...carSelectionValues(pending), [action]: true });
  };
  return (
    <Glass style={{ padding: 18, gap: 20, borderRadius: radius.lg }}>
      <Eyebrow color={p.accentText}>Build your car</Eyebrow>
      {w.steps.map((step) => (
        <View key={step.id} style={{ gap: 10 }}>
          <Text style={[type.title3, { color: p.ink }]}>{step.title}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {step.choices.filter((c) => !c.custom).map((c) => {
              const on = (selection.picked[step.id] ?? []).includes(c.id);
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
          <OwnRow
            label={`Your own ${step.title.toLowerCase()}`}
            own={selection.own[step.id] ?? []}
            draft={drafts[step.id] ?? null}
            onDraft={(value) => setDrafts((x) => ({ ...x, [step.id]: value }))}
            onCommit={() => {
              setSelection((x) => commitCarDrafts(w, x, { [step.id]: drafts[step.id] ?? null }));
              setDrafts((x) => ({ ...x, [step.id]: null }));
            }}
            onRemove={(label) => setSelection((x) => removeCarOwn(w, x, step.id, label))}
          />
        </View>
      ))}
      {summary.unpriced.length ? (
        <View style={{ gap: 6 }}>
          <Text style={[type.label, { color: p.ink }]}>{`Priced parts: ${money(summary.subtotal)}`}</Text>
          <Text style={[type.footnote, { color: p.ink2 }]}>{`Not priced: ${summary.unpriced.join("; ")}. This is not a complete price. Your choices stay in the build.`}</Text>
        </View>
      ) : null}
      <SearchBar primary="Price this build" onPrimary={() => apply("done")} onJustSearch={() => apply("search")} />
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
