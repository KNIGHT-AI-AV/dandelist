import type { Item } from "@dandelist/cost";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ledger } from "../../components/ledger";
import { AgentDot, Backdrop, Chip, EdgeFade, ErrorLine, Eyebrow, Glass, Grain, Hairline, IconButton, Money, Photo, PrimaryButton, Protect, QuietButton, Shade } from "../../components/lux";
import { Statement, Take } from "../../components/statement";
import { getRun, interpretWish, startResearch, type Answer, type Draft, type PriceOption, type Question, type Run, type Step } from "../../lib/agent";
import { useAuth } from "../../lib/auth";
import { fonts, layout, radius, type, usePalette, useType } from "../../lib/theme";
import { useWishes, type WishTier } from "../../lib/wishes";
import { KIND_LABEL, hostOf } from "../../lib/words";

const EXAMPLES = ["A week at Amanzoe for two", "A Leica Q3", "Learning to surf in Bali", "A Porsche 911 Carrera"];
const TIERS: { value: WishTier; label: string }[] = [
  { value: "must", label: "Must" },
  { value: "nice", label: "Nice" },
  { value: "dream", label: "Dream" },
];
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
  const t = useType();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const gutter = layout.gutter(width);
  const dock = layout.dockHeight(insets.bottom);
  const column = { width: "100%" as const, maxWidth: layout.list + 2 * gutter, alignSelf: "center" as const, paddingHorizontal: gutter };
  const [stage, setStage] = useState<Stage>("describe");
  // The dream builder hands single items here with the person's words, which are read straight away.
  const handed = useLocalSearchParams<{ text?: string }>().text;
  const [text, setText] = useState(typeof handed === "string" ? handed.slice(0, 300) : "");
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

  const autoRead = useRef(false);
  useEffect(() => {
    if (autoRead.current || !text.trim()) return;
    autoRead.current = true;
    void read();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            ...(option.media ? { media: option.media } : {}),
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
  const close = <IconButton icon="close" label="Close" onPress={() => (router.canGoBack() ? router.back() : router.replace("/wishes"))} style={{ position: "absolute", top: insets.top + 4, left: 16, zIndex: 10 }} />;

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
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[column, { paddingTop: insets.top + layout.contentTop, paddingBottom: dock, gap: 20 }]}>
            <View style={{ gap: layout.stack.tight }}>
              <Eyebrow>New wish</Eyebrow>
              <Text accessibilityRole="header" style={[t.display, { color: p.ink }]}>
                What do you <Text style={{ fontFamily: fonts.displayItalic, color: p.accentText }}>want</Text>?
              </Text>
            </View>
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
                  style={[type.title3, { fontFamily: fonts.titleItalic, color: p.ink, minHeight: 96, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: p.line, textAlignVertical: "top" }, NO_OUTLINE]}
                />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {EXAMPLES.map((e) => (
                    <Chip key={e} label={e} selected={text === e} onPress={reading ? undefined : () => setText(e)} />
                  ))}
                </View>
                <ErrorLine>{error}</ErrorLine>
                <QuietButton label="Enter it yourself" onPress={() => router.push("/wishes/manual")} style={{ alignSelf: "flex-start" }} />
              </>
            ) : draft ? (
              <>
                <Text style={[type.title3, { fontFamily: fonts.titleItalic, color: p.ink }]}>{text}</Text>
                <Glass style={{ padding: layout.cardPad, gap: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <AgentDot />
                    <Text style={[type.footnote, { color: p.ink2 }]}>
                      {questions.length ? `Your agent · ${questions.length === 1 ? "one quick question" : `${questions.length} quick questions`}` : "Your agent · that's clear enough to price"}
                    </Text>
                  </View>
                  <Text style={[type.title2, { color: p.ink }]}>{draft.title}</Text>
                  <Text style={[type.footnote, { color: p.ink2 }]}>{[KIND_LABEL[draft.kind], ...draft.specifics.map((s) => s.value)].join(" · ")}</Text>
                  {questions.map((q) => (
                    <View key={q.question} style={{ gap: 12 }}>
                      <Hairline />
                      <Text style={[type.callout, { color: p.ink }]}>{q.question}</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                        {q.choices.map((c) => (
                          <Chip key={c} label={c} selected={answers[q.question] === c} onPress={() => setAnswers((a) => ({ ...a, [q.question]: a[q.question] === c ? "" : c }))} />
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
        <EdgeFade height={dock} />
        <View pointerEvents="box-none" style={{ position: "absolute", left: gutter, right: gutter, bottom: insets.bottom + 20, alignItems: "center" }}>
          <PrimaryButton label={stage === "describe" ? "Find the real price" : "Research the price"} busyLabel="Reading your wish..." busy={reading} onPress={stage === "describe" ? read : research} />
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
      <ScrollView contentContainerStyle={{ paddingBottom: result?.options.length ? dock : insets.bottom + 40 }} style={{ scrollbarWidth: "thin", scrollbarColor: `rgba(${p.inkRgb},0.2) transparent` } as object}>
        <View style={{ height: 440, width: "100%" }}>
          <Photo uri={heroImage} kind={draft?.kind} />
          <Shade from={0.15} />
        </View>
        <View style={[column, { marginTop: -150, gap: layout.stack.tight }]}>
          {/* Text protection over the photo: a 35% dimming layer behind the title block (HIG Materials, P1-22). */}
          <Protect />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {working ? <AgentDot busy /> : null}
            <Eyebrow>{working ? `Researching · ${clock} · Meta Muse Spark` : run?.status === "error" ? "Research stopped" : `${KIND_LABEL[draft?.kind ?? "buy"]} · what it costs`}</Eyebrow>
          </View>
          <Text accessibilityRole="header" style={[t.title1, { color: p.ink }]}>{draft?.title}</Text>
          {option ? <Text style={[type.footnote, { color: p.ink2 }]}>{`${option.seller} · ${hostOf(option.url)} · ${option.status === "verified" ? "price checked on the page" : "estimate"}`}</Text> : null}
        </View>

        <View style={[column, { marginTop: 24, gap: 20 }]}>
          {working ? (
            <View>
              <Ledger steps={run?.steps ?? []} startedAt={run!.createdAt} working />
              {best ? (
                <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.ink4, marginTop: 4, paddingTop: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
                  <Eyebrow>Best so far</Eyebrow>
                  <Money cents={best.upfrontCents!} size="title" align="right" />
                </View>
              ) : null}
            </View>
          ) : null}

          {run?.status === "error" ? (
            <Glass style={{ padding: layout.cardPad, gap: 12 }}>
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
                      <Glass style={{ paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: i === chosen ? p.ink : p.line, minWidth: 148, gap: 4 }}>
                        <Text style={[type.footnote, { color: p.ink2 }]} numberOfLines={1}>{o.seller}</Text>
                        <Money cents={o.upfrontCents} size="card" />
                        <Text style={[type.eyebrow, { color: o.status === "verified" ? p.accentText : p.ink3 }]}>{o.status === "verified" ? "Checked" : "Estimate"}</Text>
                      </Glass>
                    </Pressable>
                  ))}
                </ScrollView>
              ) : null}
              <Take>{result.explanation}</Take>
              {result.note ? <Text style={[type.footnote, { color: p.ink2 }]}>{result.note}</Text> : null}
              <View style={{ gap: 8 }}>
                <Eyebrow>How much you want it</Eyebrow>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {TIERS.map((tr) => (
                    <Chip key={tr.value} label={tr.label} selected={tier === tr.value} onPress={() => setTier(tr.value)} />
                  ))}
                </View>
              </View>
              <ErrorLine>{error}</ErrorLine>
              <QuietButton label={`${showTrail ? "Hide" : "Show"} how it found this · ${run!.steps.length} steps${run!.cached ? " · saved from earlier today" : ""}`} onPress={() => setShowTrail((v) => !v)} style={{ alignSelf: "flex-start" }} />
              {showTrail ? <Ledger steps={run!.steps} startedAt={run!.createdAt} working={false} /> : null}
              <QuietButton label="Start over" onPress={startOver} style={{ alignSelf: "flex-start" }} />
            </>
          ) : result && !result.options.length ? (
            <Glass style={{ padding: layout.cardPad, gap: 12 }}>
              <Text style={[type.callout, { color: p.ink }]}>The agent couldn't find a price it could stand behind for this one.</Text>
              <PrimaryButton label="Enter it yourself" onPress={() => router.push("/wishes/manual")} />
            </Glass>
          ) : null}
        </View>
      </ScrollView>
      {close}
      {result?.options.length ? (
        <>
          <EdgeFade height={dock} />
          <View pointerEvents="box-none" style={{ position: "absolute", left: gutter, right: gutter, bottom: insets.bottom + 20, alignItems: "center" }}>
            <PrimaryButton label="Add to my life list" commit busy={saving} onPress={save} />
          </View>
        </>
      ) : null}
      <Grain />
    </View>
  );
}
