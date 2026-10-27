import { entry, firstPick, pairs, type Entry } from "@dandelist/catalogue";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Grain } from "../components/lux";
import { AgentWork, Appear, type Result } from "../components/welcome/agent-work";
import { Aside, FirstPick, Horizon, VotePair } from "../components/welcome/choose";
import { CodeSheet, RevealCard } from "../components/welcome/finale";
import { LifePill, Segments } from "../components/welcome/kit";
import { TitleSequence } from "../components/welcome/title";
import { useAuth } from "../lib/auth";
import { ease, native, useReducedMotion } from "../lib/motion";
import { fonts, radius, usePalette } from "../lib/theme";
import { SignInOptions } from "../components/sign-in-options";
import { useSignInOptions, type ProviderId, type SignInOption } from "../lib/auth";
import { loadWelcome, markTitleSeen, picked, saveWelcome, seenTitle, type WelcomeState } from "../lib/welcome";

/** Apple, Google and GitHub in the save sheet; the kept picks are already on this device for after the redirect. */
function WelcomeSocial() {
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
    <View style={{ gap: 10 }}>
      <SignInOptions options={options} pending={pending} disabled={!!pending} onChoose={choose} />
      {error ? <Text style={{ fontFamily: fonts.body, fontSize: 13, color: "#F0A595" }}>{error}</Text> : null}
    </View>
  );
}

type Step = { kind: "title" } | { kind: "first" } | { kind: "vote"; round: number } | { kind: "horizon" } | { kind: "aside" } | { kind: "agent" } | { kind: "reveal" };

const SEGMENTS = 7;
const firstEntries = firstPick.map(entry).filter((e): e is Entry => !!e);
const pairEntries = pairs.map(([a, b]) => [entry(a), entry(b)]).filter((pr): pr is [Entry, Entry] => !!pr[0] && !!pr[1]);

/**
 * The pre-login experience (onboarding research, 2026-10-27): a short title sequence, then the person builds the
 * life they want from real, sourced prices, watches the agent price it, sees the date, and only then saves it.
 * Everything chosen here becomes wishes on the new account.
 */
export default function Welcome() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const auth = useAuth();
  const [step, setStep] = useState<Step | null>(null);
  const [short, setShort] = useState(false);
  const [state, setState] = useState<WelcomeState>({ picks: [], horizonYears: null, monthlyCents: 100_000 });
  const [answered, setAnswered] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [sheet, setSheet] = useState(false);
  const [flight, setFlight] = useState<{ text: string; from: { x: number; y: number }; to: { x: number; y: number } } | null>(null);
  const fly = useRef(new Animated.Value(0)).current;
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

  if (!step) return <View style={{ flex: 1, backgroundColor: p.bg }} />;

  const total = picked(state).reduce((s, e) => s + e.upfrontCents, 0);
  const building = step.kind === "first" || step.kind === "vote" || step.kind === "horizon" || step.kind === "aside";

  let body: React.ReactNode;
  switch (step.kind) {
    case "title":
      body = <TitleSequence hero={firstEntries[0]!} short={short} onDone={() => { void markTitleSeen(); setStep({ kind: "first" }); }} />;
      break;
    case "first":
      body = <FirstPick entries={firstEntries} onPick={(e, from) => launch([e], from, () => { setAnswered(1); setStep({ kind: "vote", round: 0 }); })} />;
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
              setStep(step.round + 1 < pairEntries.length ? { kind: "vote", round: step.round + 1 } : { kind: "horizon" });
            })
          }
        />
      );
      break;
    }
    case "horizon":
      body = <Horizon value={answered >= 6 ? state.horizonYears : undefined} onPick={(years) => { update({ ...state, horizonYears: years }); setAnswered(6); setTimeout(() => setStep({ kind: "aside" }), 250); }} />;
      break;
    case "aside":
      body = <Aside value={state.monthlyCents} totalCents={Math.max(total, 1)} onChange={(c) => update({ ...state, monthlyCents: c })} onDone={() => { setAnswered(7); setStep({ kind: "agent" }); }} />;
      break;
    case "agent":
      body = (
        <View style={{ flex: 1 }}>
          <AgentWork state={state} onResult={setResult} onFollowUp={(name) => update({ ...state, last: name ? picked(state).find((e) => e.name === name)?.id : undefined })} />
          <Appear when={!!result}>
            <Pressable accessibilityRole="button" onPress={() => setStep({ kind: "reveal" })} style={({ pressed }) => ({ alignSelf: "center", marginBottom: insets.bottom + 24, height: 54, paddingHorizontal: 32, borderRadius: radius.pill, backgroundColor: p.ink, justifyContent: "center", opacity: pressed ? 0.85 : 1 })}>
              <Text style={{ fontFamily: fonts.label, fontSize: 15, color: p.onAccent }}>See my life</Text>
            </Pressable>
          </Appear>
        </View>
      );
      break;
    case "reveal":
      body = result ? (
        <RevealCard
          picks={picked(state)}
          upfrontCents={result.upfrontCents}
          monthlyRunningCents={result.monthlyRunningCents}
          everythingBy={result.everythingBy}
          onKeep={() => { update({ ...state, kept: true }); setSheet(true); }}
          onChange={() => { update({ ...state, picks: [] }); setAnswered(0); setResult(null); setStep({ kind: "first" }); }}
        />
      ) : null;
      break;
  }

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <View style={{ flex: 1, paddingTop: step.kind === "title" ? 0 : insets.top + 58, paddingBottom: building ? insets.bottom + 92 : 0 }}>{body}</View>

      {step.kind !== "title" ? (
        <View pointerEvents="box-none" style={{ position: "absolute", top: insets.top + 14, left: 20, right: 20, gap: 14 }}>
          <View pointerEvents="box-none" style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontFamily: fonts.display, fontSize: 19, color: p.ink }}>Dandelist</Text>
            <Pressable accessibilityRole="link" onPress={() => router.push("/sign-in")} hitSlop={10}>
              <Text style={{ fontFamily: fonts.label, fontSize: 13, color: p.ink2 }}>I have an account</Text>
            </Pressable>
          </View>
          {building ? <Segments count={SEGMENTS} done={answered} /> : null}
        </View>
      ) : null}

      {building ? <LifePill cents={total} onLayoutRef={(v) => (pill.current = v)} style={{ position: "absolute", left: 16, right: 16, bottom: insets.bottom + 16, maxWidth: 520, alignSelf: "center", width: "92%" }} /> : null}

      {flight ? (
        <Animated.Text
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            fontFamily: fonts.figure,
            fontSize: 20,
            color: p.accent,
            transform: [
              { translateX: fly.interpolate({ inputRange: [0, 1], outputRange: [flight.from.x, flight.to.x] }) },
              { translateY: Animated.add(fly.interpolate({ inputRange: [0, 1], outputRange: [flight.from.y, flight.to.y] }), fly.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -70, 0] })) },
              { scale: fly.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.8, 1.1, 0.85] }) },
            ],
            opacity: fly.interpolate({ inputRange: [0, 0.1, 0.9, 1], outputRange: [0, 1, 1, 0] }),
          }}
        >
          {flight.text}
        </Animated.Text>
      ) : null}

      {sheet ? <CodeSheet startEmail={auth.startEmail} verifyEmail={auth.verifyEmail} onClose={() => setSheet(false)} extra={<WelcomeSocial />} /> : null}
      <Grain />
    </View>
  );
}
