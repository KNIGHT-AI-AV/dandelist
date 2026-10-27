import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Chip, OptionCard, Trail, Working } from "../../components/agent";
import { Body, Button, Card, ErrorText, Screen, Segmented, Title } from "../../components/ui";
import { getRun, interpretWish, startResearch, type Answer, type Draft, type Question, type Run } from "../../lib/agent";
import { useAuth } from "../../lib/auth";
import { fonts, radius, space, type, usePalette } from "../../lib/theme";
import { useWishes, type WishTier } from "../../lib/wishes";

const EXAMPLES = ["A Leica Q3 camera", "A week in Lisbon for two in May", "Learning to surf", "A Peloton Bike+"];
const TIERS: { value: WishTier; label: string }[] = [
  { value: "must", label: "Must" },
  { value: "nice", label: "Nice" },
  { value: "dream", label: "Dream" },
];
const KIND_LABEL = { buy: "Buy", own: "Own", do: "Do", visit: "Visit" } as const;

type Stage = "describe" | "reading" | "ask" | "research";

function useElapsed(since: number | null) {
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

export default function NewWish() {
  const { api } = useAuth();
  const { add } = useWishes();
  const p = usePalette();
  const [stage, setStage] = useState<Stage>("describe");
  const [text, setText] = useState("");
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
  const elapsed = useElapsed(run?.status === "running" ? startedAt : null);

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
    setStage("reading");
    try {
      const r = await interpretWish(api, text.trim());
      setDraft(r.draft);
      setQuestions(r.questions);
      setAnswers({});
      setStage("ask");
    } catch (e) {
      setError((e as Error).message);
      setStage("describe");
    }
  }

  async function researchIt() {
    if (!draft) return;
    setError(null);
    const given: Answer[] = questions.filter((q) => answers[q.question]).map((q) => ({ question: q.question, answer: answers[q.question]! }));
    try {
      setStartedAt(Date.now());
      setRun(await startResearch(api, draft, given));
      setChosen(0);
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
            imageUrl: option.imageUrl,
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

  if (stage === "describe" || stage === "reading") {
    return (
      <Screen>
        <Text style={[type.label, { color: p.accent, textTransform: "uppercase", letterSpacing: 2 }]}>New wish</Text>
        <Title>What do you wish for?</Title>
        <Body muted>Say it the way you'd tell a friend. Dandelist finds real prices and shows what it costs now, every month and over the years.</Body>
        <TextInput
          accessibilityLabel="Your wish"
          value={text}
          onChangeText={setText}
          multiline
          editable={stage === "describe"}
          placeholder="A week in Lisbon with my partner in May"
          placeholderTextColor={p.muted}
          style={[type.body, { fontFamily: fonts.displayItalic, fontSize: 22, lineHeight: 30, minHeight: 120, textAlignVertical: "top", padding: space.lg, borderRadius: radius.md, borderWidth: 1, borderColor: p.line, backgroundColor: p.surface, color: p.ink }]}
        />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {EXAMPLES.map((e) => (
            <Chip key={e} label={e} selected={text === e} onPress={stage === "describe" ? () => setText(e) : undefined} />
          ))}
        </View>
        <ErrorText>{error}</ErrorText>
        {stage === "reading" ? <Working label="Reading your wish with Meta's Muse Spark…" /> : <Button label="Find real prices" onPress={read} />}
        <Button label="Enter it yourself" kind="quiet" onPress={() => router.push("/wishes/manual")} />
        <Button label="Cancel" kind="quiet" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (stage === "ask" && draft) {
    return (
      <Screen>
        <Text style={[type.label, { color: p.accent, textTransform: "uppercase", letterSpacing: 2 }]}>Here's what I heard</Text>
        <Title>{draft.title}</Title>
        <Body muted>{draft.summary}</Body>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          <Chip label={KIND_LABEL[draft.kind]} selected />
          {draft.specifics.map((s) => (
            <Chip key={s.name} label={`${s.name}: ${s.value}`} />
          ))}
        </View>
        {questions.length ? (
          <Card>
            <Text style={[type.label, { color: p.muted }]}>A few quick questions. Skip any you like.</Text>
            {questions.map((q) => (
              <View key={q.question} style={{ gap: space.sm, paddingTop: space.sm }}>
                <Text style={[type.body, { color: p.ink }]}>{q.question}</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                  {q.choices.map((c) => (
                    <Chip
                      key={c}
                      label={c}
                      selected={answers[q.question] === c}
                      onPress={() => setAnswers((a) => ({ ...a, [q.question]: a[q.question] === c ? "" : c }))}
                    />
                  ))}
                </View>
              </View>
            ))}
          </Card>
        ) : (
          <Body muted>That's clear enough to price.</Body>
        )}
        <ErrorText>{error}</ErrorText>
        <Button label="Research prices" onPress={researchIt} />
        <Button label="Change the wish" kind="quiet" onPress={startOver} />
      </Screen>
    );
  }

  const result = run?.result;
  const working = run?.status === "running";
  return (
    <Screen>
      <Text style={[type.label, { color: p.accent, textTransform: "uppercase", letterSpacing: 2 }]}>{working ? "Researching" : run?.status === "error" ? "Research stopped" : "What it costs"}</Text>
      <Title>{draft?.title ?? "Your wish"}</Title>

      {working ? (
        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
            <Text style={[type.label, { color: p.muted }]}>Meta Muse Spark · web search</Text>
            <Text style={{ fontFamily: fonts.figure, color: p.muted, fontSize: 13 }}>{elapsed}</Text>
          </View>
          <Trail steps={run?.steps ?? []} working />
          <Body muted>Searching stores, opening their pages and checking each price. This takes about a minute.</Body>
        </Card>
      ) : null}

      {run?.status === "error" ? (
        <Card>
          <ErrorText>{run.error}</ErrorText>
          <Button label="Try again" onPress={researchIt} />
        </Card>
      ) : null}

      {result ? (
        result.options.length ? (
          <>
            {result.explanation ? (
              <View style={{ borderLeftWidth: 2, borderLeftColor: p.accent, paddingLeft: space.lg, gap: space.xs }}>
                <Text style={[type.label, { color: p.muted }]}>Dandelist's take</Text>
                <Text style={{ fontFamily: fonts.displayItalic, fontSize: 20, lineHeight: 28, color: p.ink }}>{result.explanation}</Text>
              </View>
            ) : null}
            <View accessibilityRole="radiogroup" accessibilityLabel="Price options" style={{ gap: space.md }}>
              {result.options.map((o, i) => (
                <OptionCard key={`${o.url}-${i}`} option={o} years={result.horizonYears} selected={i === chosen} onSelect={() => setChosen(i)} />
              ))}
            </View>
            {result.note ? <Body muted>{result.note}</Body> : null}
            <Segmented<WishTier> label="How much you want it" options={TIERS} value={tier} onChange={setTier} />
            <ErrorText>{error}</ErrorText>
            <Button label="Add to my list" busy={saving} onPress={save} />
          </>
        ) : (
          <Card>
            <Body>The agent couldn't find a price it could stand behind for this one.</Body>
            <Button label="Enter it yourself" onPress={() => router.push("/wishes/manual")} />
          </Card>
        )
      ) : null}

      {!working && run?.steps.length ? (
        <View style={{ gap: space.md }}>
          <Pressable accessibilityRole="button" onPress={() => setShowTrail((s) => !s)}>
            <Text style={[type.label, { color: p.muted }]}>{`${showTrail ? "Hide" : "Show"} how it found these · ${run.steps.length} steps${run.cached ? " · saved from earlier today" : ""}`}</Text>
          </Pressable>
          {showTrail ? <Trail steps={run.steps} working={false} /> : null}
        </View>
      ) : null}

      {!working ? <Button label="Start over" kind="quiet" onPress={startOver} /> : null}
    </Screen>
  );
}
