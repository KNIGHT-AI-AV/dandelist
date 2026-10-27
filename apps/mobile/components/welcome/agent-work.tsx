import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Text, View } from "react-native";
import { ease, native, useReducedMotion } from "../../lib/motion";
import { fonts, usePalette } from "../../lib/theme";
import { streamPreview, type PreviewEvent, type WelcomeState } from "../../lib/welcome";
import { AgentDot, Eyebrow, Glass } from "../lux";
import { Chip, Rise } from "./kit";

type Row = { id: string; state: "running" | "done"; text: string };
export type Result = Extract<PreviewEvent, { type: "result" }>;

/** A row enters when the server sends it; "running" shows a spinner until the server says it's done. */
function AgentRow({ row }: { row: Row }) {
  const p = usePalette();
  return (
    <Rise style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 28 }}>
      <View style={{ width: 16, alignItems: "center" }}>{row.state === "running" ? <ActivityIndicator size="small" color={p.accent} /> : <Text style={{ fontFamily: fonts.label, fontSize: 13, color: p.accent }}>✓</Text>}</View>
      <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 14.5, lineHeight: 20, color: row.state === "running" ? p.ink2 : p.ink }}>{row.text}</Text>
    </Rise>
  );
}

/** Words fade in one at a time, 26 ms apart: paced like writing, never changed. */
function StreamedNote({ text }: { text: string }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const words = text.split(" ");
  const [shown, setShown] = useState(reduced ? words.length : 0);
  useEffect(() => {
    if (reduced) return setShown(words.length);
    setShown(0);
    const t = setInterval(() => setShown((n) => (n >= words.length ? (clearInterval(t), n) : n + 1)), 26);
    return () => clearInterval(t);
  }, [text, reduced, words.length]);
  return (
    <Text style={{ fontFamily: fonts.displayItalic, fontSize: 21, lineHeight: 29, color: p.ink }} accessibilityLiveRegion="polite">
      {words.map((w, i) => (
        <Text key={i} style={{ opacity: i < shown ? 1 : 0 }}>{`${w} `}</Text>
      ))}
    </Text>
  );
}

/**
 * Step 6: Muse Spark at work. Every row and the note come from the server's real work (lib/welcome streamPreview).
 * Finished rows stay at least 350 ms so they can be read, with at most 1.2 s of added pause in all.
 */
export function AgentWork({ state, onResult, onFollowUp }: { state: WelcomeState; onResult(r: Result): void; onFollowUp(last: string | null): void }) {
  const p = usePalette();
  const [rows, setRows] = useState<Row[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const queue = useRef<PreviewEvent[]>([]);
  const added = useRef(0);

  useEffect(() => {
    const ctrl = new AbortController();
    let draining = false;
    const drain = async () => {
      if (draining) return;
      draining = true;
      while (queue.current.length) {
        const e = queue.current.shift()!;
        if (e.type === "row") {
          setRows((rs) => (rs.some((r) => r.id === e.id) ? rs.map((r) => (r.id === e.id ? e : r)) : [...rs, e]));
          if (e.state === "done" && added.current < 1200) {
            added.current += 350;
            await new Promise((r) => setTimeout(r, 350));
          }
        } else if (e.type === "note") setNote(e.text);
        else if (e.type === "result") {
          setResult(e);
          onResult(e);
        }
      }
      draining = false;
    };
    streamPreview(state, (e) => {
      queue.current.push(e);
      void drain();
    }, ctrl.signal).catch((e: Error) => !ctrl.signal.aborted && setError(e.message));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 28, gap: 22, maxWidth: 560, width: "100%", alignSelf: "center" }}>
      <Rise style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <AgentDot />
          <Eyebrow>Your agent · Muse Spark by Meta</Eyebrow>
        </View>
        <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 34, lineHeight: 37, color: p.ink }}>
          Pricing your life.
        </Text>
      </Rise>
      <Glass style={{ padding: 18, gap: 10 }}>
        {rows.map((r) => (
          <AgentRow key={r.id} row={r} />
        ))}
        {!rows.length && !error ? <ActivityIndicator color={p.accent} style={{ alignSelf: "flex-start" }} /> : null}
        {error ? <Text style={{ fontFamily: fonts.body, fontSize: 14, color: p.danger }}>{error}</Text> : null}
      </Glass>
      {note ? <StreamedNote text={note} /> : null}
      {result?.largest && note ? (
        <Rise delay={note.split(" ").length * 26} style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <Chip label={`${result.largest.name} last`} selected={chosen === "last"} onPress={() => { setChosen("last"); onFollowUp(result.largest!.name); }} />
          <Chip label="Keep this order" selected={chosen === "keep"} onPress={() => { setChosen("keep"); onFollowUp(null); }} />
        </Rise>
      ) : null}
    </View>
  );
}

/** Fades a block in once, used for the step's own "continue" action when the work is done. */
export function Appear({ when, children }: { when: boolean; children: React.ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (when) Animated.timing(v, { toValue: 1, duration: 300, easing: ease.out, useNativeDriver: native }).start();
  }, [when, v]);
  if (!when) return null;
  return <Animated.View style={{ opacity: v }}>{children}</Animated.View>;
}
