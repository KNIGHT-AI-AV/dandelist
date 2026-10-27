import type { Item } from "@dandelist/cost";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ledger } from "../../components/ledger";
import { AgentDot, Backdrop, Choice, ErrorLine, Eyebrow, Figure, Glass, Grain, Hairline, Photo, PrimaryButton, QuietButton, Shade } from "../../components/lux";
import { Statement, Take } from "../../components/statement";
import { getRun, interpretWish, startResearch, type Answer, type Draft, type PriceOption, type Question, type Run, type Step } from "../../lib/agent";
import { useAuth } from "../../lib/auth";
import { formatCents } from "../../lib/money";
import { fonts, radius, space, usePalette } from "../../lib/theme";
import { useWishes, type WishTier } from "../../lib/wishes";
import { KIND_LABEL, hostOf } from "../../lib/words";

const EXAMPLES = ["A week at Amanzoe for two", "A Leica Q3", "Learning to surf in Bali", "A Porsche 911 Carrera"];
const TIERS: { value: WishTier; label: string }[] = [
  { value: "must", label: "Must" },
  { value: "nice", label: "Nice" },
  { value: "dream", label: "Dream" },
];
const MAX_W = 520;
// The browser draws its own focus box around text fields; the hairline underneath is the focus cue here.
const NO_OUTLINE = Platform.OS === "web" ? ({ outlineWidth: 0 } as object) : null;

type Stage = "describe" | "ask" | "research";

function useClock(since: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (since === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  if (since === null) return "";
  const s = Math.max(0, Math.round((now - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const asItem = (o: PriceOption): Item => ({ id: o.url, upfrontCents: o.upfrontCents, recurring: o.recurring });

export default function NewWish() {
  const { api } = useAuth();
  const { wishes, add } = useWishes();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<Stage>("describe");
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [run, setRun] = useState<Run | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [chosen, setChosen] = useState(0);
  const [tier, setTier] = useState<WishTier>("nice");
  const [showTrail, setShowTrail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);
  const working = run?.status === "running";
  const clock = useClock(working ? startedAt : null);

  // Poll the research run until the agent finishes.
  useEffect(() => {
    if (!run || run.status !== "running") return;
    const t = setTimeout(async () => {
      try {
        const next = await getRun(api, run.id);
        if (alive.current) setRun(next);
      } catch (e) {
        if (alive.current) setError((e as Error).message);
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [run, api]);

  async function read() {
    if (text.trim().length < 2) return setError("Describe the wish in a few words.");
    setError(null);
    setReading(true);
    try {
      const r = await interpretWish(api, text.trim());
      setDraft(r.draft);
      setQuestions(r.questions);
      setAnswers({});
      setStage("ask");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }

  async function research() {
    if (!draft) return;
    setError(null);
    const given: Answer[] = questions.filter((q) => answers[q.question]).map((q) => ({ question: q.question, answer: answers[q.question]! }));
    try {
      setStartedAt(Date.now());
      setRun(await startResearch(api, draft, given));
      setChosen(0);
      setShowTrail(false);
      setStage("research");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function save() {
    const option = run?.result?.options[chosen];
    if (!draft || !run?.result || !option) return;
    setSaving(true);
    setError(null);
    try {
      await add({
        name: draft.title,
        kind: draft.kind,
        tier,
        upfrontCents: option.upfrontCents,
        recurringCents: 0,
        period: "month",
        recurring: option.recurring.map((r) => ({ amountCents: r.amountCents, period: r.period, label: r.label.slice(0, 60) })),
        details: {
          agent: {
            runId: run.id,
            seller: option.seller,
            url: option.url,
            status: option.status,
            checkedAt: option.checkedAt,
            imageUrl: option.imageUrl ?? run.result.options.find((o) => o.imageUrl)?.imageUrl,
            explanation: run.result.explanation,
            source: option.source,
          },
        },
      });
      router.replace("/wishes");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function startOver() {
    setStage("describe");
    setRun(null);
    setDraft(null);
    setError(null);
  }

  const latestImage = wishes.find((w) => w.details.agent?.imageUrl)?.details.agent?.imageUrl;
  const close = (
    <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => (router.canGoBack() ? router.back() : router.replace("/wishes"))} hitSlop={10} style={{ position: "absolute", top: insets.top + 10, left: 16, zIndex: 10 }}>
      <Glass style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontFamily: fonts.body, fontSize: 18, color: p.ink, marginTop: -2 }}>×</Text>
      </Glass>
    </Pressable>
  );

  // Concierge: describe the wish, then answer the agent's questions, over a blurred photograph.
  if (stage === "describe" || stage === "ask") {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        {latestImage ? (
          <View style={StyleSheet.absoluteFill}>
            <Photo uri={latestImage} />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(${p.bgRgb}, 0.62)` }]} />
          </View>
        ) : (
          <Backdrop source={require("../../assets/backdrop.jpg")} blur={28} dim={0.5} />
        )}
        <Glass intensity={70} style={[StyleSheet.absoluteFill, { borderRadius: 0, borderWidth: 0 }]} />
        {close}
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: insets.top + 70, paddingBottom: insets.bottom + 120, paddingHorizontal: 24, gap: 18, width: "100%", maxWidth: MAX_W, alignSelf: "center" }}>
            <Eyebrow>New wish</Eyebrow>
            <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 46, lineHeight: 48, color: p.ink, letterSpacing: -0.4 }}>
              What do you <Text style={{ fontFamily: fonts.displayItalic, color: p.accent }}>want</Text>?
            </Text>
            {stage === "describe" ? (
              <>
                <TextInput
                  accessibilityLabel="Your wish"
                  value={text}
                  onChangeText={setText}
                  multiline
                  autoFocus={Platform.OS !== "web"}
                  editable={!reading}
                  placeholder="A week at Amanzoe with my wife in May"
                  placeholderTextColor={p.ink3}
                  style={[{ fontFamily: fonts.displayItalic, fontSize: 23, lineHeight: 31, color: p.ink, minHeight: 96, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: p.hair, textAlignVertical: "top" }, NO_OUTLINE]}
                />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                  {EXAMPLES.map((e) => (
                    <Choice key={e} label={e} selected={text === e} onPress={reading ? undefined : () => setText(e)} />
                  ))}
                </View>
                <ErrorLine>{error}</ErrorLine>
                <QuietButton label="Enter it yourself" onPress={() => router.push("/wishes/manual")} style={{ alignSelf: "flex-start" }} />
              </>
            ) : draft ? (
              <>
                <Text style={{ fontFamily: fonts.displayItalic, fontSize: 23, lineHeight: 31, color: p.ink }}>{text}</Text>
                <Glass style={{ padding: 16, gap: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <AgentDot />
                    <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: p.ink2 }}>
                      {questions.length ? `Your agent · ${questions.length === 1 ? "one quick question" : `${questions.length} quick questions`}` : "Your agent · that's clear enough to price"}
                    </Text>
                  </View>
                  <Text style={{ fontFamily: fonts.display, fontSize: 24, lineHeight: 27, color: p.ink }}>{draft.title}</Text>
                  <Text style={{ fontFamily: fonts.body, fontSize: 13, color: p.ink2 }}>{[KIND_LABEL[draft.kind], ...draft.specifics.map((s) => s.value)].join(" · ")}</Text>
                  {questions.map((q) => (
                    <View key={q.question} style={{ gap: 10 }}>
                      <Hairline />
                      <Text style={{ fontFamily: fonts.body, fontSize: 15, color: p.ink }}>{q.question}</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                        {q.choices.map((c) => (
                          <Choice key={c} label={c} selected={answers[q.question] === c} onPress={() => setAnswers((a) => ({ ...a, [q.question]: a[q.question] === c ? "" : c }))} />
                        ))}
                      </View>
                    </View>
                  ))}
                </Glass>
                <ErrorLine>{error}</ErrorLine>
                <QuietButton label="Change the wish" onPress={startOver} style={{ alignSelf: "flex-start" }} />
              </>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
        <View style={{ position: "absolute", left: 24, right: 24, bottom: insets.bottom + 20, alignItems: "center" }}>
          <PrimaryButton
            label={stage === "describe" ? (reading ? "Reading your wish..." : "Find the real price") : "Research the price"}
            busy={reading}
            onPress={stage === "describe" ? read : research}
            style={{ width: "100%", maxWidth: MAX_W - 48 }}
          />
        </View>
        <Grain />
      </View>
    );
  }

  // Research: the photograph arrives first, then the ledger; when it's done, the price statement.
  const result = run?.result;
  const option = result?.options[chosen];
  // The hero is the chosen option's photo, else the last page the agent opened that had one.
  const opened = [...(run?.steps ?? [])].reverse().find((s): s is Extract<Step, { type: "open" }> => s.type === "open" && !!s.imageUrl);
  const heroImage = option?.imageUrl ?? opened?.imageUrl ?? latestImage;
  const best = (run?.steps ?? []).filter((s): s is Extract<Step, { type: "price" }> => s.type === "price" && s.upfrontCents != null).sort((a, b) => a.upfrontCents! - b.upfrontCents!)[0];

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + (result?.options.length ? 120 : 40) }}>
        <View style={{ height: 440, width: "100%" }}>
          <Photo uri={heroImage} kind={draft?.kind} />
          <Shade from={0.15} />
        </View>
        <View style={{ marginTop: -150, paddingHorizontal: 24, gap: 8, width: "100%", maxWidth: MAX_W, alignSelf: "center" }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {working ? <AgentDot /> : null}
              <Eyebrow>{working ? `Researching · ${clock}` : run?.status === "error" ? "Research stopped" : `${KIND_LABEL[draft?.kind ?? "buy"]} · what it costs`}</Eyebrow>
            </View>
            <Eyebrow>Meta Muse Spark</Eyebrow>
          </View>
          <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 36, lineHeight: 39, color: p.ink }}>{draft?.title}</Text>
          {option ? <Text style={{ fontFamily: fonts.body, fontSize: 13, color: p.ink2 }}>{`${option.seller} · ${hostOf(option.url)} · ${option.status === "verified" ? "price checked on the page" : "estimate"}`}</Text> : null}
        </View>

        <View style={{ paddingHorizontal: 16, marginTop: 18, gap: 18, width: "100%", maxWidth: MAX_W, alignSelf: "center" }}>
          {working ? (
            <View style={{ paddingHorizontal: 8 }}>
              <Ledger steps={run?.steps ?? []} startedAt={run!.createdAt} working />
              {best ? (
                <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.ink3, marginTop: 4, paddingTop: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
                  <Eyebrow>Best so far</Eyebrow>
                  <Figure value={formatCents(best.upfrontCents!)} size={32} />
                </View>
              ) : null}
            </View>
          ) : null}

          {run?.status === "error" ? (
            <Glass style={{ padding: 18, gap: 12 }}>
              <ErrorLine>{run.error}</ErrorLine>
              <PrimaryButton label="Try again" onPress={research} />
            </Glass>
          ) : null}

          {result && option ? (
            <>
              <Statement item={asItem(option)} years={result.horizonYears} monthlyHint={option.recurring.map((r) => r.label).join(", ")} />
              {result.options.length > 1 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
                  {result.options.map((o, i) => (
                    <Pressable key={`${o.url}-${i}`} accessibilityRole="radio" accessibilityState={{ selected: i === chosen }} onPress={() => setChosen(i)}>
                      <Glass style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md, borderColor: i === chosen ? p.ink : p.hair, minWidth: 140, gap: 2 }}>
                        <Text style={{ fontFamily: fonts.body, fontSize: 12, color: p.ink2 }} numberOfLines={1}>{o.seller}</Text>
                        <Figure value={formatCents(o.upfrontCents)} size={19} />
                        <Text style={{ fontFamily: fonts.label, fontSize: 10.5, letterSpacing: 1.2, textTransform: "uppercase", color: o.status === "verified" ? p.accent : p.ink3 }}>{o.status === "verified" ? "Checked" : "Estimate"}</Text>
                      </Glass>
                    </Pressable>
                  ))}
                </ScrollView>
              ) : null}
              <Take>{result.explanation}</Take>
              {result.note ? <Text style={{ fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: p.ink2 }}>{result.note}</Text> : null}
              <View style={{ gap: 8 }}>
                <Eyebrow>How much you want it</Eyebrow>
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  {TIERS.map((t) => (
                    <Choice key={t.value} label={t.label} selected={tier === t.value} onPress={() => setTier(t.value)} />
                  ))}
                </View>
              </View>
              <ErrorLine>{error}</ErrorLine>
              <QuietButton label={`${showTrail ? "Hide" : "Show"} how it found this · ${run!.steps.length} steps${run!.cached ? " · saved from earlier today" : ""}`} onPress={() => setShowTrail((v) => !v)} style={{ alignSelf: "flex-start" }} />
              {showTrail ? <Ledger steps={run!.steps} startedAt={run!.createdAt} working={false} /> : null}
              <QuietButton label="Start over" onPress={startOver} style={{ alignSelf: "flex-start" }} />
            </>
          ) : result && !result.options.length ? (
            <Glass style={{ padding: 18, gap: 12 }}>
              <Text style={{ fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: p.ink }}>The agent couldn't find a price it could stand behind for this one.</Text>
              <PrimaryButton label="Enter it yourself" onPress={() => router.push("/wishes/manual")} />
            </Glass>
          ) : null}
        </View>
      </ScrollView>
      {close}
      {result?.options.length ? (
        <View style={{ position: "absolute", left: 24, right: 24, bottom: insets.bottom + 20, alignItems: "center" }}>
          <PrimaryButton label="Add to my life list" busy={saving} onPress={save} style={{ width: "100%", maxWidth: MAX_W - 48 }} />
        </View>
      ) : null}
      <Grain />
    </View>
  );
}
