import { entry, firstPick, pairs, type Entry } from "@dandelist/catalogue";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Grain, PrimaryButton, Wordmark } from "../components/lux";
import { SignInOptions } from "../components/sign-in-options";
import { AgentWork, Appear, type Result } from "../components/welcome/agent-work";
import { Aside, FirstPick, Horizon, VotePair } from "../components/welcome/choose";
import { CodeSheet, RevealCard } from "../components/welcome/finale";
import { LifePill, Segments } from "../components/welcome/kit";
import { ThemeChooser } from "../components/welcome/theme";
import { TitleSequence } from "../components/welcome/title";
import { useAuth, useSignInOptions, type ProviderId, type SignInOption } from "../lib/auth";
import { ease, native, spring, step as stepMotion, useReducedMotion } from "../lib/motion";
import { layout, type, usePalette, useTheme } from "../lib/theme";
import { loadWelcome, markTitleSeen, monthYearLong, picked, saveWelcome, seenTitle, type WelcomeState } from "../lib/welcome";
import { Atmosphere } from "../components/atmosphere";

/** Apple, Google and GitHub in the save sheet; the kept picks are already on this device for after the redirect. */
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

type Step = { kind: "title" } | { kind: "first" } | { kind: "vote"; round: number } | { kind: "horizon" } | { kind: "aside" } | { kind: "agent" } | { kind: "reveal" } | { kind: "theme" };

const SEGMENTS = 7;
const firstEntries = firstPick.map(entry).filter((e): e is Entry => !!e);
const pairEntries = pairs.map(([a, b]) => [entry(a), entry(b)]).filter((pr): pr is [Entry, Entry] => !!pr[0] && !!pr[1]);

/**
 * The pre-login experience (onboarding research, 2026-10-27): a short title sequence, then the person builds the
 * life they want from real, sourced prices, watches the agent price it, sees the date, and only then saves it.
 * Everything chosen here becomes wishes on the new account.
 *
 * Steps fly instead of teleporting (UI audit P1-16): the old step leaves left in 150 ms, the new one arrives from
 * the right in 320 ms, and going back mirrors it. The header, the progress segments and the Life pill stay put.
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
  const [state, setState] = useState<WelcomeState>({ picks: [], horizonYears: null, monthlyCents: 100_000 });
  const [answered, setAnswered] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [sheet, setSheet] = useState(false);
  const [flight, setFlight] = useState<{ text: string; from: { x: number; y: number }; to: { x: number; y: number } } | null>(null);
  const fly = useRef(new Animated.Value(0)).current;
  const stage = useRef(new Animated.Value(1)).current;
  const shift = useRef(new Animated.Value(0)).current;
  // Behind the save sheet the page settles back a little (UI audit P1-13).
  const behind = useRef(new Animated.Value(1)).current;
  const moving = useRef(false);
  const pill = useRef<View | null>(null);

  useEffect(() => {
    void (async () => {
      const [seen, saved] = await Promise.all([seenTitle(), loadWelcome()]);
      setShort(seen);
      if (saved?.picks.length) setState(saved);
      setStep({ kind: "title" });
    })();
  }, []);

  // Signed in by any route (code, Apple, Google, GitHub): the life list adopts the kept picks (see useAdoptWelcome).
  useEffect(() => {
    if (auth.status === "signedIn") router.replace("/wishes");
  }, [auth.status]);

  const update = (next: WelcomeState) => {
    setState(next);
    void saveWelcome(next);
  };

  /** Leaves the current step and brings in the next one; `back` mirrors the direction. */
  const go = (next: Step, back = false) => {
    if (moving.current) return;
    moving.current = true;
    const d = back ? -1 : 1;
    const enter = () => {
      setStep(next);
      stage.setValue(0);
      shift.setValue(reduced ? 0 : stepMotion.inX * d);
      Animated.parallel([
        Animated.timing(stage, { toValue: 1, duration: reduced ? 160 : stepMotion.inMs, easing: ease.out, useNativeDriver: native }),
        Animated.timing(shift, { toValue: 0, duration: reduced ? 0 : stepMotion.inMs, easing: ease.out, useNativeDriver: native }),
      ]).start(() => (moving.current = false));
    };
    Animated.parallel([
      Animated.timing(stage, { toValue: 0, duration: reduced ? 100 : stepMotion.outMs, easing: ease.out, useNativeDriver: native }),
      Animated.timing(shift, { toValue: reduced ? 0 : stepMotion.outX * d, duration: reduced ? 0 : stepMotion.outMs, easing: ease.out, useNativeDriver: native }),
    ]).start(enter);
  };

  /** The chosen price flies along a short arc into the Life meter, then the meter rolls up. */
  const launch = (es: Entry[], from: View | null, then: () => void) => {
    const commit = () => {
      update({ ...state, picks: [...new Set([...state.picks, ...es.map((e) => e.id)])] });
      then();
    };
    if (reduced || !es.length || !from || !pill.current) return commit();
    from.measureInWindow((x, y, w, h) =>
      pill.current?.measureInWindow((px, py, pw, ph) => {
        const total = es.reduce((s, e) => s + e.upfrontCents, 0);
        setFlight({ text: `+$${Math.round(total / 100).toLocaleString("en-US")}`, from: { x: x + w / 2 - 50, y: y + h / 2 }, to: { x: px + pw - 110, y: py + ph / 2 - 14 } });
        fly.setValue(0);
        Animated.timing(fly, { toValue: 1, duration: 500, easing: ease.inOut, useNativeDriver: native }).start(() => {
          setFlight(null);
          commit();
        });
      }),
    );
  };

  useEffect(() => {
    Animated.spring(behind, { toValue: sheet && !reduced ? 0.96 : 1, ...spring.settle, useNativeDriver: native }).start();
  }, [sheet, reduced, behind]);

  if (!step) return <View style={{ flex: 1, backgroundColor: p.bg }} />;

  const total = picked(state).reduce((s, e) => s + e.upfrontCents, 0);
  const building = step.kind === "first" || step.kind === "vote" || step.kind === "horizon" || step.kind === "aside" || step.kind === "agent";
  const framed = step.kind !== "title" && step.kind !== "theme";
  const gutter = layout.gutter(width);
  // The header and segments sit on the step's own column: three cards across on wide screens, else 560.
  const headerColumn = width >= 760 && (step.kind === "first" || step.kind === "vote") ? 932 : layout.column;
  const pillSpace = layout.control.meter + 32;

  let body: React.ReactNode;
  switch (step.kind) {
    case "title":
      body = <TitleSequence hero={firstEntries[0]!} short={short} onDone={() => { void markTitleSeen(); go({ kind: "first" }); }} />;
      break;
    case "first":
      body = <FirstPick entries={firstEntries} onPick={(e, from) => launch([e], from, () => { setAnswered(1); go({ kind: "vote", round: 0 }); })} />;
      break;
    case "vote": {
      const [a, b] = pairEntries[step.round]!;
      body = (
        <VotePair
          key={step.round}
          a={a}
          b={b}
          round={step.round + 1}
          rounds={pairEntries.length}
          onVote={(chosen, from) =>
            launch(chosen, from, () => {
              setAnswered(2 + step.round);
              go(step.round + 1 < pairEntries.length ? { kind: "vote", round: step.round + 1 } : { kind: "horizon" });
            })
          }
        />
      );
      break;
    }
    case "horizon":
      body = <Horizon value={answered >= 6 ? state.horizonYears : undefined} onPick={(years) => { update({ ...state, horizonYears: years }); setAnswered(6); setTimeout(() => go({ kind: "aside" }), 200); }} />;
      break;
    case "aside":
      body = <Aside value={state.monthlyCents} totalCents={Math.max(total, 1)} onChange={(c) => update({ ...state, monthlyCents: c })} onDone={() => { setAnswered(7); go({ kind: "agent" }); }} />;
      break;
    case "agent":
      body = (
        <View style={{ flex: 1 }}>
          <AgentWork state={state} onResult={setResult} onFollowUp={(name) => update({ ...state, last: name ? picked(state).find((e) => e.name === name)?.id : undefined })} />
          <Appear when={!!result}>
            <View style={{ paddingHorizontal: gutter, paddingBottom: 16 }}>
              <PrimaryButton label="See my life" onPress={() => go({ kind: "reveal" })} />
            </View>
          </Appear>
        </View>
      );
      break;
    case "theme":
      body = result ? (
        <ThemeChooser
          totalCents={result.upfrontCents}
          by={monthYearLong(new Date(`${result.everythingBy}-01T00:00:00`))}
          onDone={(id) => { theme.set(id); setSheet(true); }}
        />
      ) : null;
      break;
    case "reveal":
      body = result ? (
        <RevealCard
          picks={picked(state)}
          upfrontCents={result.upfrontCents}
          monthlyRunningCents={result.monthlyRunningCents}
          everythingBy={result.everythingBy}
          onKeep={() => { update({ ...state, kept: true }); go({ kind: "theme" }); }}
          onChange={() => { update({ ...state, picks: [] }); setAnswered(0); setResult(null); go({ kind: "first" }, true); }}
        />
      ) : null;
      break;
  }

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <Atmosphere />
      <Animated.View style={{ flex: 1, opacity: stage, borderRadius: sheet ? 24 : 0, overflow: sheet ? "hidden" : "visible", transform: [{ translateX: shift }, { scale: behind }], paddingTop: framed ? insets.top + layout.contentTop : 0, paddingBottom: building ? insets.bottom + pillSpace : 0 }}>{body}</Animated.View>

      {framed ? (
        // A 44 pt header bar from the top inset, then the segments at +50, both on the content column (UI audit P0-3).
        <View pointerEvents="box-none" style={{ position: "absolute", top: insets.top, left: 0, right: 0, alignItems: "center", paddingHorizontal: gutter }}>
          <View pointerEvents="box-none" style={{ width: "100%", maxWidth: headerColumn }}>
            <View pointerEvents="box-none" style={{ height: layout.headerBar, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Wordmark />
              <Pressable accessibilityRole="link" onPress={() => router.push("/sign-in")} style={{ minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "flex-end" }}>
                <Text style={[type.label, { color: p.ink2 }]}>I have an account</Text>
              </Pressable>
            </View>
            {building ? <Segments count={SEGMENTS} done={answered} style={{ marginTop: layout.segmentsTop - layout.headerBar }} /> : null}
          </View>
        </View>
      ) : null}

      {building ? (
        <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: insets.bottom + 16, alignItems: "center", paddingHorizontal: 16 }}>
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
