import type { Item } from "@dandelist/cost";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ledger } from "../../components/ledger";
import { AgentDot, Backdrop, Chip, EdgeFade, ErrorLine, Eyebrow, Glass, Grain, IconButton, Money, Photo, PrimaryButton, Protect, QuietButton, Shade } from "../../components/lux";
import { Statement, Take } from "../../components/statement";
import { getRun, startHunt, transcribeWish, type Answer, type Draft, type PriceOption, type Run, type Step } from "../../lib/agent";
import { answerPick, pickAdded } from "../../lib/picks";
import { answersFrom, refineChanged, withGiven } from "../../lib/refine";
import { RefinePanel } from "../../components/refine";
import { endTask, startTask } from "../../lib/activity";
import { useAuth } from "../../lib/auth";
import { fonts, layout, radius, space, type, usePalette, useType } from "../../lib/theme";
import { useWishes, type WishTier } from "../../lib/wishes";
import { KIND_LABEL, hostOf } from "../../lib/words";
import { Atmosphere } from "../../components/atmosphere";
import { Carve, RevealPhoto, ThoughtLine } from "../../components/wish-reveal";
import { FIELD_MIN, WISH_MAX, WishField } from "../../components/wish-field";
import { ListeningPanel, MicButton, useVoiceWish } from "../../components/voice/say-wish";
import { KeyboardDock, KeyboardScroll, dockRoom } from "../../components/inputs";
import { Rise } from "../../components/welcome/kit";
import { haptic } from "../../lib/motion";
import { useWaitingMusic } from "../../lib/waiting";
import { clarityOf, deckFor, thoughtOf } from "../../lib/reveal";
import { useMoney } from "../../lib/currency";
import { amountSteps, photoOnly, startAmount, wholeCents } from "../../lib/worth";
import { AmountPicker, PricelessPrice, glyphFor } from "../../components/worth";

/** The research hero's height, and its shape as the aspect the shuffle picks catalogue crops for. */
const HERO_HEIGHT = 440;
/** The price slot's carved width while no price is in: about the width of a six-figure price at title size. */
const PRICE_SLOT = 132;
/** When the answer lands, its parts rise in as the photo comes into focus: top to bottom, 80 ms apart. */
const LAND_AT = { seller: 380, statement: 460, options: 540, take: 620, rest: 700 } as const;

const EXAMPLES = ["A week at Amanzoe for two", "A Leica Q3", "Learning to surf in Bali", "A Porsche 911 Carrera"];
const TIERS: { value: WishTier; label: string }[] = [
  { value: "must", label: "Must" },
  { value: "nice", label: "Nice" },
  { value: "dream", label: "Dream" },
];

type Stage = "describe" | "research";

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
  const handedParams = useLocalSearchParams<{ text?: string; pick?: string }>();
  const handed = handedParams.text;
  /** Today's pick this wish came from, if any: it's recorded as added only once the wish is saved. */
  const fromPick = handedParams.pick;
  const [text, setText] = useState(typeof handed === "string" ? handed.slice(0, 300) : "");
  const [reading, setReading] = useState(false);
  // The wish as read before, when hunting again with changed answers; a hunt from the words reads it on the server.
  const [asked, setAsked] = useState<Draft | null>(null);
  // Answers changed under "Refine it" and not hunted with yet, by question id.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [refining, setRefining] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const draft = run?.draft ?? asked;
  const questions = run?.result?.questions?.length ? run.result.questions : (draft?.questions ?? []);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [chosen, setChosen] = useState(0);
  const [tier, setTier] = useState<WishTier>("nice");
  const [showTrail, setShowTrail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // A money wish's amount as set on its slider (US cents); null until it moves.
  const [amount, setAmount] = useState<number | null>(null);
  const money = useMoney();
  // The last hunt was a money or priceless card's "Price it", so trying again prices it too.
  const priceAsked = useRef(false);
  const field = useRef<TextInput>(null);
  // The docked button's height, reported by KeyboardDock, so the scroll leaves room for it above the keyboard.
  const [askDock, setAskDock] = useState<number>(layout.control.primary);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);
  // Say your wish: what Muse Voice heard lands in the field (rising in, counted by `heard`) to check before pricing.
  const [heard, setHeard] = useState(0);
  const voice = useVoiceWish({
    transcribe: (wav) => transcribeWish(api, wav),
    onHeard: (words) => {
      setText(words.slice(0, WISH_MAX));
      setHeard((n) => n + 1);
    },
    onError: setError,
  });
  const working = run?.status === "running";
  // The list's Dandy area shows the research as a live task while it runs.
  useEffect(() => {
    if (!working || !draft?.title) return;
    const id = startTask(`Pricing ${draft.title}`);
    return () => endTask(id);
  }, [working, draft?.title]);
  const clock = useClock(working ? startedAt : null);

  // The first card landing is the moment that matters. While the agent works, the waiting ballad; as the card lands, the
  // haptic ramp and the chime (lib/waiting.ts). Money and the priceless land with their own card.
  const landed = !!run?.result?.options.length || !!run?.result?.worth;
  useWaitingMusic(stage !== "research" ? "idle" : landed ? "landed" : working ? "waiting" : "idle");

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

  // The hunt starts from the words at once (owner, 2026-10-29: no button to find the price after sending, no questions
  // first). The agent picks the likely answer to each question; "Refine it" changes them and hunts again.
  async function hunt(wish: { text: string; price?: boolean } | { draft: Draft; answers: Answer[] }) {
    setError(null);
    setReading(true);
    priceAsked.current = "text" in wish && !!wish.price;
    try {
      const next = await startHunt(api, wish);
      setStartedAt(Date.now());
      setAsked("draft" in wish ? wish.draft : null);
      setRun(next);
      setEdits({});
      setRefining(false);
      setChosen(0);
      setAmount(null);
      setShowTrail(false);
      setStage("research");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }

  function read() {
    if (text.trim().length < 2) return setError("Describe the wish in a few words.");
    void hunt({ text: text.trim() });
  }

  function huntAgain() {
    if (!draft || !refineChanged(questions, edits)) return;
    const answers = answersFrom(questions, edits);
    void hunt({ draft: { ...draft, questions: withGiven(questions, answers) }, answers });
  }

  // A hunt from the words starts over from them (still priced, after "Price it"); a hunt again keeps the wish as read
  // and the answers given.
  const retry = () => void (asked ? hunt({ draft: asked, answers: answersFrom(asked.questions ?? [], {}) }) : hunt({ text: text.trim(), ...(priceAsked.current ? { price: true } : {}) }));

  /** Money at the amount picked, or something priceless at infinity (lib/worth.ts), saved the way the chat card saves them. */
  async function saveWorth() {
    const w = run?.result?.worth;
    if (!w) return;
    const shot = run?.result?.photo;
    setSaving(true);
    setError(null);
    try {
      await add({
        name: w.title,
        kind: w.kind,
        tier,
        upfrontCents: w.worth === "money" ? wholeCents(amount ?? startAmount(amountSteps(money.rate, money.unit, w.amountCents), w.amountCents)) : 0,
        recurringCents: 0,
        period: "month",
        recurring: [],
        details: { ...(w.worth === "money" ? { worth: "money" as const } : { worth: "priceless" as const, line: w.line.slice(0, 120) }), ...(shot ? { agent: photoOnly(shot.imageUrl, shot.media) } : {}) },
      });
      if (fromPick) {
        pickAdded(fromPick);
        void answerPick(api, fromPick, "added").catch(() => {});
      }
      router.replace("/wishes");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    if (run?.result?.worth) return saveWorth();
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
      if (fromPick) {
        pickAdded(fromPick);
        void answerPick(api, fromPick, "added").catch(() => {});
      }
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
    setAsked(null);
    setEdits({});
    setRefining(false);
    setError(null);
  }

  const wishField = (
    <WishField ref={field} value={text} onChangeText={setText} onSubmit={() => void read()} editable={!reading} placeholder="A week at Amanzoe with my wife in May" inset={voice.supported ? layout.control.icon + layout.stack.tight : 0} />
  );

  const latestImage = wishes.find((w) => w.details.agent?.imageUrl)?.details.agent?.imageUrl;
  const close = <IconButton icon="close" label="Close" onPress={() => (router.canGoBack() ? router.back() : router.replace("/wishes"))} style={{ position: "absolute", top: insets.top + (layout.headerBar - layout.control.icon) / 2, left: gutter, zIndex: 10 }} />;

  // Concierge: describe the wish over a blurred photograph; the hunt starts the moment it's sent.
  if (stage === "describe") {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <Atmosphere />
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
        <KeyboardScroll dock={askDock} contentContainerStyle={[column, { paddingTop: insets.top + layout.contentTop, paddingBottom: dockRoom(askDock, insets.bottom), gap: space[20] }]}>
            <View style={{ gap: layout.stack.tight }}>
              <Eyebrow>New wish</Eyebrow>
              <Text accessibilityRole="header" style={[t.display, { color: p.ink }]}>
                What do you <Text style={{ fontFamily: fonts.displayItalic, color: p.accentText }}>want</Text>?
              </Text>
            </View>
            <View>
              {voice.phase !== "idle" ? (
                <ListeningPanel voice={voice} height={FIELD_MIN + layout.stack.tight + 1} />
              ) : heard ? (
                <Rise key={heard}>{wishField}</Rise>
              ) : (
                wishField
              )}
              <View style={{ position: "absolute", top: 0, right: 0 }}>
                <MicButton voice={voice} />
              </View>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: layout.stack.tight }}>
              {EXAMPLES.map((e) => (
                <Chip key={e} label={e} selected={text === e} onPress={reading ? undefined : () => { haptic.select(); setText(e); field.current?.focus(); }} />
              ))}
            </View>
            <ErrorLine>{error}</ErrorLine>
            <QuietButton label="Enter it yourself" onPress={() => router.push("/wishes/manual")} style={{ alignSelf: "flex-start" }} />
        </KeyboardScroll>
        <KeyboardDock onHeight={setAskDock}>
          <PrimaryButton
            label="Hunt for it"
            busyLabel="Reading your wish..."
            busy={reading}
            disabled={voice.phase !== "idle"}
            onPress={read}
          />
        </KeyboardDock>
        <Grain />
      </View>
    );
  }

  // Research: the card's space is carved out and pictures shuffle behind a blur that clears as the agent finds the
  // real thing; its reasoning reads live. When it's done, the real photo lands in focus and the price statement follows.
  const result = run?.result;
  const option = result?.options[chosen];
  // Money itself or something priceless: no hunt ran, so there is no research to watch (a money photo may still come).
  const worth = result?.worth;
  const named = worth?.worth === "money" ? worth.amountCents : undefined;
  const amountCents = amount ?? startAmount(amountSteps(money.rate, money.unit, named), named);
  const steps = run?.steps ?? [];
  const settled = !!run && run.status !== "running";
  // The hero is the chosen option's photo, else the last page the agent opened that had one. Never another wish's photo.
  const opened = [...steps].reverse().find((s): s is Extract<Step, { type: "open" }> => s.type === "open" && !!s.imageUrl);
  const heroImage = option?.imageUrl ?? opened?.imageUrl ?? null;
  const best = steps.filter((s): s is Extract<Step, { type: "price" }> => s.type === "price" && s.upfrontCents != null).sort((a, b) => a.upfrontCents! - b.upfrontCents!)[0];
  const pages = steps.filter((s) => s.type === "open" && s.ok).length;
  const checks = steps.filter((s) => s.type === "check").length;
  const tally = [pages ? `${pages} ${pages === 1 ? "page" : "pages"} read` : "", checks ? `${checks} checked` : ""].filter(Boolean).join(" · ");

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <Atmosphere />
      <ScrollView contentContainerStyle={{ paddingBottom: result?.options.length || worth ? dock : insets.bottom + 40 }} style={{ scrollbarWidth: "thin", scrollbarColor: `rgba(${p.inkRgb},0.2) transparent` } as object}>
        <View style={{ height: HERO_HEIGHT, width: "100%" }}>
          {worth ? (
            <Photo uri={result?.photo?.imageUrl} glyph={glyphFor(worth.worth, worth.title, money.symbol)} />
          ) : (
            <RevealPhoto deck={deckFor(steps, draft?.kind, width / HERO_HEIGHT)} final={heroImage} clarity={clarityOf(steps, settled)} done={settled} />
          )}
          <Shade from={0.15} />
        </View>
        <View style={[column, { marginTop: -150, gap: layout.stack.tight }]}>
          {/* Text protection over the photo: a 35% dimming layer behind the title block (HIG Materials, P1-22). */}
          <Protect />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {working && !worth ? <AgentDot busy /> : null}
            <Eyebrow>{worth ? KIND_LABEL[worth.kind] : working ? `Researching · ${clock}` : run?.status === "error" ? "Research stopped" : `${KIND_LABEL[draft?.kind ?? "buy"]} · what it costs`}</Eyebrow>
          </View>
          <Text accessibilityRole="header" style={[t.title1, { color: p.ink }]}>{worth?.title ?? draft?.title}</Text>
          {option ? (
            <Rise delay={LAND_AT.seller}>
              <Text style={[type.footnote, { color: p.ink2 }]}>{`${option.seller} · ${hostOf(option.url)} · ${option.status === "verified" ? "price checked on the page" : "estimate"}`}</Text>
            </Rise>
          ) : working && !worth ? (
            <Carve width="62%" height={type.footnote.lineHeight ?? 0} />
          ) : null}
        </View>

        <View style={[column, { marginTop: layout.stack.section - 8, gap: layout.stack.base + 4 }]}>
          {working && !worth ? (
            <>
              <ThoughtLine thought={thoughtOf(steps)} tally={tally} />
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: layout.control.primary }}>
                <Eyebrow>Best so far</Eyebrow>
                {best ? <Money cents={best.upfrontCents!} size="title" align="right" /> : <Carve width={PRICE_SLOT} height={type.title2.lineHeight ?? 0} />}
              </View>
              <Ledger steps={steps} startedAt={run!.createdAt} working />
            </>
          ) : null}

          {run?.status === "error" ? (
            <Glass style={{ padding: layout.cardPad, gap: 12 }}>
              <ErrorLine>{run.error}</ErrorLine>
              <PrimaryButton label="Try again" onPress={retry} />
            </Glass>
          ) : null}

          {result && option ? (
            <>
              <Rise delay={LAND_AT.statement}>
                <Statement item={asItem(option)} years={result.horizonYears} monthlyHint={option.recurring.map((r) => r.label).join(", ")} />
              </Rise>
              {result.options.length > 1 ? (
                <Rise delay={LAND_AT.options}>
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
                </Rise>
              ) : null}
              {result.explanation ? (
                <Rise delay={LAND_AT.take}>
                  <Take>{result.explanation}</Take>
                </Rise>
              ) : null}
              {result.note ? <Text style={[type.footnote, { color: p.ink2 }]}>{result.note}</Text> : null}
              {questions.length ? (
                <View style={{ gap: 10 }}>
                  <QuietButton label={refining ? "Done refining" : "Refine it"} onPress={() => setRefining((r) => !r)} style={{ alignSelf: "flex-start" }} />
                  {refining ? <RefinePanel questions={questions} edits={edits} onEdit={(q, a) => setEdits((e) => ({ ...e, [q]: a }))} onHunt={huntAgain} /> : null}
                </View>
              ) : null}
              <Rise delay={LAND_AT.rest} style={{ gap: 8 }}>
                <Eyebrow>How much you want it</Eyebrow>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {TIERS.map((tr) => (
                    <Chip key={tr.value} label={tr.label} selected={tier === tr.value} onPress={() => setTier(tr.value)} />
                  ))}
                </View>
              </Rise>
              <ErrorLine>{error}</ErrorLine>
              <QuietButton label={`${showTrail ? "Hide" : "Show"} how it found this · ${run!.steps.length} steps${run!.cached ? " · saved from earlier today" : ""}`} onPress={() => setShowTrail((v) => !v)} style={{ alignSelf: "flex-start" }} />
              {showTrail ? <Ledger steps={run!.steps} startedAt={run!.createdAt} working={false} /> : null}
              <QuietButton label="Start over" onPress={startOver} style={{ alignSelf: "flex-start" }} />
            </>
          ) : worth ? (
            <>
              <Glass style={{ padding: layout.cardPad, gap: 12 }}>
                {worth.worth === "money" ? <AmountPicker cents={amountCents} namedCents={named} onChange={setAmount} /> : <PricelessPrice line={worth.line} />}
              </Glass>
              <View style={{ gap: 8 }}>
                <Eyebrow>How much you want it</Eyebrow>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {TIERS.map((tr) => (
                    <Chip key={tr.value} label={tr.label} selected={tier === tr.value} onPress={() => setTier(tr.value)} />
                  ))}
                </View>
              </View>
              <ErrorLine>{error}</ErrorLine>
              {/* The reading can be wrong ("a gold bar" is a thing to buy): hunt it as an ordinary wish instead. */}
              <QuietButton label="Price it" onPress={() => void hunt({ text: text.trim() || worth.title, price: true })} style={{ alignSelf: "flex-start" }} />
              <QuietButton label="Start over" onPress={startOver} style={{ alignSelf: "flex-start" }} />
            </>
          ) : result && !result.options.length ? (
            <Glass style={{ padding: layout.cardPad, gap: 12 }}>
              <Text style={[type.callout, { color: p.ink }]}>No price we could stand behind turned up for this one. You can add it with your own price.</Text>
              <PrimaryButton label="Enter it yourself" onPress={() => router.push("/wishes/manual")} />
            </Glass>
          ) : null}
        </View>
      </ScrollView>
      {close}
      {result?.options.length || worth ? (
        <>
          <EdgeFade height={dock} />
          <View pointerEvents="box-none" style={{ position: "absolute", left: gutter, right: gutter, bottom: insets.bottom + 20, alignItems: "center" }}>
            <PrimaryButton label="Add to my list" commit busy={saving} onPress={save} />
          </View>
        </>
      ) : null}
      <Grain />
    </View>
  );
}
