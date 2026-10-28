import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Text, View } from "react-native";
import { getRun, interpretWish, startResearch, type PriceOption, type Run } from "../../lib/agent";
import { useAuth } from "../../lib/auth";
import { formatCents } from "../../lib/money";
import { ease, haptic, native, step, useReducedMotion } from "../../lib/motion";
import { POLL_MS, elapsed, newPricePatch, pickOption, priceChange, stepLine } from "../../lib/recheck";
import { layout, radius, type, usePalette, useType } from "../../lib/theme";
import { useWishes, type Wish } from "../../lib/wishes";
import { AgentDot, ErrorLine, Eyebrow, Glass, PrimaryButton, QuietButton } from "../lux";
import { Odometer } from "../odometer";
import { Swap } from "./swap";

type Phase = "idle" | "reading" | "running" | "done" | "saved";

/** The saved price a check is measured against, frozen when the check starts so saving can't rewrite the result. */
interface Basis {
  cents: number;
  checkedAt: string;
  url?: string;
}

function useClock(since: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [since]);
  return since === null ? "" : elapsed(now - since);
}

/**
 * "Check the price again": re-runs the price agent for a saved wish the way the new-wish screen does (read the
 * wish's name, research with no answers, poll every 1.5 s), shows compact live progress, then the new price against
 * the saved one. Each run spends model credit, so only one runs at a time; a run whose polling failed is picked back
 * up on retry rather than paid for twice.
 */
export function Recheck({ wish }: { wish: Wish }) {
  const { api } = useAuth();
  const { reload } = useWishes();
  const p = usePalette();
  const [phase, setPhase] = useState<Phase>("idle");
  const [run, setRun] = useState<Run | null>(null);
  const [basis, setBasis] = useState<Basis | null>(null);
  const [since, setSince] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const alive = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const working = phase === "reading" || phase === "running";
  const clock = useClock(working ? since : null);

  const fail = (e: unknown) => {
    if (!alive.current) return;
    busy.current = false;
    setError((e as Error).message);
    setPhase("idle");
  };

  const land = (r: Run) => {
    if (!alive.current) return;
    setRun(r);
    if (r.status === "running") return setPhase("running");
    busy.current = false;
    if (r.status === "error") {
      setRun(null);
      setError(r.error ?? "Research stopped.");
      return setPhase("idle");
    }
    setPhase("done");
  };

  async function start() {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    // A run we lost track of is still going on the server: pick it back up rather than pay for another.
    if (run?.status === "running") return setPhase("running");
    const a = wish.details.agent;
    setBasis({ cents: wish.item.upfrontCents, checkedAt: a?.checkedAt ?? wish.createdAt, url: a?.url });
    setRun(null);
    setSaveError(null);
    setSince(Date.now());
    setPhase("reading");
    try {
      const { draft } = await interpretWish(api, wish.name);
      land(await startResearch(api, draft, []));
    } catch (e) {
      fail(e);
    }
  }

  useEffect(() => {
    if (phase !== "running" || run?.status !== "running") return;
    const id = setTimeout(async () => {
      try {
        land(await getRun(api, run.id));
      } catch (e) {
        fail(e);
      }
    }, POLL_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, run, api]);

  async function adopt(option: PriceOption) {
    if (!run || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api(`/wishes/${wish.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newPricePatch(wish, run, option)) }).catch(() => null);
      if (!res) throw new Error("Can't reach Dandelist. Check your connection.");
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't save the new price.");
      await reload();
      if (alive.current) setPhase("saved");
    } catch (e) {
      if (alive.current) setSaveError((e as Error).message);
    } finally {
      if (alive.current) setSaving(false);
    }
  }

  const option = phase === "done" && run?.result ? pickOption(run.result.options, basis?.url) : undefined;
  const slot = phase === "idle" ? `idle${error ? "-error" : ""}` : working ? "working" : phase === "done" ? (option ? "result" : "empty") : phase;

  let body: ReactNode = null;
  if (phase === "idle") {
    body = (
      <View style={{ alignItems: "flex-start", gap: layout.stack.tight }}>
        <ErrorLine>{error}</ErrorLine>
        <QuietButton label={error ? "Try again" : "Check the price again"} onPress={start} />
      </View>
    );
  } else if (working) {
    const last = run?.steps[run.steps.length - 1];
    const line = phase === "reading" ? { verb: "", detail: "Reading your wish..." } : last ? stepLine(last) : { verb: "", detail: "Starting the research..." };
    body = (
      <View style={{ minHeight: layout.control.chip, flexDirection: "row", alignItems: "center", gap: layout.stack.tight }}>
        <AgentDot busy />
        <Swap id={`${phase}-${run?.steps.length ?? 0}`} style={{ flex: 1 }}>
          <Text numberOfLines={1} style={[type.footnote, { color: p.ink }]}>
            {line.verb ? `${line.verb} ` : ""}
            <Text style={{ color: p.ink2 }}>{line.detail}</Text>
          </Text>
        </Swap>
        <Text style={[type.figure, { color: p.ink3 }]}>{clock}</Text>
      </View>
    );
  } else if (phase === "done" && option && basis) {
    body = <Result basis={basis} option={option} saving={saving} error={saveError} onAdopt={() => adopt(option)} />;
  } else if (phase === "done") {
    body = (
      <View style={{ alignItems: "flex-start", gap: layout.stack.tight }}>
        <Text style={[type.callout, { color: p.ink2 }]}>The agent couldn't find a price it could stand behind for this one.</Text>
        <QuietButton label="Try again" onPress={start} />
      </View>
    );
  } else if (phase === "saved") {
    body = (
      <View style={{ minHeight: layout.control.chip, flexDirection: "row", alignItems: "center", gap: layout.stack.tight }}>
        <AgentDot />
        <Text accessibilityLiveRegion="polite" style={[type.footnote, { color: p.ink2 }]}>
          New price saved.
        </Text>
      </View>
    );
  }

  return <Swap id={slot}>{body}</Swap>;
}

/**
 * The new price against the saved one. Choreography: the card rises in (Swap), a beat later the figure rolls from
 * the saved price to the new one on the odometer's cinema roll, and on the frame it lands the result haptic fires,
 * then the change line and the action rise in 50 ms apart.
 */
function Result({ basis, option, saving, error, onAdopt }: { basis: Basis; option: PriceOption; saving: boolean; error: string | null; onAdopt(): void }) {
  const p = usePalette();
  const t = useType();
  const reduced = useReducedMotion();
  const change = priceChange(basis.cents, option.upfrontCents, basis.checkedAt);
  const [shown, setShown] = useState(basis.cents);
  const [landed, setLanded] = useState(false);
  const done = useRef(false);
  const words = useRef(new Animated.Value(0)).current;
  const action = useRef(new Animated.Value(0)).current;

  const onLand = () => {
    if (done.current) return;
    done.current = true;
    haptic.success();
    setLanded(true);
    AccessibilityInfo.announceForAccessibility(`${change.text}. ${formatCents(option.upfrontCents)}`);
    Animated.stagger(
      step.staggerMs,
      [words, action].map((v) => Animated.timing(v, { toValue: 1, duration: reduced ? step.outMs : step.inMs, easing: ease.out, useNativeDriver: native })),
    ).start();
  };

  // A beat after the card has risen in, roll from the saved figure to the new one. Nothing to roll when it's the same.
  useEffect(() => {
    const id = setTimeout(() => (change.direction === "same" ? onLand() : setShown(option.upfrontCents)), reduced ? 0 : step.inMs);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const size = t.title1.fontSize ?? type.title1.fontSize;
  const rise = (v: Animated.Value) => ({ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [reduced ? 0 : layout.stack.tight, 0] }) }] });
  return (
    <Glass style={{ borderRadius: radius.lg, borderCurve: "continuous", padding: layout.cardPad, gap: layout.stack.base }}>
      <View style={{ gap: layout.stack.tight }}>
        <Eyebrow color={option.status === "verified" ? p.accentText : p.ink3}>{option.status === "verified" ? "Checked" : "Estimate"}</Eyebrow>
        <Odometer cents={shown} format={formatCents} size={size} family="bodoni" smallPrefix tracking={-0.02 * size} mode="cinema" onLand={onLand} />
        <Text numberOfLines={1} style={[type.footnote, { color: p.ink2 }]}>
          {option.seller}
        </Text>
      </View>
      <Animated.Text style={[type.headline, { color: change.direction === "down" ? p.accentText : p.ink }, rise(words)]}>{change.text}</Animated.Text>
      {change.direction !== "same" ? (
        <Animated.View pointerEvents={landed ? "auto" : "none"} style={rise(action)}>
          <PrimaryButton label="Use the new price" busyLabel="Saving..." busy={saving} commit onPress={onAdopt} />
          {/* Inside the action's block, so an empty error slot adds no gap to the card. */}
          <Swap id={error ?? ""}>{error ? <View style={{ paddingTop: layout.stack.tight }}><ErrorLine>{error}</ErrorLine></View> : null}</Swap>
        </Animated.View>
      ) : null}
    </Glass>
  );
}
