import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { useTasks } from "../../lib/activity";
import { useAuth } from "../../lib/auth";
import { useMoney } from "../../lib/currency";
import { useDandy } from "../../lib/dandy";
import { usePress } from "../../lib/motion";
import { QUOTES } from "../../lib/quotes";
import { adoptAmend, adoptRecheck, amendWish, dismissRecheck, recheckWish, useAccount, useRechecks, type Recheck } from "../../lib/rechecks";
import { fonts, layout, radius, space, type, usePalette } from "../../lib/theme";
import { useWishes } from "../../lib/wishes";
import { hostOf } from "../../lib/words";
import { DandyAvatar } from "../dandy-avatar";
import { AgentDot, Eyebrow, Glass, QuietButton } from "../lux";
import { Swap } from "../list/presence";

/** Live tasks take turns this long each. */
const TASK_MS = 2800;
/** An idle Dandy offers a new line this often. */
const QUOTE_MS = 45_000;
/** "Still the same price" stays this long, then gives way. */
const SAME_MS = 9000;

/** The list never says "life" (owner, recording 03), not even in someone else's words. */
const SHOWN = QUOTES.filter((q) => !/\bli(fe|ves|ving)\b/i.test(q.text));

const pickQuote = (not?: number) => {
  if (SHOWN.length < 2) return 0;
  let i = Math.floor(Math.random() * SHOWN.length);
  if (i === not) i = (i + 1) % SHOWN.length;
  return i;
};

/** A check's outcome, in the Dandy's words, with what can be done about it. */
function Outcome({ r }: { r: Recheck }) {
  const p = usePalette();
  const money = useMoney();
  const { api } = useAuth();
  const { wishes, reload } = useWishes();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wish = wishes.find((w) => w.id === r.wishId);
  const o = r.outcome;
  useEffect(() => {
    if (o.kind !== "same") return;
    const t = setTimeout(() => dismissRecheck(r.wishId), SAME_MS);
    return () => clearTimeout(t);
  }, [o.kind, r.wishId]);
  if (o.kind === "running") return null;
  if (o.kind === "same") {
    return <Text style={[type.callout, { color: p.ink }]}>{`${r.name} is still ${money.format(o.option.upfrontCents)} at ${hostOf(o.option.url) || "the seller"}. Marked as checked today.`}</Text>;
  }
  if (o.kind === "failed") {
    return (
      <View style={{ gap: space[8] }}>
        <Text style={[type.callout, { color: p.ink }]}>{o.message}</Text>
        <View style={{ flexDirection: "row", gap: space[8] }}>
          {wish ? <QuietButton label="Try again" onPress={() => void (r.said ? amendWish(api, wish, r.said) : recheckWish(api, wish, reload))} /> : null}
          <QuietButton label="Dismiss" onPress={() => dismissRecheck(r.wishId)} />
        </View>
      </View>
    );
  }
  // Both answers belong to this look (r.attempt); neither works while its result is being saved.
  const saving = busy || !!r.saving;
  const keep = () => void (saving || dismissRecheck(r.wishId, r.attempt));
  const use = async () => {
    if (saving) return;
    if (!wish) return dismissRecheck(r.wishId, r.attempt);
    setBusy(true);
    setError(null);
    try {
      await (o.kind === "amended" ? adoptAmend(api, wish, reload, r.attempt) : adoptRecheck(api, wish, reload, r.attempt));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (o.kind === "amended") {
    return (
      <View style={{ gap: space[8] }}>
        <Text style={[type.callout, { color: p.ink }]}>
          {`${o.name}: `}
          <Text style={{ color: p.accentText }}>{money.format(o.option.upfrontCents)}</Text>
          {` at ${hostOf(o.option.url) || "the seller"}.`}
        </Text>
        {error ? <Text style={[type.footnote, { color: p.danger }]}>{error}</Text> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[8] }}>
          <QuietButton label={saving ? "Saving..." : "Use it"} onPress={() => void use()} />
          <QuietButton label="Keep the one I had" onPress={keep} />
        </View>
      </View>
    );
  }
  const down = o.option.upfrontCents < o.was;
  const delta = Math.abs(o.option.upfrontCents - o.was);
  return (
    <View style={{ gap: space[8] }}>
      <Text style={[type.callout, { color: p.ink }]}>
        {`${r.name} is now `}
        <Text style={{ color: p.accentText }}>{money.format(o.option.upfrontCents)}</Text>
        {` at ${hostOf(o.option.url) || "the seller"}, ${down ? "down" : "up"} ${money.format(delta)} from ${money.format(o.was)}.`}
      </Text>
      {error ? <Text style={[type.footnote, { color: p.danger }]}>{error}</Text> : null}
      <View style={{ flexDirection: "row", gap: space[8] }}>
        <QuietButton label={saving ? "Saving..." : "Use the new price"} onPress={() => void use()} />
        <QuietButton label={`Keep ${money.format(o.was)}`} onPress={keep} />
      </View>
    </View>
  );
}

/**
 * The Dandy's corner of the list (owner, recording 03): what it is doing right now, taking turns until each is done;
 * the outcome of a price check; or, when it is idle, a line from someone worth quoting. Tapping it opens the chat.
 */
export function DandyArea({ onOpen }: { onOpen(): void }) {
  const p = usePalette();
  const dandy = useDandy();
  const tasks = useTasks(useAccount());
  const checks = useRechecks();
  const press = usePress(0.985);
  const [turn, setTurn] = useState(0);
  const [quote, setQuote] = useState(() => pickQuote());

  useEffect(() => {
    if (tasks.length < 2) return;
    const t = setInterval(() => setTurn((n) => n + 1), TASK_MS);
    return () => clearInterval(t);
  }, [tasks.length]);
  useEffect(() => {
    const t = setInterval(() => setQuote((q) => pickQuote(q)), QUOTE_MS);
    return () => clearInterval(t);
  }, []);

  const outcome = useMemo(() => [...checks].reverse().find((c) => c.outcome.kind !== "running"), [checks]);
  const task = tasks.length ? tasks[turn % tasks.length]! : null;
  const q = SHOWN[quote];

  let key: string;
  let body: ReactNode;
  if (outcome) {
    key = `outcome:${outcome.wishId}:${outcome.at}`;
    body = <Outcome r={outcome} />;
  } else if (task) {
    key = `task:${task.id}:${task.text}`;
    body = (
      <Text style={[type.title3, { fontFamily: fonts.titleItalic, color: p.ink }]} numberOfLines={2}>
        {task.text}
      </Text>
    );
  } else if (q) {
    key = `quote:${quote}`;
    body = (
      <View style={{ gap: space[8] }}>
        <Text style={[type.title3, { fontFamily: fonts.titleItalic, color: p.ink }]}>{`“${q.text}”`}</Text>
        <Text style={[type.figure, { color: p.ink3, textTransform: "uppercase", letterSpacing: 1.2 }]}>{q.author}</Text>
      </View>
    );
  } else {
    key = "idle";
    body = <Text style={[type.title3, { fontFamily: fonts.titleItalic, color: p.ink }]}>{`Ask ${dandy.name} for anything.`}</Text>;
  }

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${dandy.name}. Open the chat.`} onPress={onOpen} onPressIn={press.onPressIn} onPressOut={press.onPressOut}>
      <Animated.View style={{ transform: [{ scale: press.scale }] }}>
        <Glass style={{ padding: layout.cardPad, gap: layout.stack.tight, borderRadius: radius.lg }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[8] }}>
            <DandyAvatar dandy={dandy} size={24} />
            <Eyebrow>{dandy.name}</Eyebrow>
            <View style={{ flex: 1 }} />
            {task ? <AgentDot busy /> : null}
            <Text style={[type.footnote, { color: p.ink3 }]}>{task ? "Working" : "Talk"}</Text>
          </View>
          <Swap k={key}>{body}</Swap>
        </Glass>
      </Animated.View>
    </Pressable>
  );
}
