import { useCallback, useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { getRun, interpretWish, startResearch, type Answer, type Draft, type PriceOption, type Question, type Run, type Step } from "../../lib/agent";
import { useAuth } from "../../lib/auth";
import { useDandy } from "../../lib/dandy";
import { haptic } from "../../lib/motion";
import { stepLine } from "../../lib/recheck";
import { fonts, layout, radius, type, usePalette } from "../../lib/theme";
import { useWishes, type NewWish } from "../../lib/wishes";
import { Chip, ErrorLine, Glass, Hairline, Money, Photo, PrimaryButton, QuietButton } from "../lux";
import { Working } from "./working";

/**
 * A wish named in the chat, hunted at once (owner, 2026-10-29: "It shouldn't say find real price. It should just ...
 * immediately hunt for it ... telling me that it's doing that ... within a certain limited region, so as to not spam
 * chat"). One line says what the Dandy is doing and updates in place; then the card lands with its photo and price.
 * The agent's questions never block the hunt: it picks the likely answers, and "Refine" lets the person change them
 * (each with "Type your own") and hunt again.
 */
interface Hunt {
  draft: Draft | null;
  questions: Question[];
  answers: Record<string, string>;
  run: Run | null;
  error: string | null;
}

// One hunt per chat item, kept across remounts (the feed re-renders, the pager moves) so nothing starts twice.
const hunts = new Map<string, Hunt>();
const POLL_MS = 1500;
const OWN = "Type your own";

/** What the Dandy is doing right now, in one short line. */
function doing(h: Hunt): string {
  if (!h.draft) return "Reading your wish";
  const last: Step | undefined = h.run?.steps.at(-1);
  if (!last) return `Hunting for ${h.draft.title}`;
  const { verb, detail } = stepLine(last);
  const line = `${verb} ${detail}`.trim();
  return line.length > 64 ? `${line.slice(0, 63)}…` : line;
}

/** The friendly words for anything that went wrong; never the raw error. */
function sorry(e: unknown): string {
  const m = e instanceof Error ? e.message : "";
  return /network|fetch|connection|timed out|reach/i.test(m) || !m ? "Lost the connection for a moment. Try again." : m;
}

export function HuntCard({ id, text, already }: { id: string; text: string; already: boolean }) {
  const p = usePalette();
  const { api } = useAuth();
  const dandy = useDandy();
  const { add } = useWishes();
  const [h, setH] = useState<Hunt>(() => hunts.get(id) ?? { draft: null, questions: [], answers: {}, run: null, error: null });
  const [refining, setRefining] = useState(false);
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const keep = useCallback(
    (next: Hunt) => {
      hunts.set(id, next);
      if (alive.current) setH(next);
    },
    [id],
  );

  const hunt = useCallback(
    async (draft: Draft, questions: Question[], answers: Record<string, string>) => {
      const given: Answer[] = Object.entries(answers)
        .filter(([, a]) => a.trim())
        .map(([question, answer]) => ({ question, answer: answer.trim() }));
      try {
        keep({ draft, questions, answers, run: null, error: null });
        const run = await startResearch(api, draft, given);
        keep({ draft, questions, answers, run, error: null });
      } catch (e) {
        keep({ draft, questions, answers, run: null, error: sorry(e) });
      }
    },
    [api, keep],
  );

  const begin = useCallback(async () => {
    try {
      keep({ draft: null, questions: [], answers: {}, run: null, error: null });
      const r = await interpretWish(api, text);
      await hunt(r.draft, r.questions, {});
    } catch (e) {
      keep({ draft: null, questions: [], answers: {}, run: null, error: sorry(e) });
    }
  }, [api, text, hunt, keep]);

  // Starts the moment the item appears, unless this item already has a hunt.
  useEffect(() => {
    if (!hunts.has(id)) void begin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Follows the research with short requests, so a slow hunt never holds a connection open.
  useEffect(() => {
    const run = h.run;
    if (!run || run.status !== "running") return;
    const t = setTimeout(async () => {
      try {
        const next = await getRun(api, run.id);
        const cur = hunts.get(id) ?? h;
        keep({ ...cur, run: next });
        if (next.status === "done" && next.result?.options.length) haptic.success();
      } catch {
        // A missed poll is retried on the next tick.
        const cur = hunts.get(id) ?? h;
        keep({ ...cur });
      }
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [h, api, id, keep]);

  const option: PriceOption | undefined = h.run?.result?.options[0];
  const done = h.run?.status === "done" || h.run?.status === "error";
  const opened = h.run?.steps.slice().reverse().find((s): s is Extract<Step, { type: "open" }> => s.type === "open" && !!s.imageUrl);
  const photo = option?.imageUrl ?? opened?.imageUrl ?? null;

  const save = async () => {
    if (!h.draft || !h.run?.result || !option) return;
    setSaving(true);
    try {
      const wish: NewWish = {
        name: h.draft.title,
        kind: h.draft.kind,
        tier: "nice",
        upfrontCents: option.upfrontCents,
        recurringCents: 0,
        period: "month",
        recurring: option.recurring.map((r) => ({ amountCents: r.amountCents, period: r.period, label: r.label.slice(0, 60) })),
        details: {
          agent: {
            runId: h.run.id,
            seller: option.seller,
            url: option.url,
            status: option.status,
            checkedAt: option.checkedAt,
            imageUrl: photo ?? undefined,
            ...(option.media ? { media: option.media } : {}),
            explanation: h.run.result.explanation,
            source: option.source,
          },
        },
      };
      await add(wish);
      haptic.success();
      setSaved(true);
    } catch (e) {
      keep({ ...h, error: sorry(e) });
    } finally {
      setSaving(false);
    }
  };

  // Still hunting (or reading the wish): the wish in the Dandy's voice, and one line of what it's doing.
  if (!done && !h.error) {
    return (
      <Glass style={{ padding: 18, gap: 12, borderRadius: radius.lg }}>
        <Text style={[type.title3, { fontFamily: fonts.displayItalic, color: p.ink }]} numberOfLines={2}>
          {h.draft?.title ?? text}
        </Text>
        <Working dandy={dandy} label={doing(h)} />
      </Glass>
    );
  }

  if (!option) {
    return (
      <Glass style={{ padding: 18, gap: 12, borderRadius: radius.lg }}>
        <Text style={[type.title3, { fontFamily: fonts.displayItalic, color: p.ink }]}>{h.draft?.title ?? text}</Text>
        <ErrorLine>{h.error ?? h.run?.error ?? "Couldn't find a price for that just now."}</ErrorLine>
        <QuietButton label="Try again" onPress={() => (h.draft ? void hunt(h.draft, h.questions, h.answers) : void begin())} style={{ alignSelf: "flex-start" }} />
      </Glass>
    );
  }

  return (
    <Glass style={{ padding: 0, gap: 0, borderRadius: radius.lg, overflow: "hidden" }}>
      {photo ? <Photo uri={photo} style={{ width: "100%", aspectRatio: 4 / 3 }} /> : null}
      <View style={{ padding: 18, gap: 10 }}>
        <Text style={[type.title2, { color: p.ink }]} numberOfLines={2}>
          {h.draft?.title}
        </Text>
        <Money cents={option.upfrontCents} size="card" />
        <Text style={[type.footnote, { color: p.ink2 }]} numberOfLines={2}>
          {option.statusLabel}
        </Text>
        {h.error ? <ErrorLine>{h.error}</ErrorLine> : null}
        <PrimaryButton label={saved || already ? "On your list" : "Add to my list"} busy={saving} disabled={saved || already} onPress={() => void save()} />
        {h.questions.length ? <QuietButton label={refining ? "Done refining" : "Refine it"} onPress={() => setRefining((r) => !r)} style={{ alignSelf: "flex-start" }} /> : null}
        {refining
          ? h.questions.map((q) => {
              const picked = h.answers[q.question] ?? "";
              const own = typing[q.question] !== undefined;
              return (
                <View key={q.question} style={{ gap: 10 }}>
                  <Hairline />
                  <Text style={[type.callout, { color: p.ink }]}>{q.question}</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {q.choices.map((c) => (
                      <Chip key={c} label={c} selected={!own && picked === c} onPress={() => { haptic.select(); setTyping(({ [q.question]: _, ...rest }) => rest); keep({ ...h, answers: { ...h.answers, [q.question]: picked === c ? "" : c } }); }} />
                    ))}
                    <Chip label={OWN} selected={own} onPress={() => { haptic.select(); setTyping((t) => (own ? (({ [q.question]: _, ...rest }) => rest)(t) : { ...t, [q.question]: picked && !q.choices.includes(picked) ? picked : "" })); }} />
                  </View>
                  {own ? (
                    <TextInput
                      value={typing[q.question]}
                      onChangeText={(v) => {
                        setTyping((t) => ({ ...t, [q.question]: v.slice(0, 60) }));
                        keep({ ...h, answers: { ...h.answers, [q.question]: v.slice(0, 60) } });
                      }}
                      placeholder="e.g. Jubilee"
                      placeholderTextColor={p.ink3}
                      autoFocus
                      style={[type.body, { color: p.ink, borderBottomWidth: 1, borderBottomColor: p.line, paddingVertical: layout.stack.tight }]}
                    />
                  ) : null}
                </View>
              );
            })
          : null}
        {refining ? <PrimaryButton label="Hunt again with these" onPress={() => { setRefining(false); if (h.draft) void hunt(h.draft, h.questions, h.answers); }} /> : null}
      </View>
    </Glass>
  );
}
