import { useEffect, useRef, useState } from "react";
import { Animated, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { ease, native } from "../../lib/motion";
import { fonts, layout, type, usePalette, useType } from "../../lib/theme";
import { streamPreview, type PreviewEvent, type WelcomeState } from "../../lib/welcome";
import { DandyAvatar } from "../dandy-avatar";
import { AgentDot, EdgeFade, Eyebrow, Glass, Icon } from "../lux";
import { DandyFields, useDandyDraft } from "../settings/dandy-editor";
import { Chip, Rise } from "./kit";

type Row = { id: string; state: "running" | "done"; text: string };
export type Result = Extract<PreviewEvent, { type: "result" }>;

/** A row enters when the server sends it; "running" breathes the dot until the server says it's done. */
function AgentRow({ row }: { row: Row }) {
  const p = usePalette();
  return (
    <Rise style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 24 }}>
      <View style={{ width: 17, alignItems: "center" }}>{row.state === "running" ? <AgentDot busy /> : <Icon name="check" color={p.accentText} size={14} />}</View>
      <Text style={[type.footnote, { flex: 1, color: row.state === "running" ? p.ink2 : p.ink }]}>{row.text}</Text>
    </Rise>
  );
}

/**
 * While the agent prices the whole list (owner, 2026-10-28: "this is when the user gets to customise their agent"),
 * the person meets their Dandy: a name, one of four personalities that changes how it speaks, one of five shapes and
 * one of ten house colours (the shared editor in components/settings/dandy-editor). The mark updates as they choose.
 * The pricing runs underneath as a few quiet rows, the first wish's live trail first when it is still being priced
 * (`waiting`); the plan starts once it lands (`ready`).
 */
export function AgentWork({ state, ready, waiting, onResult, onRestart }: { state: WelcomeState; ready: boolean; waiting: { title: string; line: string } | null; onResult(r: Result): void; onRestart(): void }) {
  const p = usePalette();
  const t = useType();
  const { width } = useWindowDimensions();
  const gutter = layout.gutter(width);
  const draft = useDandyDraft();
  const [rows, setRows] = useState<Row[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const queue = useRef<PreviewEvent[]>([]);
  const added = useRef(0);

  useEffect(() => {
    if (!ready) return;
    if (attempt) {
      setRows([]);
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
        } else if (e.type === "result") {
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

  const shown = draft.shown;
  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 8 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={{ paddingHorizontal: gutter, gap: layout.stack.section, maxWidth: layout.column + 2 * gutter, width: "100%", alignSelf: "center" }}>
          <Rise style={{ alignItems: "center", gap: layout.stack.base }}>
            <Animated.View style={{ transform: [{ scale: draft.pop }] }}>
              <DandyAvatar dandy={shown} size={88} />
            </Animated.View>
            <View style={{ alignItems: "center", gap: layout.stack.tight }}>
              <Eyebrow>Meet your Dandy</Eyebrow>
              <Text accessibilityRole="header" style={[t.title1, { color: p.ink, textAlign: "center" }]}>
                Make it <Text style={{ fontFamily: fonts.displayItalic, color: p.accentText }}>yours</Text>.
              </Text>
              <Text style={[type.callout, { color: p.ink2, textAlign: "center" }]}>It's pricing your list right now. Give it a name and a way of talking while it works.</Text>
            </View>
          </Rise>

          <Glass style={{ padding: layout.cardPad, gap: 10 }}>
            {waiting ? (
              <View style={{ gap: 6 }}>
                <AgentRow row={{ id: "wish", state: "running", text: `Finding the real price of ${waiting.title}` }} />
                {waiting.line ? <Text style={[type.footnote, { fontFamily: fonts.titleItalic, color: p.ink2, marginLeft: 29 }]}>{waiting.line}</Text> : null}
              </View>
            ) : null}
            {rows.map((r) => (
              <AgentRow key={r.id} row={r} />
            ))}
            {!rows.length && !waiting && !error ? <AgentRow row={{ id: "start", state: "running", text: "Starting on your list" }} /> : null}
            {result ? <AgentRow row={{ id: "ready", state: "done", text: `${shown.name} has your list ready.` }} /> : null}
            {error ? <Text style={[type.callout, { color: p.danger }]}>{error}</Text> : null}
            {error ? (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Chip label="Try again" onPress={() => setAttempt((n) => n + 1)} style={{ flex: 1 }} />
                <Chip label="Change my picks" onPress={onRestart} style={{ flex: 1 }} />
              </View>
            ) : null}
          </Glass>

          <Rise delay={60} style={{ gap: layout.stack.section }}>
            <DandyFields draft={draft} />
          </Rise>
        </View>
      </ScrollView>
      {/* A scroll edge, not a hard cut: the card fades into the page before it reaches the header. */}
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
