import { useEffect, useRef, useState } from "react";
import { Animated, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { ease, native, useReducedMotion } from "../../lib/motion";
import { fonts, layout, type, usePalette, useType } from "../../lib/theme";
import { streamPreview, type PreviewEvent, type WelcomeState } from "../../lib/welcome";
import { AgentDot, EdgeFade, Eyebrow, Glass, Icon } from "../lux";
import { Chip, Rise } from "./kit";

type Row = { id: string; state: "running" | "done"; text: string };
export type Result = Extract<PreviewEvent, { type: "result" }>;

/** A row enters when the server sends it; "running" breathes the agent's dot until the server says it's done. */
function AgentRow({ row }: { row: Row }) {
  const p = usePalette();
  return (
    <Rise style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 28 }}>
      <View style={{ width: 17, alignItems: "center" }}>{row.state === "running" ? <AgentDot busy /> : <Icon name="check" color={p.accentText} size={15} />}</View>
      <Text style={[type.callout, { flex: 1, color: row.state === "running" ? p.ink2 : p.ink }]}>{row.text}</Text>
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
    <Text style={[type.title3, { fontFamily: fonts.titleItalic, color: p.ink }]} accessibilityLiveRegion="polite">
      {words.map((w, i) => (
        <Text key={i} style={{ opacity: i < shown ? 1 : 0 }}>{`${w} `}</Text>
      ))}
    </Text>
  );
}

/**
 * Muse Spark at work on the whole list. Every row and the note come from the server's real work (lib/welcome
 * streamPreview). When the first wish is still being priced, its live trail shows first (`waiting`), and the plan
 * starts once it lands (`ready`). Finished rows stay at least 350 ms so they can be read, with at most 1.2 s of
 * added pause in all.
 */
export function AgentWork({ state, ready, waiting, onResult, onFollowUp, onRestart }: { state: WelcomeState; ready: boolean; waiting: { title: string; line: string } | null; onResult(r: Result): void; onFollowUp(last: string | null): void; onRestart(): void }) {
  const p = usePalette();
  const t = useType();
  const { width } = useWindowDimensions();
  const gutter = layout.gutter(width);
  const [rows, setRows] = useState<Row[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const queue = useRef<PreviewEvent[]>([]);
  const added = useRef(0);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    if (!ready) return;
    if (attempt) {
      setRows([]);
      setNote(null);
      setError(null);
      queue.current = [];
      added.current = 0;
    }
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
    // fetch() rejects with a TypeError ("Failed to fetch") when the network is down; say that in plain words.
    streamPreview(state, (e) => {
      queue.current.push(e);
      void drain();
    }, ctrl.signal).catch((e: Error) => !ctrl.signal.aborted && setError(e instanceof TypeError ? "Couldn't reach Dandelist. Check your connection." : e.message));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, ready]);

  // Centred while it fits; once the note and choices outgrow a phone screen it scrolls inside its own frame, following
  // the newest line, instead of spilling under the header and the button (QA 2026-10-28 at iPhone 15 size).
  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingVertical: 8 }}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
      >
        <View style={{ paddingHorizontal: gutter, gap: layout.stack.section, maxWidth: layout.column + 2 * gutter, width: "100%", alignSelf: "center" }}>
          <Rise style={{ gap: layout.stack.tight }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <AgentDot busy={!result && !error} />
              <Eyebrow>Your agent · Muse Spark by Meta</Eyebrow>
            </View>
            <Text accessibilityRole="header" style={[t.title1, { color: p.ink }]}>
              Pricing your list.
            </Text>
          </Rise>
          <Glass style={{ padding: layout.cardPad, gap: 12, minHeight: 68 }}>
            {waiting ? (
              <View style={{ gap: 8 }}>
                <AgentRow row={{ id: "wish", state: "running", text: `Finding the real price of ${waiting.title}` }} />
                {waiting.line ? <Text style={[type.callout, { fontFamily: fonts.titleItalic, color: p.ink2, marginLeft: 29 }]}>{waiting.line}</Text> : null}
              </View>
            ) : null}
            {rows.map((r) => (
              <AgentRow key={r.id} row={r} />
            ))}
            {error ? <Text style={[type.callout, { color: p.danger }]}>{error}</Text> : null}
          </Glass>
          {note ? <StreamedNote text={note} /> : null}
          {result?.largest && note ? (
            <Rise delay={note.split(" ").length * 26} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Chip label={`${result.largest.name} last`} selected={chosen === "last"} onPress={() => { setChosen("last"); onFollowUp(result.largest!.name); }} />
              <Chip label="Keep this order" selected={chosen === "keep"} onPress={() => { setChosen("keep"); onFollowUp(null); }} />
            </Rise>
          ) : null}
          {error ? (
            // A failed preview used to be a dead end with no control on screen.
            <Rise style={{ flexDirection: "row", gap: 8 }}>
              <Chip label="Try again" onPress={() => setAttempt((n) => n + 1)} style={{ flex: 1 }} />
              <Chip label="Change my picks" onPress={onRestart} style={{ flex: 1 }} />
            </Rise>
          ) : null}
        </View>
      </ScrollView>
      {/* A scroll edge, not a hard cut: lines scrolling up fade into the page before they reach the header. */}
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: layout.stack.section, transform: [{ scaleY: -1 }] }}>
        <EdgeFade height={layout.stack.section} />
      </View>
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
