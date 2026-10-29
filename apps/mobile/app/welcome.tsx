import { entry, type Entry } from "@dandelist/catalogue";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Grain, IconButton, PrimaryButton, Wordmark } from "../components/lux";
import { SignInOptions } from "../components/sign-in-options";
import { AgentWork, Appear, type Result } from "../components/welcome/agent-work";
import { Ask } from "../components/welcome/ask";
import { VotePair, WhenStep } from "../components/welcome/choose";
import { Comfort } from "../components/welcome/comfort";
import { CodeSheet, RevealCard } from "../components/welcome/finale";
import { MadeStep } from "../components/welcome/made";
import { AgentTicker, LifePill, Segments } from "../components/welcome/kit";
import { ThemeChooser } from "../components/welcome/theme";
import { TitleSequence } from "../components/welcome/title";
import { useAuth, useSignInOptions, type ProviderId, type SignInOption } from "../lib/auth";
import type { Step as AgentStep } from "../lib/agent";
import { ease, native, spring, useReducedMotion } from "../lib/motion";
import { startIncome } from "../lib/comfort";
import { ANSWERED_ROUNDS, chosen as chosenBy, groupsFor, nextPair, votingDone, type Vote } from "../lib/pairs";
import { recurringBreakdown } from "@dandelist/cost";
import { thoughtOf } from "../lib/reveal";
import { play, preloadSounds } from "../lib/sound";
import { layout, type, usePalette, useTheme } from "../lib/theme";
import { emptyWelcome, fetchPool, listTotal, listed, loadWelcome, markTitleSeen, saveWelcome, seenTitle, streamGuestWish, type FirstWish, type PoolItem, type WelcomeState } from "../lib/welcome";
import { dollars } from "../components/odometer";
import { Atmosphere } from "../components/atmosphere";

/** Apple, Google and GitHub in the save sheet; the kept list is already on this device for after the redirect. */
function WelcomeSocial() {
  const p = usePalette();
  const auth = useAuth();
  const options = useSignInOptions();
  const [pending, setPending] = useState<ProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!options?.length) return null;
  const choose = async (o: SignInOption) => {
    setPending(o.id);
    setError(null);
    try {
      if (o.native) await auth.signInWithApple();
      else await auth.signInWith(o.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setPending(null);
    }
  };
  return (
    <View style={{ gap: 12 }}>
      <SignInOptions options={options} pending={pending} disabled={!!pending} onChoose={choose} />
      {error ? <Text style={[type.footnote, { color: p.danger }]}>{error}</Text> : null}
    </View>
  );
}

type Step = { kind: "title" } | { kind: "ask" } | { kind: "made" } | { kind: "vote"; pair: [PoolItem, PoolItem] } | { kind: "when" } | { kind: "comfort" } | { kind: "agent" } | { kind: "reveal" } | { kind: "theme" };
type Pricing = "idle" | "pricing" | "priced" | "failed";

/** Ask, three answered rounds, when, what it would take, the agent: the segments under the header. */
const SEGMENTS = 2 + ANSWERED_ROUNDS + 2;
const HERO = entry("porsche-911") as Entry;
/** How long the "found it" line stays above the meter once the first wish is priced. */
const FOUND_HOLD_MS = 4200;
/** Step changes are slow crossfades (owner, 2026-10-29: "more cinematic and slower", "smoother and slower"). */
const FADE_OUT_MS = 520;
const FADE_IN_MS = 1100;

/** An idea chip from a pool item: travel reads as a stay ("A week in Dublin"), everything else by its name. */
const ideaOf = (e: PoolItem) => (e.kind === "visit" && !/\b(week|weeks|month|trip|tour|route|safari|cruise|days?|nights?|in)\b/i.test(e.name) ? `A week in ${e.name}` : e.name);

/**
 * The pre-login experience (owner's walkthroughs, 2026-10-28 and 10-29). A slow, centred title that dissolves from a
 * touch, then straight into the first wish, typed, said or tapped; their own card is made in front of them (the agent
 * prices it for real and the photo fades up), then this or that from the pool (the first pair is a cover, later
 * pairs lean toward what they asked for); when they want it all; what it would take, as a fader of incomes with a
 * face for how it would feel; meeting their Dandy while it prices the whole list; the deck. Only then do they save it,
 * which is the sign-up. Back goes one step at a time and undoes that step's picks.
 *
 * Steps crossfade in place, slowly (owner, 10-29: "fade ... rather than a sliding card system"): the old step fades out
 * in 520 ms and the next fades up in 1.1 s. The header, the segments and the list meter stay put.
 */
export default function Welcome() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const auth = useAuth();
  const theme = useTheme();
  const [step, setStep] = useState<Step | null>(null);
  const [short, setShort] = useState(false);
  const [pool, setPool] = useState<PoolItem[]>([]);
  const [state, setState] = useState<WelcomeState>(emptyWelcome);
  const [done, setDone] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [sheet, setSheet] = useState(false);
  const [pricing, setPricing] = useState<Pricing>("idle");
  const [trail, setTrail] = useState<AgentStep[]>([]);
  const [found, setFound] = useState(false);
  const [flight, setFlight] = useState<{ text: string; from: { x: number; y: number }; to: { x: number; y: number } } | null>(null);
  const fly = useRef(new Animated.Value(0)).current;
  const stage = useRef(new Animated.Value(1)).current;
  const shift = useRef(new Animated.Value(0)).current;
  // Behind the save sheet the page settles back a little (UI audit P1-13).
  const behind = useRef(new Animated.Value(1)).current;
  const moving = useRef(false);
  const pill = useRef<View | null>(null);
  const seen = useRef(new Set<string>());
  const rounds = useRef(0);
  const answered = useRef(0);
  const run = useRef<AbortController | null>(null);
  /** Where Back returns to: each step left behind, with the list and the counts as they were on it. */
  const history = useRef<{ step: Step; items: PoolItem[]; answered: number; rounds: number; done: number }[]>([]);
  // Votes land after an animation; they read the list as it is then, not as it was when the pair was drawn.
  const latest = useRef(state);
  latest.current = state;
  // Ideas are drawn once per pool, so typing doesn't reshuffle the chips under a finger.
  const ideas = useMemo(() => [...pool].sort(() => Math.random() - 0.5).slice(0, 4).map(ideaOf), [pool]);

  useEffect(() => {
    void (async () => {
      const [seenBefore, saved, items] = await Promise.all([seenTitle(), loadWelcome(), fetchPool()]);
      setShort(seenBefore);
      setPool(items);
      // A first wish that was still being priced when they left is asked again rather than half-shown.
      if (saved) setState({ ...saved, wish: saved.wish?.option ? saved.wish : null });
      setStep({ kind: "title" });
    })();
    return () => run.current?.abort();
  }, []);

  // Signed in by any route (code, Apple, Google, GitHub): the list adopts what was kept (see useAdoptWelcome).
  useEffect(() => {
    if (auth.status === "signedIn") router.replace("/wishes");
  }, [auth.status]);

  /** Changes the list and keeps it on this device; event handlers arriving later always see the latest list. */
  const patch = (fn: (s: WelcomeState) => WelcomeState) =>
    setState((s) => {
      const next = fn(s);
      void saveWelcome(next);
      return next;
    });
  const patchWish = (fn: (w: FirstWish) => FirstWish) => patch((s) => (s.wish ? { ...s, wish: fn(s.wish) } : s));

  /** Leaves the current step and brings in the next one; `back` mirrors the direction. */
  const go = (next: Step, back = false) => {
    if (moving.current) return;
    moving.current = true;
    if (!back && step && step.kind !== "title" && step.kind !== "theme") history.current.push({ step, items: latest.current.items, answered: answered.current, rounds: rounds.current, done });
    // Every step fades out and the next fades up in place, slowly: no sliding cards.
    const enter = () => {
      setStep(next);
      stage.setValue(0);
      shift.setValue(0);
      Animated.timing(stage, { toValue: 1, duration: reduced ? 160 : FADE_IN_MS, easing: ease.cinema, useNativeDriver: native }).start(() => (moving.current = false));
    };
    Animated.timing(stage, { toValue: 0, duration: reduced ? 100 : FADE_OUT_MS, easing: ease.inOut, useNativeDriver: native }).start(enter);
  };

  /** The chosen price flies along a short arc into the list meter, then the meter rolls up. */
  const launch = (es: PoolItem[], from: View | null, then: () => void) => {
    const commit = () => {
      patch((s) => ({ ...s, items: [...s.items, ...es.filter((e) => !s.items.some((x) => x.id === e.id))] }));
      then();
    };
    if (reduced || !es.length || !from || !pill.current) return commit();
    from.measureInWindow((x, y, w, h) =>
      pill.current?.measureInWindow((px, py, pw, ph) => {
        const total = es.reduce((n, e) => n + e.upfrontCents, 0);
        setFlight({ text: `+${dollars(total)}`, from: { x: x + w / 2 - 50, y: y + h / 2 }, to: { x: px + pw - 110, y: py + ph / 2 - 14 } });
        fly.setValue(0);
        Animated.timing(fly, { toValue: 1, duration: 500, easing: ease.inOut, useNativeDriver: native }).start(() => {
          setFlight(null);
          commit();
        });
      }),
    );
  };

  /** Starts the agent on the first wish; it keeps working while this or that goes on. */
  const priceWish = (text: string) => {
    run.current?.abort();
    const ctrl = new AbortController();
    run.current = ctrl;
    setTrail([]);
    setFound(false);
    setPricing("pricing");
    patch((s) => ({ ...s, wish: { text } }));
    streamGuestWish(
      text,
      (e) => {
        if (ctrl.signal.aborted) return;
        if (e.type === "draft") patchWish((w) => ({ ...w, title: e.title, kind: e.kind }));
        else if (e.type === "step") setTrail((t) => [...t, e.step]);
        else if (e.type === "priced") {
          const { label, seller, url, upfrontCents, recurring, status, statusLabel, checkedAt, imageUrl, media, source } = e.option;
          // The fast card lands first; a better one from the full research replaces it quietly, with no second "found".
          const first = !latest.current.wish?.option;
          patchWish((w) => ({ ...w, title: e.title, kind: e.kind, option: { label, seller, url, upfrontCents, recurring, status, statusLabel, checkedAt, imageUrl, media, source } }));
          setPricing("priced");
          if (first) {
            setFound(true);
            setTimeout(() => setFound(false), FOUND_HOLD_MS);
          }
        } else if (e.type === "error") {
          patchWish((w) => ({ ...w, failed: e.message }));
          setPricing("failed");
        }
      },
      ctrl.signal,
    ).catch((err: Error) => {
      if (ctrl.signal.aborted) return;
      patchWish((w) => ({ ...w, failed: err instanceof TypeError ? "Couldn't reach Dandelist just now." : err.message }));
      setPricing("failed");
    });
  };

  /** The next pair: a cover first, then pairs leaning toward what the first wish turned out to be. */
  const nextVote = (s: WelcomeState): Step | null => {
    const pair = nextPair(pool, seen.current, rounds.current === 0 ? null : groupsFor(s.wish?.kind));
    if (!pair) return null;
    pair.forEach((e) => seen.current.add(e.id));
    return { kind: "vote", pair };
  };

  const startVoting = (text: string) => {
    priceWish(text);
    seen.current = new Set();
    rounds.current = 0;
    answered.current = 0;
    patch((s) => ({ ...s, items: [] }));
    setDone(1);
    go({ kind: "made" });
  };

  const vote = (pair: [PoolItem, PoolItem], picked: PoolItem[], from: View | null) => {
    const v: Vote = picked.length === 2 ? "both" : picked.length === 0 ? "neither" : picked[0]!.id === pair[0].id ? "a" : "b";
    launch(chosenBy(pair, v), from, () => {
      rounds.current++;
      if (v !== "neither") answered.current++;
      setDone(1 + Math.min(answered.current, ANSWERED_ROUNDS));
      const left = pool.filter((e) => !seen.current.has(e.id)).length;
      const next = votingDone(answered.current, rounds.current, left) ? null : nextVote(latest.current);
      go(next ?? { kind: "when" });
    });
  };

  /** One step back, undoing what that step added to the list. */
  const goBack = () => {
    const prev = history.current.pop();
    if (!prev || moving.current) return;
    answered.current = prev.answered;
    rounds.current = prev.rounds;
    setDone(prev.done);
    patch((s) => ({ ...s, items: prev.items }));
    if (prev.step.kind === "ask") run.current?.abort();
    go(prev.step, true);
  };

  /** Clears the list and goes back to the first wish, with what they asked for still in the field. */
  const restart = () => {
    history.current = [];
    run.current?.abort();
    setPricing("idle");
    setResult(null);
    setDone(0);
    patch((s) => ({ ...s, items: [], when: null, kept: false }));
    go({ kind: "ask" }, true);
  };

  useEffect(() => {
    Animated.spring(behind, { toValue: sheet && !reduced ? 0.96 : 1, ...spring.settle, useNativeDriver: native }).start();
  }, [sheet, reduced, behind]);

  // Air opens as the finished list is revealed; it loads while the agent works on the list.
  useEffect(() => {
    if (step?.kind === "agent") preloadSounds("swell");
    if (step?.kind === "reveal") play("swell");
  }, [step?.kind]);

  if (!step) return <View style={{ flex: 1, backgroundColor: p.bg }} />;

  const total = listTotal(state);
  // The fader step carries its own total in the faces, and needs the room the meter would take on a phone.
  const metered = step.kind === "vote" || step.kind === "when" || step.kind === "agent";
  const canGoBack = history.current.length > 0 && step.kind !== "title" && step.kind !== "theme";
  const segmented = metered || step.kind === "ask" || step.kind === "made" || step.kind === "comfort";
  const framed = step.kind !== "title" && step.kind !== "theme";
  const gutter = layout.gutter(width);
  const headerColumn = width >= 760 && step.kind === "vote" ? 932 : layout.column;
  const wishTitle = state.wish?.title ?? state.wish?.text ?? "";
  const thought = thoughtOf(trail);
  // The line above the meter: what the agent is doing with the first wish, then a moment of "found it".
  const ticker =
    step.kind === "vote" && state.wish
      ? pricing === "pricing"
        ? { text: thought?.text ?? `Finding the real price of ${wishTitle}`, done: false }
        : found && state.wish.option
          ? { text: `${wishTitle}: ${dollars(state.wish.option.upfrontCents)}, on your list`, done: true }
          : null
      : null;
  const pillSpace = layout.control.meter + 32 + (ticker ? 44 : 0);

  let body: React.ReactNode;
  switch (step.kind) {
    case "title":
      body = <TitleSequence hero={HERO} short={short} onDone={() => { void markTitleSeen(); go({ kind: "ask" }); }} />;
      break;
    case "ask":
      body = <Ask ideas={ideas} initial={state.wish?.text ?? ""} bottomInset={insets.bottom} onSubmit={startVoting} />;
      break;
    case "made":
      body = state.wish ? <MadeStep wish={state.wish} pricing={pricing} line={thought?.text ?? ""} onContinue={() => go(nextVote(latest.current) ?? { kind: "when" })} /> : null;
      break;
    case "vote": {
      const [a, b] = step.pair;
      const label = `This or that · ${Math.min(answered.current + 1, ANSWERED_ROUNDS)} of ${ANSWERED_ROUNDS}`;
      body = <VotePair key={`${a.id}|${b.id}`} a={a} b={b} label={label} onVote={(picked, from) => vote(step.pair, picked, from)} />;
      break;
    }
    case "when":
      body = <WhenStep value={state.when} onPick={(when) => { patch((s) => ({ ...s, when })); setDone(2 + ANSWERED_ROUNDS); setTimeout(() => go({ kind: "comfort" }), 220); }} />;
      break;
    case "comfort":
      body = <Comfort incomeCents={state.incomeCents ?? startIncome(total)} totalCents={Math.max(total, 1)} keepPerYearCents={recurringBreakdown(listed(state)).perYear} onChange={(c) => patch((s) => ({ ...s, incomeCents: c }))} onDone={() => { setDone(3 + ANSWERED_ROUNDS); go({ kind: "agent" }); }} />;
      break;
    case "agent":
      body = (
        <View style={{ flex: 1 }}>
          <AgentWork
            state={state}
            ready={pricing !== "pricing"}
            waiting={pricing === "pricing" ? { title: wishTitle, line: thought?.mine ? thought.text : "" } : null}
            onResult={(r) => { setResult(r); setDone(SEGMENTS); }}
            onRestart={restart}
          />
          <Appear when={!!result}>
            <View style={{ paddingHorizontal: gutter, paddingBottom: 16 }}>
              <PrimaryButton label="See my Dandelist" onPress={() => go({ kind: "reveal" })} />
            </View>
          </Appear>
        </View>
      );
      break;
    case "theme":
      body = result ? <ThemeChooser totalCents={result.upfrontCents} onDone={(id) => { theme.set(id); setSheet(true); }} /> : null;
      break;
    case "reveal":
      body = result ? (
        <RevealCard
          picks={listed(state)}
          upfrontCents={result.upfrontCents}
          monthlyRunningCents={result.monthlyRunningCents}
          onKeep={() => { patch((s) => ({ ...s, kept: true })); go({ kind: "theme" }); }}
          onRestart={restart}
        />
      ) : null;
      break;
  }

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <Atmosphere />
      <Animated.View style={{ flex: 1, opacity: stage, borderRadius: sheet ? 24 : 0, overflow: sheet ? "hidden" : "visible", transform: [{ translateX: shift }, { scale: behind }], paddingTop: framed ? insets.top + layout.contentTop : 0, paddingBottom: metered ? insets.bottom + pillSpace : step.kind === "made" ? insets.bottom + layout.stack.base : 0 }}>
        {body}
      </Animated.View>

      {framed ? (
        // A 44 pt header bar from the top inset, then the segments at +50, both on the content column (UI audit P0-3).
        <View pointerEvents="box-none" style={{ position: "absolute", top: insets.top, left: 0, right: 0, alignItems: "center", paddingHorizontal: gutter }}>
          <View pointerEvents="box-none" style={{ width: "100%", maxWidth: headerColumn }}>
            <View pointerEvents="box-none" style={{ height: layout.headerBar, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View pointerEvents="box-none" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                {canGoBack ? <IconButton icon="back" label="Back" onPress={goBack} /> : null}
                <Wordmark />
              </View>
              <Pressable accessibilityRole="link" onPress={() => router.push("/sign-in")} style={{ minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "flex-end" }}>
                <Text style={[type.label, { color: p.ink2 }]}>Log in</Text>
              </Pressable>
            </View>
            {segmented ? <Segments count={SEGMENTS} done={done} style={{ marginTop: layout.segmentsTop - layout.headerBar }} /> : null}
          </View>
        </View>
      ) : null}

      {metered ? (
        <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: insets.bottom + layout.dockGap, alignItems: "center", paddingHorizontal: gutter, gap: 8 }}>
          {ticker ? <AgentTicker text={ticker.text} done={ticker.done} style={{ width: "100%", maxWidth: layout.list }} /> : null}
          <LifePill cents={total} onLayoutRef={(v) => (pill.current = v)} style={{ width: "100%", maxWidth: layout.list }} />
        </View>
      ) : null}

      {flight ? (
        <Animated.Text
          pointerEvents="none"
          style={[
            type.cardPrice,
            {
              position: "absolute",
              left: 0,
              top: 0,
              color: p.accentText,
              transform: [
                { translateX: fly.interpolate({ inputRange: [0, 1], outputRange: [flight.from.x, flight.to.x] }) },
                { translateY: Animated.add(fly.interpolate({ inputRange: [0, 1], outputRange: [flight.from.y, flight.to.y] }), fly.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -70, 0] })) },
                { scale: fly.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.8, 1.1, 0.85] }) },
              ],
              opacity: fly.interpolate({ inputRange: [0, 0.1, 0.9, 1], outputRange: [0, 1, 1, 0] }),
            },
          ]}
        >
          {flight.text}
        </Animated.Text>
      ) : null}

      {sheet ? <CodeSheet startEmail={auth.startEmail} verifyEmail={auth.verifyEmail} onClose={() => setSheet(false)} extra={<WelcomeSocial />} /> : null}
      <Grain />
    </View>
  );
}
