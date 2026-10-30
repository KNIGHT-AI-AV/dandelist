import type { LifeContext, Widget } from "@dandelist/catalogue/dream";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { answerAsk, askDone, pickedLine, reopenAsk, startAsk, timeUpAsk, type Ask } from "../../lib/ask";
import { haptic } from "../../lib/motion";
import { moneyIn } from "../../lib/dream";
import { MAX_OWN, OWN, addOwn } from "../../lib/own";
import { autoPickCar, carSelectionSummary, carSelectionValues, carStepLabels, commitCarDrafts, initialCarSelection, multiStep, pickCarChoice, removeCarOwn, type CarSelection } from "../../lib/car-selection";
import { fonts, layout, radius, usePalette, type } from "../../lib/theme";
import { AskBar, AskNote, AskRow, useAskClock } from "../ask";
import { Field } from "../inputs";
import { TARGET } from "../inputs/tokens";
import { Eyebrow, Glass, Shade } from "../lux";
import { GlassReveal } from "../reveal";
import { Chip } from "../welcome/kit";

type HomeWidget = Extract<Widget, { kind: "home_builder" }>;
type CarWidget = Extract<Widget, { kind: "car_builder" }>;

/**
 * Both builders ask one thing at a time (owner, 2026-10-30, lib/ask.ts): a tap is the whole answer, the question folds
 * into a one-line summary (tap it to change) and the next opens; once every one has an answer the builder goes on by
 * itself. Left alone, the Dandy goes with its own picks and says which. `live` is a builder that opened in this
 * visit (one reopened from history starts folded and waits for a tap); `waiting` is true while it is the newest
 * thing in the chat, so the Dandy's clock runs only while it is the thing being asked.
 */
interface BuilderTiming {
  live?: boolean;
  waiting?: boolean;
}

/** Budget steps in the builder's own currency: "Up to €1M". */
const BUDGETS: [number, number | null][] = [[1, 100_000_000], [3, 300_000_000], [10, 1_000_000_000], [0, null]];
const symbolOf = (currency = "USD") => moneyIn(currency)(0).replace(/[\d.,\s]/g, "") || "$";
const ROOMS = [2, 3, 4, 5, 6];
const roomLabel = (r: number) => (r >= 6 ? "6+" : String(r));

/** Find real listings now, from what the chat already knows, without the builder's answers. */
function JustSearch({ onPress }: { onPress(): void }) {
  const p = usePalette();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8} style={{ alignSelf: "center", minHeight: layout.control.icon, justifyContent: "center", paddingHorizontal: 8 }}>
      <Text style={[type.footnote, { fontFamily: fonts.label, color: p.ink2 }]}>Just search</Text>
    </Pressable>
  );
}

/**
 * "Type your own" for a builder section (owner, 2026-10-29: every generated section gets one). Typed entries sit with
 * the offered chips, picked; tapping one takes it out. `children` are the section's own chips, in the same row. The
 * Dandy's clock holds while the field has focus.
 */
function OwnRow({ label, own, draft, onDraft, onCommit, onRemove, onTyping, children }: { label: string; own: string[]; draft: string | null; onDraft(v: string | null): void; onCommit(): void; onRemove(v: string): void; onTyping?(on: boolean): void; children?: ReactNode }) {
  const p = usePalette();
  // A field that closes or leaves with its section never reports its blur, so the clock is let go here too.
  const typing = useRef(onTyping);
  typing.current = onTyping;
  useEffect(() => {
    if (draft === null) typing.current?.(false);
  }, [draft]);
  useEffect(() => () => typing.current?.(false), []);
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
          onFocus={() => onTyping?.(true)}
          onBlur={() => onTyping?.(false)}
          style={[type.body, { color: p.ink, borderBottomWidth: 1, borderBottomColor: p.line, paddingVertical: layout.stack.tight }]}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- the home builder

type HomeSel = { styles: string[]; features: Record<string, boolean>; rooms: number | null; budget: number | null; ownStyles: string[]; ownFeatures: string[] };
const HOME_STEPS = ["styles", "features", "bedrooms", "price"] as const;
type HomeStep = (typeof HOME_STEPS)[number];
const HOME_MULTI = new Set<string>(["styles", "features"]);

/** What is still in an open field counts, as if its return key had been pressed. */
function commitHome(w: HomeWidget, s: HomeSel, styleDraft: string | null, featureDraft: string | null): HomeSel {
  const st = addOwn(styleDraft ?? "", w.styles, s.ownStyles);
  const ft = addOwn(featureDraft ?? "", w.features, s.ownFeatures);
  return {
    ...s,
    styles: st.pick && !s.styles.includes(st.pick) ? [...s.styles, st.pick] : s.styles,
    features: ft.pick ? { ...s.features, [ft.pick]: true } : s.features,
    ownStyles: st.own,
    ownFeatures: ft.own,
  };
}

/** The server takes typed entries as they are: a typed style or feature goes into the search by its own words. */
const homeValues = (s: HomeSel) => ({
  styles: [...s.styles, ...s.ownStyles],
  features: [...Object.keys(s.features).filter((k) => s.features[k]), ...s.ownFeatures],
  bedrooms: s.rooms,
  budgetCents: s.budget,
});

function homeLabels(w: HomeWidget, s: HomeSel, step: string): string[] {
  if (step === "styles") return [...s.styles.map((id) => w.styles.find((x) => x.id === id)?.label ?? id), ...s.ownStyles];
  if (step === "features") return [...w.features.filter((f) => s.features[f.id]).map((f) => f.label), ...s.ownFeatures];
  if (step === "bedrooms") return s.rooms ? [`${roomLabel(s.rooms)} bedrooms`] : [];
  return [];
}

/**
 * The home builder the agent opens from a description: pick the style from real photographs, toggle the features
 * it heard (and any it didn't), type any style or feature it didn't offer, set the bedrooms and an optional budget,
 * one at a time; it searches once each has an answer. "Just search" skips straight to listings. Where it searches
 * comes from Settings (the person's home) or from the chat; there is no place pill here.
 */
export function HomeBuilder({ w, live = false, waiting = false, onApply, onSearchNow }: { w: HomeWidget; onApply(values: Record<string, unknown>): void; onSearchNow(): void } & BuilderTiming) {
  const p = usePalette();
  const symbol = symbolOf(w.currency);
  // A budget the chat named that isn't one of the steps reads as the amount itself.
  const budgetLabel = (cents: number | null) => {
    if (cents === null) return "No limit";
    const step = BUDGETS.find(([, c]) => c === cents)?.[0];
    return step ? `Up to ${symbol}${step}M` : `Up to ${moneyIn(w.currency)(cents)}`;
  };
  const [sel, setSel] = useState<HomeSel>(() => ({
    styles: w.styles.filter((s) => s.on).map((s) => s.id),
    features: Object.fromEntries(w.features.map((f) => [f.id, f.on])),
    rooms: w.bedrooms,
    budget: w.budgetCents,
    ownStyles: [],
    ownFeatures: [],
  }));
  // Each section's open "Type your own" field (null when closed).
  const [styleDraft, setStyleDraft] = useState<string | null>(null);
  const [featureDraft, setFeatureDraft] = useState<string | null>(null);
  // Bedrooms and a budget the chat already named start answered; the styles and features are always shown, since
  // tuning them against the photographs is what this builder is for.
  const [ask, setAsk] = useState<Ask>(() => (live ? startAsk(HOME_STEPS, [...(w.bedrooms !== null ? ["bedrooms"] : []), ...(w.budgetCents !== null ? ["price"] : [])]) : startAsk(HOME_STEPS, HOME_STEPS)));
  const [note, setNote] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const pickedIn = useRef<string | null>(null);
  const latest = useRef({ sel, styleDraft, featureDraft, ask });
  latest.current = { sel, styleDraft, featureDraft, ask };

  const proceed = (next: Ask, s: HomeSel) => {
    const committed = commitHome(w, s, latest.current.styleDraft, latest.current.featureDraft);
    setSel(committed);
    setStyleDraft(null);
    setFeatureDraft(null);
    setAsk(next);
    if (askDone(next)) onApply(homeValues(committed));
  };
  const onDue = (key: string) => {
    const { sel: s, ask: a } = latest.current;
    if (HOME_MULTI.has(key) && pickedIn.current === key) return proceed(answerAsk(a, HOME_STEPS, key), s);
    const { ask: next, took } = timeUpAsk(a, HOME_STEPS);
    const committed = commitHome(w, s, latest.current.styleDraft, latest.current.featureDraft);
    setNote(pickedLine(took.flatMap((id) => homeLabels(w, committed, id))));
    proceed(next, committed);
  };
  const clock = useAskClock(ask.open, !askDone(ask) && (waiting || touched), onDue);
  useEffect(() => {
    pickedIn.current = null;
  }, [ask.open]);

  const engage = () => {
    setTouched(true);
    setNote(null);
  };
  /** A pick on styles or features: they take several, so the section closes a moment after the last one. */
  const pickMany = (step: HomeStep, s: HomeSel) => {
    engage();
    setSel(s);
    pickedIn.current = step;
    clock.picked();
  };
  const answerOne = (step: HomeStep, s: HomeSel) => {
    engage();
    proceed(answerAsk(ask, HOME_STEPS, step), s);
  };
  const reopen = (step: HomeStep) => {
    engage();
    setAsk(reopenAsk(ask, step));
  };

  const toggleStyle = (id: string) => {
    haptic.select();
    pickMany("styles", { ...sel, styles: sel.styles.includes(id) ? sel.styles.filter((x) => x !== id) : [...sel.styles, id] });
  };
  const commitStyle = () => {
    if (!styleDraft?.trim()) return setStyleDraft(null);
    pickMany("styles", commitHome(w, sel, styleDraft, null));
    setStyleDraft(null);
  };
  const commitFeature = () => {
    if (!featureDraft?.trim()) return setFeatureDraft(null);
    pickMany("features", commitHome(w, sel, null, featureDraft));
    setFeatureDraft(null);
  };

  const summary: Record<HomeStep, { title: string; answer: string }> = {
    styles: { title: "Style", answer: homeLabels(w, sel, "styles").join(", ") || "Any" },
    features: { title: "What it has", answer: homeLabels(w, sel, "features").join(", ") || "None" },
    bedrooms: { title: "Bedrooms", answer: sel.rooms ? roomLabel(sel.rooms) : "Any" },
    price: { title: "Price", answer: budgetLabel(sel.budget) },
  };

  const section = (step: HomeStep): ReactNode => {
    switch (step) {
      case "styles":
        return (
          <>
            <Text style={[type.title3, { color: p.ink }]}>Which feels like home?</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }} onScrollBeginDrag={clock.touch}>
              {w.styles.map((s) => {
                const on = sel.styles.includes(s.id);
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
            <OwnRow
              label="Which feels like home?"
              own={sel.ownStyles}
              draft={styleDraft}
              onDraft={(v) => {
                engage();
                clock.touch();
                setStyleDraft(v);
              }}
              onCommit={commitStyle}
              onRemove={(o) => pickMany("styles", { ...sel, ownStyles: sel.ownStyles.filter((y) => y !== o) })}
              onTyping={clock.typing}
            />
          </>
        );
      case "features":
        return (
          <>
            <Text style={[type.title3, { color: p.ink }]}>What it has</Text>
            <OwnRow
              label="What it has"
              own={sel.ownFeatures}
              draft={featureDraft}
              onDraft={(v) => {
                engage();
                clock.touch();
                setFeatureDraft(v);
              }}
              onCommit={commitFeature}
              onRemove={(o) => pickMany("features", { ...sel, ownFeatures: sel.ownFeatures.filter((y) => y !== o) })}
              onTyping={clock.typing}
            >
              {w.features.map((f) => (
                <Chip key={f.id} label={f.label} selected={!!sel.features[f.id]} onPress={() => pickMany("features", { ...sel, features: { ...sel.features, [f.id]: !sel.features[f.id] } })} />
              ))}
            </OwnRow>
          </>
        );
      case "bedrooms":
        return (
          <>
            <Text style={[type.title3, { color: p.ink }]}>Bedrooms</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {ROOMS.map((r) => (
                <Chip key={r} label={roomLabel(r)} selected={sel.rooms === r} onPress={() => answerOne("bedrooms", { ...sel, rooms: r })} />
              ))}
            </View>
          </>
        );
      case "price":
        return (
          <>
            <Text style={[type.title3, { color: p.ink }]}>Price</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {BUDGETS.map(([millions, cents]) => (
                <Chip key={millions} label={budgetLabel(cents)} selected={sel.budget === cents} onPress={() => answerOne("price", { ...sel, budget: cents })} />
              ))}
            </View>
          </>
        );
    }
  };

  return (
    <Glass style={{ padding: 18, gap: 12, borderRadius: radius.lg }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Eyebrow color={p.accentText}>Your home</Eyebrow>
        {w.region ? (
          <View style={{ minHeight: TARGET, justifyContent: "center", flexShrink: 1, paddingLeft: 12 }}>
            <Text style={[type.footnote, { fontFamily: fonts.label, color: p.ink2 }]} numberOfLines={1}>{`In ${w.region}`}</Text>
          </View>
        ) : null}
      </View>
      {HOME_STEPS.map((step) =>
        ask.open === step ? (
          <View key={step} style={{ gap: 10, paddingBottom: 4 }}>
            {section(step)}
            <AskBar windowMs={clock.windowMs} round={clock.round} />
          </View>
        ) : step in ask.by ? (
          <AskRow key={step} title={summary[step].title} answer={summary[step].answer} onPress={() => reopen(step)} />
        ) : null,
      )}
      <AskNote text={note} />
      <JustSearch onPress={onSearchNow} />
    </Glass>
  );
}

// ---------------------------------------------------------------- the car builder

/**
 * Carvana-style: a rail of cards with what each costs, priced from the maker's page, one step at a time. Options take
 * several picks; every other step takes one, and a tap moves on. Once every step has an answer the build is priced;
 * "Just search" finds real cars instead.
 */
export function CarBuilder({ w, live = false, waiting = false, onApply }: { w: CarWidget; onApply(values: Record<string, unknown>): void } & BuilderTiming) {
  const p = usePalette();
  const money = moneyIn(w.currency);
  const ids = w.steps.map((s) => s.id);
  const [selection, setSelection] = useState(() => initialCarSelection(w));
  const [drafts, setDrafts] = useState<Record<string, string | null>>({});
  // What the maker's page or the chat already settled starts answered (the model, a lone trim, a colour they named,
  // a step with nothing on offer); the first other step opens. When that leaves nothing to ask, the step with the
  // most to choose from opens on the Dandy's pick, so the person still gets a say before the build is priced.
  const [ask, setAsk] = useState<Ask>(() => {
    if (!live) return startAsk(ids, ids);
    const first = initialCarSelection(w);
    const settled = w.steps.filter((s) => first.picked[s.id]?.length || first.own[s.id]?.length || !s.choices.some((c) => !c.custom)).map((s) => s.id);
    const a = startAsk(ids, settled);
    if (!askDone(a)) return a;
    const widest = [...w.steps].sort((x, y) => y.choices.length - x.choices.length)[0];
    return widest && widest.choices.filter((c) => !c.custom).length > 1 ? reopenAsk(a, widest.id) : a;
  });
  const [note, setNote] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const pickedIn = useRef<string | null>(null);
  const latest = useRef({ selection, drafts, ask });
  latest.current = { selection, drafts, ask };

  const proceed = (next: Ask, sel: CarSelection, open: Record<string, string | null>, action: "done" | "search" = "done") => {
    const pending = commitCarDrafts(w, sel, open);
    setSelection(pending);
    setDrafts({});
    setAsk(next);
    if (askDone(next)) onApply({ ...carSelectionValues(pending), [action]: true });
  };
  const onDue = (key: string) => {
    const { selection: sel, drafts: open, ask: a } = latest.current;
    if (multiStep(key) && pickedIn.current === key) return proceed(answerAsk(a, ids, key), sel, open);
    const { ask: next, took } = timeUpAsk(a, ids);
    const auto = autoPickCar(w, commitCarDrafts(w, sel, open), took);
    setNote(pickedLine(auto.labels));
    proceed(next, auto.selection, {});
  };
  const clock = useAskClock(ask.open, !askDone(ask) && (waiting || touched), onDue);
  useEffect(() => {
    pickedIn.current = null;
  }, [ask.open]);
  // Nothing to ask at all (one model, one trim, nothing else on offer): it is priced as it arrives.
  const priced = useRef(false);
  useEffect(() => {
    if (priced.current || !live || !waiting || !askDone(ask) || touched) return;
    priced.current = true;
    onApply({ ...carSelectionValues(selection), done: true });
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const engage = () => {
    setTouched(true);
    setNote(null);
  };
  const choose = (step: string, id: string) => {
    haptic.select();
    engage();
    const next = pickCarChoice(w, selection, step, id);
    if (multiStep(step)) {
      setSelection(next);
      pickedIn.current = step;
      clock.picked();
      return;
    }
    // A tapped card replaces anything half-typed for the same step.
    proceed(answerAsk(ask, ids, step), next, { ...drafts, [step]: null });
  };
  const commitOwn = (step: string) => {
    const text = drafts[step]?.trim();
    if (!text) return setDrafts((x) => ({ ...x, [step]: null }));
    engage();
    const sel = commitCarDrafts(w, selection, { [step]: text });
    const open = { ...drafts, [step]: null };
    if (multiStep(step)) {
      setSelection(sel);
      setDrafts(open);
      pickedIn.current = step;
      clock.picked();
      return;
    }
    proceed(answerAsk(ask, ids, step), sel, open);
  };
  const reopen = (step: string) => {
    engage();
    setAsk(reopenAsk(ask, step));
  };
  const search = () => {
    engage();
    proceed(timeUpAsk(ask, ids).ask, selection, drafts, "search");
  };

  const answerOf = (step: CarWidget["steps"][number]) => {
    const labels = carStepLabels(w, selection, step.id);
    const chosen = selection.picked[step.id] ?? [];
    const only = chosen.length === 1 && labels.length === 1 && step.id !== "model" ? step.choices.find((c) => c.id === chosen[0]) : undefined;
    if (!only?.priceCents) return labels.join(", ") || "None";
    return `${only.label} · ${step.id === "trim" ? money(only.priceCents) : `+ ${money(only.priceCents)}`}`;
  };
  const summary = carSelectionSummary(w, commitCarDrafts(w, selection, drafts));

  return (
    <Glass style={{ padding: 18, gap: 12, borderRadius: radius.lg }}>
      <Eyebrow color={p.accentText}>Build your car</Eyebrow>
      {w.steps.map((step) =>
        ask.open === step.id ? (
          <View key={step.id} style={{ gap: 10, paddingBottom: 4 }}>
            <Text style={[type.title3, { color: p.ink }]}>{step.title}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }} onScrollBeginDrag={clock.touch}>
              {step.choices.filter((c) => !c.custom).map((c) => {
                const on = (selection.picked[step.id] ?? []).includes(c.id);
                return (
                  <Pressable
                    key={c.id}
                    accessibilityRole={multiStep(step.id) ? "checkbox" : "radio"}
                    accessibilityState={multiStep(step.id) ? { checked: on } : { selected: on }}
                    accessibilityLabel={c.priceCents ? `${c.label}, ${step.id === "trim" ? money(c.priceCents) : `+ ${money(c.priceCents)}`}` : c.label}
                    onPress={() => choose(step.id, c.id)}
                  >
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
              onDraft={(value) => {
                engage();
                clock.touch();
                setDrafts((x) => ({ ...x, [step.id]: value }));
              }}
              onCommit={() => commitOwn(step.id)}
              onRemove={(label) => {
                engage();
                setSelection((x) => removeCarOwn(w, x, step.id, label));
                if (multiStep(step.id)) {
                  pickedIn.current = step.id;
                  clock.picked();
                }
              }}
              onTyping={clock.typing}
            />
            <AskBar windowMs={clock.windowMs} round={clock.round} />
          </View>
        ) : step.id in ask.by ? (
          <AskRow key={step.id} title={step.title} answer={answerOf(step)} onPress={() => reopen(step.id)} />
        ) : null,
      )}
      {summary.unpriced.length ? (
        <View style={{ gap: 6 }}>
          <Text style={[type.label, { color: p.ink }]}>{`Priced parts: ${money(summary.subtotal)}`}</Text>
          <Text style={[type.footnote, { color: p.ink2 }]}>{`Not priced: ${summary.unpriced.join("; ")}. This is not a complete price. Your choices stay in the build.`}</Text>
        </View>
      ) : null}
      <AskNote text={note} />
      <JustSearch onPress={search} />
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

/**
 * Where regional things are priced. Popular places, or type any place. A pick is the whole answer: the picker folds
 * into one line with the place, a tap away from changing it.
 */
export function RegionPicker({ current, onPick }: { current: LifeContext["home"]; onPick(home: NonNullable<LifeContext["home"]>): void }) {
  const p = usePalette();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(!current);
  const [picked, setPicked] = useState<string | null>(null);
  const pick = (home: NonNullable<LifeContext["home"]>) => {
    setPicked(home.label);
    setOpen(false);
    setText("");
    onPick(home);
  };
  if (!open) {
    return (
      <Glass style={{ paddingHorizontal: 18, paddingVertical: 4, borderRadius: radius.lg }}>
        <AskRow title="Where you'll live" answer={picked ?? current?.label ?? ""} onPress={() => setOpen(true)} />
      </Glass>
    );
  }
  return (
    <Glass style={{ padding: 18, gap: 14, borderRadius: radius.lg }}>
      <Eyebrow color={p.accentText}>Where you'll live</Eyebrow>
      <Text style={[type.callout, { color: p.ink2 }]}>Homes, staff, services and running costs are priced for this place.</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {PLACES.map((pl) => (
          <Chip key={pl.label} label={pl.label} selected={(picked ?? current?.label) === pl.label} onPress={() => { haptic.select(); pick(pl); }} />
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
        onSubmitEditing={() => text.trim() && pick({ country: "", label: text.trim() })}
      />
    </Glass>
  );
}
