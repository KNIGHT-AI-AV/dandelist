import { entry, type Entry } from "@dandelist/catalogue";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, BackHandler, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Grain, IconButton, PrimaryButton, Wordmark } from "../components/lux";
import { SignInOptions } from "../components/sign-in-options";
import { SoundButton } from "../components/sound-button";
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
import { faderIncome } from "../lib/comfort";
import { ANSWERED_ROUNDS, chosen as chosenBy, groupsFor, pickPair, unseenCount, usablePairs, votingDone, type Vote, type WishPair } from "../lib/pairs";
import { recurringBreakdown } from "@dandelist/cost";
import { thoughtOf } from "../lib/reveal";
import { play, preloadSounds } from "../lib/sound";
import { layout, type, usePalette, useTheme } from "../lib/theme";
import { cataloguePool, emptyWelcome, fetchPool, keepsHunt, listTotal, listed, loadWelcome, markTitleSeen, saveWelcome, seenTitle, settled, streamGuestWish, type FirstWish, type PoolItem, type WelcomeState } from "../lib/welcome";
import { startWelcome } from "../lib/welcome-start";
import { welcomeSteps, type Fade } from "../lib/welcome-steps";
import { guessCandidates, guessOthers } from "../lib/guess";
import { useMoney } from "../lib/currency";
import { amountSteps, startAmount } from "../lib/worth";
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
/** What Back puts back on a step: the list, the pairs shown and the counts as they were on it, before its own choice. */
type Snap = { items: PoolItem[]; seen: Set<string>; answered: number; rounds: number; done: number };

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
 * prices it for real and the photo fades up), then this or that made from what they asked for (owner, 2026-10-30; the
 * server makes the pairs while it prices the wish), with the pool as the fallback (a cover pair, then pairs leaning
 * toward what they asked for); when they want it all; what it would take, as a fader of incomes with a
 * face for how it would feel; meeting their Dandy while it prices the whole list; the deck. Only then do they save it,
 * which is the sign-up. Back goes one step at a time and undoes that step's picks.
 *
 * Steps crossfade in place, slowly (owner, 10-29: "fade ... rather than a sliding card system"): the old step fades out
 * in 520 ms and the next fades up in 1.1 s. The header, the segments and the list meter stay put. A tap during a fade
 * is never dropped (lib/welcome-steps.ts): going back "needs to work every single time" (owner, 10-30).
 */
export default function Welcome() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const auth = useAuth();
  const theme = useTheme();
  const money = useMoney();
  const [step, setStep] = useState<Step | null>(null);
  const [short, setShort] = useState(false);
  const [pool, setPool] = useState<PoolItem[]>(cataloguePool);
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
  // The page's textured background and its header, faded in with the first step after the title, so neither cuts in
  // over the title's flat dissolve (UI audit, 2026-10-30). `fromTitle` is set as the title hands over.
  const chrome = useRef(new Animated.Value(1)).current;
  const fromTitle = useRef(false);
  const shift = useRef(new Animated.Value(0)).current;
  // Behind the save sheet the page settles back a little (UI audit P1-13).
  const behind = useRef(new Animated.Value(1)).current;
  const pill = useRef<View | null>(null);
  const seen = useRef(new Set<string>());
  const rounds = useRef(0);
  const answered = useRef(0);
  /** This or that made from the first wish, as the server sends it beside the price; empty until then, or if it fails. */
  const made = useRef<WishPair[]>([]);
  const run = useRef<AbortController | null>(null);
  /** They moved on from the card while this hunt ran: back on it, "Keep going" is there at once. */
  const continued = useRef(false);
  const calm = useRef(reduced);
  calm.current = reduced;
  // Votes land after an animation; they read the list as it is then, not as it was when the pair was drawn.
  const latest = useRef(state);
  latest.current = state;
  const filled = useRef(done);
  filled.current = done;
  /**
   * Which step they are on, Back's history, and the crossfade between steps (lib/welcome-steps.ts). What Back puts
   * back on a step is the list, the pairs shown and the counts as they are when an action on it starts.
   */
  const [steps] = useState(() => {
    const fade: Fade = (to, done) => {
      // The title has already dissolved to the bare page: nothing is left to fade out, so no dark pause.
      if (!to && fromTitle.current) {
        stage.setValue(0);
        done();
        return;
      }
      const duration = to ? (calm.current ? 160 : FADE_IN_MS) : calm.current ? 100 : FADE_OUT_MS;
      if (to && fromTitle.current) {
        fromTitle.current = false;
        Animated.timing(chrome, { toValue: 1, duration, easing: ease.cinema, useNativeDriver: native }).start();
      }
      Animated.timing(stage, { toValue: to, duration, easing: to ? ease.cinema : ease.inOut, useNativeDriver: native }).start(({ finished }) => finished && done());
    };
    return welcomeSteps<Step, Snap>({
      fade,
      // The stage is dark here (the old step has faded out), or still lit for the first step, which shows at once.
      show: (s) => {
        setStep(s);
        shift.setValue(0);
      },
      capture: () => ({ items: latest.current.items, seen: new Set(seen.current), answered: answered.current, rounds: rounds.current, done: filled.current }),
      keepsHistory: (s) => s.kind !== "title" && s.kind !== "theme",
    });
  });
  // Ideas are drawn once per pool, so typing doesn't reshuffle the chips under a finger: two things and two places,
  // since the pool is mostly places and four trips in a row read as a travel app (UI audit, 2026-10-30).
  const ideas = useMemo(() => {
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const places = shuffled.filter((e) => e.kind === "visit");
    const things = shuffled.filter((e) => e.kind !== "visit");
    const two = (a: PoolItem[], b: PoolItem[]) => [...a.slice(0, 2), ...b].slice(0, 4);
    return (things.length >= 2 ? [things[0]!, places[0], things[1]!, places[1]].filter((e): e is PoolItem => !!e).concat(two(things.slice(2), places.slice(2))).slice(0, 4) : two(places, things)).map(ideaOf);
  }, [pool]);

  useEffect(() => {
    const stop = startWelcome({
      seenTitle,
      loadWelcome,
      fetchPool,
      onLocal: (seenBefore, saved) => {
        setShort(seenBefore);
        // A first wish that was still being priced when they left is asked again rather than half-shown; one that
        // landed (priced, money with its amount, or priceless) stays.
        if (saved) setState({ ...saved, wish: settled(saved.wish) ? saved.wish : null });
        steps.start({ kind: "title" });
      },
      onPool: setPool,
    });
    return () => {
      stop();
      run.current?.abort();
    };
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

  /**
   * The chosen price flies along a short arc into the list meter, then the meter rolls up. If they went Back while it
   * flew (`still` is false), the vote never happened: nothing is added.
   */
  const launch = (es: PoolItem[], from: View | null, still: () => boolean, then: () => void) => {
    const commit = () => {
      if (!still()) return;
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

  /**
   * Starts the agent on the first wish; it keeps working while this or that goes on. `price` is the money or priceless
   * card's "Price it": the words are hunted as an ordinary priced wish. The same stream brings this or that made from
   * the wish (owner, 2026-10-30), asked for again only when it hasn't come yet.
   */
  const priceWish = (text: string, price = false) => {
    run.current?.abort();
    const ctrl = new AbortController();
    run.current = ctrl;
    continued.current = false;
    setTrail([]);
    setFound(false);
    setPricing("pricing");
    patch((s) => ({ ...s, wish: { text } }));
    // Money or something priceless (owner, 2026-10-30): once its card has come, the error the server sends after it
    // for older apps, and a stream that drops later, are not failures.
    let worthy = false;
    streamGuestWish(
      text,
      (e) => {
        if (ctrl.signal.aborted) return;
        // A draft can come twice (again when its questions land); a guess they already confirmed stays confirmed.
        if (e.type === "draft") patchWish((w) => ({ ...w, title: e.title, kind: e.kind, ...(w.guess === null ? {} : { guess: guessOthers(e.draft) ?? undefined, pick: guessCandidates(e.draft) ?? undefined }) }));
        else if (e.type === "step") setTrail((t) => [...t, e.step]);
        else if (e.type === "worth") {
          worthy = true;
          if (e.worth === "money") {
            // The slider starts at what the wish named, else a million of the shown currency.
            const amountCents = startAmount(amountSteps(money.rate, money.unit, e.amountCents), e.amountCents);
            patchWish((w) => ({ ...w, title: e.title, kind: e.kind, worth: "money", amountCents, ...(e.amountCents ? { namedCents: e.amountCents } : {}), failed: undefined }));
          } else patchWish((w) => ({ ...w, title: e.title, kind: e.kind, worth: "priceless", line: e.line, failed: undefined }));
          setPricing("priced");
        } else if (e.type === "photo") patchWish((w) => ({ ...w, photo: { imageUrl: e.imageUrl, ...(e.media ? { media: e.media } : {}) } }));
        else if (e.type === "pairs") {
          // The next pair drawn comes from these; a pair already on screen stays.
          const pairs = usablePairs(e.pairs);
          if (pairs.length) made.current = pairs;
        } else if (e.type === "priced") {
          const { label, seller, url, upfrontCents, recurring, status, statusLabel, checkedAt, imageUrl, media, source } = e.option;
          // The fast card lands first; a better one from the full research replaces it quietly, with no second "found".
          const first = !latest.current.wish?.option;
          patchWish((w) => ({ ...w, title: e.title, kind: e.kind, option: { label, seller, url, upfrontCents, recurring, status, statusLabel, checkedAt, imageUrl, media, source } }));
          setPricing("priced");
          if (first) {
            setFound(true);
            // Only this hunt's own "found" ends: a later hunt's line is not cut short by this timer.
            setTimeout(() => run.current === ctrl && setFound(false), FOUND_HOLD_MS);
          }
        } else if (e.type === "error" && !worthy) {
          patchWish((w) => ({ ...w, failed: e.message }));
          setPricing("failed");
        }
      },
      ctrl.signal,
      price,
      !made.current.length,
    ).catch((err: Error) => {
      if (ctrl.signal.aborted || worthy) return;
      patchWish((w) => ({ ...w, failed: err instanceof TypeError ? "Couldn't reach Dandelist just now." : err.message }));
      setPricing("failed");
    });
  };

  /**
   * The next pair: one made from the first wish while there is one, "Neither" included. Before they arrive or once they
   * are used up, the pool's: a cover first, then pairs leaning toward what the first wish turned out to be.
   */
  const nextVote = (s: WelcomeState): Step | null => {
    const pair = pickPair(made.current, pool, seen.current, rounds.current === 0 ? null : groupsFor(s.wish?.kind));
    if (!pair) return null;
    pair.forEach((e) => seen.current.add(e.id));
    return { kind: "vote", pair };
  };

  /**
   * The first wish is sent from the `from` step. The same words as the wish already on the card keep its card, or the
   * hunt still finding it (lib/welcome.ts keepsHunt), and the pairs made from it; anything else is hunted afresh, and a
   * new wish brings its own pairs: the last wish's never stand in for them.
   */
  const startVoting = (from: Step, text: string) => {
    const leave = steps.leave(from);
    if (!leave) return;
    const hunting = pricing === "pricing" && !!run.current && !run.current.signal.aborted;
    if (!keepsHunt(latest.current.wish, text, hunting)) {
      made.current = [];
      priceWish(text);
    }
    seen.current = new Set();
    rounds.current = 0;
    answered.current = 0;
    patch((s) => ({ ...s, items: [] }));
    setDone(1);
    leave.to({ kind: "made" });
  };

  /** A vote on the `at` pair; if they went Back before its price landed in the meter, it never happened. */
  const vote = (at: Step, pair: [PoolItem, PoolItem], picked: PoolItem[], from: View | null) => {
    const leave = steps.leave(at);
    if (!leave) return;
    const v: Vote = picked.length === 2 ? "both" : picked.length === 0 ? "neither" : picked[0]!.id === pair[0].id ? "a" : "b";
    launch(chosenBy(pair, v), from, leave.still, () => {
      rounds.current++;
      if (v !== "neither") answered.current++;
      setDone(1 + Math.min(answered.current, ANSWERED_ROUNDS));
      const left = unseenCount(made.current, pool, seen.current);
      const next = votingDone(answered.current, rounds.current, left) ? null : nextVote(latest.current);
      leave.to(next ?? { kind: "when" });
    });
  };

  /**
   * One step back, putting back the list, the pairs shown and the counts as they were on that step. The first wish's
   * hunt keeps going: sending the same words again picks it up rather than starting over.
   */
  const goBack = () => {
    const leaving = steps.at;
    const prev = steps.back();
    if (!prev) return;
    answered.current = prev.snap.answered;
    rounds.current = prev.snap.rounds;
    seen.current = new Set(prev.snap.seen);
    setDone(prev.snap.done);
    patch((s) => ({ ...s, items: prev.snap.items }));
    // The list is summed again when they come forward; a sum from before could be for other picks.
    if (leaving?.kind === "agent") setResult(null);
  };
  // Android's back gesture steps back through the welcome like the Back button; with nowhere to go it leaves as usual.
  const back = useRef(goBack);
  back.current = goBack;
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!steps.canGoBack()) return false;
      back.current();
      return true;
    });
    return () => sub.remove();
  }, [steps]);

  /** Clears the list and goes back to the first wish, with what they asked for still in the field. */
  const restart = (from: Step) => {
    if (!steps.is(from)) return;
    run.current?.abort();
    setPricing("idle");
    setResult(null);
    setDone(0);
    patch((s) => ({ ...s, items: [], when: null, kept: false }));
    steps.reset(from, { kind: "ask" });
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
  const items = listed(state);
  const keepPerYear = recurringBreakdown(items).perYear;
  // The fader step carries its own total in the faces, and needs the room the meter would take on a phone.
  const metered = step.kind === "vote" || step.kind === "when" || step.kind === "agent";
  const canGoBack = steps.canGoBack() && step.kind !== "title" && step.kind !== "theme";
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

  // Every action below names the step it belongs to (`here`): one from a step they have already left does nothing.
  const here: Step = step;
  let body: React.ReactNode;
  switch (step.kind) {
    case "title":
      body = (
        <TitleSequence
          hero={HERO}
          short={short}
          onDone={() => {
            void markTitleSeen();
            chrome.setValue(0);
            fromTitle.current = true;
            steps.leave(here)?.to({ kind: "ask" });
          }}
        />
      );
      break;
    case "ask":
      body = <Ask ideas={ideas} initial={state.wish?.text ?? ""} bottomInset={insets.bottom} onSubmit={(text) => startVoting(here, text)} />;
      break;
    case "made":
      body = state.wish ? (
        <MadeStep
          wish={state.wish}
          pricing={pricing}
          waited={continued.current}
          line={thought?.text ?? ""}
          onAmount={(amountCents) => patchWish((w) => ({ ...w, amountCents }))}
          onPrice={() => steps.is(here) && state.wish && priceWish(state.wish.text, true)}
          onContinue={() => {
            const leave = steps.leave(here);
            if (!leave) return;
            continued.current = true;
            leave.to(nextVote(latest.current) ?? { kind: "when" });
          }}
          onGuessConfirm={() => patchWish((w) => ({ ...w, guess: null, pick: null }))}
          onGuessPick={(name) => steps.is(here) && priceWish(name)}
          onGuessElse={() => steps.is(here) && goBack()}
        />
      ) : null;
      break;
    case "vote": {
      const [a, b] = step.pair;
      const label = `This or that · ${Math.min(answered.current + 1, ANSWERED_ROUNDS)} of ${ANSWERED_ROUNDS}`;
      body = <VotePair key={`${a.id}|${b.id}`} a={a} b={b} label={label} onVote={(picked, from) => vote(here, step.pair, picked, from)} />;
      break;
    }
    case "when":
      body = (
        <WhenStep
          value={state.when}
          onPick={(when) => {
            const leave = steps.leave(here);
            if (!leave) return;
            patch((s) => ({ ...s, when }));
            setDone(2 + ANSWERED_ROUNDS);
            setTimeout(() => leave.to({ kind: "comfort" }), 220);
          }}
        />
      );
      break;
    case "comfort":
      body = (
        <Comfort
          incomeCents={faderIncome({ totalCents: total, keepPerYearCents: keepPerYear, selectedIncomeCents: state.incomeCents, hasPricedItems: items.some((e) => e.worth !== "priceless") })}
          totalCents={Math.max(total, 1)}
          keepPerYearCents={keepPerYear}
          note={state.wish?.worth === "priceless" ? `${wishTitle} is priceless, so it isn't in the total.` : undefined}
          onChange={(c) => patch((s) => ({ ...s, incomeCents: c }))}
          onDone={() => {
            const leave = steps.leave(here);
            if (!leave) return;
            setDone(3 + ANSWERED_ROUNDS);
            leave.to({ kind: "agent" });
          }}
        />
      );
      break;
    case "agent":
      body = (
        <View style={{ flex: 1 }}>
          <AgentWork
            state={state}
            ready={pricing !== "pricing"}
            waiting={pricing === "pricing" ? { title: wishTitle, line: thought?.mine ? thought.text : "" } : null}
            onResult={(r) => {
              if (!steps.is(here)) return;
              setResult(r);
              setDone(SEGMENTS);
            }}
            onRestart={() => restart(here)}
          />
          <Appear when={!!result}>
            <View style={{ paddingHorizontal: gutter, paddingBottom: 16 }}>
              <PrimaryButton label="See my Dandelist" onPress={() => steps.leave(here)?.to({ kind: "reveal" })} />
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
          onKeep={() => {
            const leave = steps.leave(here);
            if (!leave) return;
            patch((s) => ({ ...s, kept: true }));
            leave.to({ kind: "theme" });
          }}
          onRestart={() => restart(here)}
        />
      ) : null;
      break;
  }

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: chrome }]}>
        <Atmosphere />
      </Animated.View>
      <Animated.View style={{ flex: 1, opacity: stage, borderRadius: sheet ? 24 : 0, overflow: sheet ? "hidden" : "visible", transform: [{ translateX: shift }, { scale: behind }], paddingTop: framed ? insets.top + layout.contentTop : 0, paddingBottom: metered ? insets.bottom + pillSpace : step.kind === "made" ? insets.bottom + layout.stack.base : 0 }}>
        {body}
      </Animated.View>

      {framed ? (
        // A 44 pt header bar from the top inset, then the segments at +50, both on the content column (UI audit P0-3).
        <Animated.View pointerEvents="box-none" style={{ position: "absolute", top: insets.top, left: 0, right: 0, alignItems: "center", paddingHorizontal: gutter, opacity: chrome }}>
          <View pointerEvents="box-none" style={{ width: "100%", maxWidth: headerColumn }}>
            <View pointerEvents="box-none" style={{ height: layout.headerBar, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View pointerEvents="box-none" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                {canGoBack ? <IconButton icon="back" label="Back" onPress={goBack} /> : null}
                <Wordmark />
              </View>
              <View pointerEvents="box-none" style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                {/* Sound on and off where the music plays (owner, 2026-10-30). */}
                <SoundButton />
                <Pressable accessibilityRole="link" onPress={() => router.push("/sign-in")} style={{ minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "flex-end" }}>
                  <Text style={[type.label, { color: p.ink2 }]}>Log in</Text>
                </Pressable>
              </View>
            </View>
            {segmented ? <Segments count={SEGMENTS} done={done} style={{ marginTop: layout.segmentsTop - layout.headerBar }} /> : null}
          </View>
        </Animated.View>
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
