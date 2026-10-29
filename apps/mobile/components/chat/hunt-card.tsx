import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { getRun, startHunt, type Answer, type Draft, type PriceOption, type Run, type Step, type WishQuestion } from "../../lib/agent";
import { useAuth } from "../../lib/auth";
import { useDandy } from "../../lib/dandy";
import { haptic } from "../../lib/motion";
import { stepLine } from "../../lib/recheck";
import { play } from "../../lib/sound";
import { answersFrom, refineChanged, withGiven } from "../../lib/refine";
import { fonts, radius, type, usePalette } from "../../lib/theme";
import { useWishes, type NewWish } from "../../lib/wishes";
import { ErrorLine, Glass, Money, Photo, PrimaryButton, QuietButton } from "../lux";
import { RefinePanel } from "../refine";
import { Working } from "./working";

/**
 * A wish named in the chat, hunted at once (owner, 2026-10-29: "It shouldn't say find real price. It should just ...
 * immediately hunt for it ... telling me that it's doing that ... within a certain limited region, so as to not spam
 * chat"). The hunt starts from the words themselves; one line says what the Dandy is doing and updates in place, and
 * the card lands with its photo and price in about 15 s while more sellers are checked. The agent picks the likely
 * answer to each question, so nothing waits on the person; "Refine it" lets them change one, or type their own, and
 * hunt again.
 */
interface Hunt {
  run: Run | null;
  /** The wish as read before, when this is a hunt again with changed answers; null for a hunt from the words. */
  draft: Draft | null;
  /** Answers changed on the card and not hunted with yet, by question id. */
  edits: Record<string, string>;
  error: string | null;
}

// One hunt per chat item, kept across remounts (the feed re-renders, the pager moves) so nothing starts twice.
const hunts = new Map<string, Hunt>();
const POLL_MS = 1500;
const fresh = (draft: Draft | null = null): Hunt => ({ run: null, draft, edits: {}, error: null });

/** What the Dandy is doing right now, in one short line: the server's own line for the newest step. */
function doing(h: Hunt): string {
  const last: Step | undefined = h.run?.steps.at(-1);
  if (last?.line) return last.line;
  const title = h.run?.draft?.title ?? h.draft?.title;
  if (!last) return title ? `Hunting for ${title}` : "Reading your wish";
  const { verb, detail } = stepLine(last);
  const line = `${verb} ${detail}`.trim();
  return line.length > 64 ? `${line.slice(0, 63)}…` : line;
}

/** The friendly words for anything that went wrong; never the raw error. */
function sorry(e: unknown): string {
  const m = e instanceof Error ? e.message : "";
  return /network|fetch|connection|timed out|reach/i.test(m) || !m ? "Lost the connection for a moment. Try again." : m;
}

/** The questions as this hunt answered them: the final result's, else the draft's once they arrive. */
const questionsOf = (h: Hunt): WishQuestion[] => (h.run?.result?.questions?.length ? h.run.result.questions : (h.run?.draft?.questions ?? h.draft?.questions ?? []));

export function HuntCard({ id, text, already }: { id: string; text: string; already: boolean }) {
  const p = usePalette();
  const { api } = useAuth();
  const dandy = useDandy();
  const { add } = useWishes();
  const [h, setH] = useState<Hunt>(() => hunts.get(id) ?? fresh());
  const [refining, setRefining] = useState(false);
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

  const start = useCallback(
    async (wish: { text: string } | { draft: Draft; answers: Answer[] }) => {
      const draft = "draft" in wish ? wish.draft : null;
      keep(fresh(draft));
      try {
        const run = await startHunt(api, wish);
        keep({ ...fresh(draft), run });
      } catch (e) {
        keep({ ...fresh(draft), error: sorry(e) });
      }
    },
    [api, keep],
  );

  // Starts the moment the item appears, unless this item already has a hunt.
  useEffect(() => {
    if (!hunts.has(id)) void start({ text });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Follows the hunt with short requests, so a slow one never holds a connection open.
  useEffect(() => {
    const run = h.run;
    if (!run || run.status !== "running") return;
    const t = setTimeout(async () => {
      try {
        const next = await getRun(api, run.id);
        const cur = hunts.get(id) ?? h;
        if (cur.run?.id !== run.id) return; // a newer hunt replaced this one
        keep({ ...cur, run: next });
        if (!cur.run?.result?.options.length && next.result?.options.length) {
          haptic.success();
          play("land");
        }
      } catch {
        // A missed poll is retried on the next tick.
        keep({ ...(hunts.get(id) ?? h) });
      }
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [h, api, id, keep]);

  const draft = h.run?.draft ?? h.draft;
  const questions = questionsOf(h);
  const option: PriceOption | undefined = h.run?.result?.options[0];
  const done = h.run?.status === "done" || h.run?.status === "error";
  const opened = h.run?.steps.slice().reverse().find((s): s is Extract<Step, { type: "open" }> => s.type === "open" && !!s.imageUrl);
  const photo = option?.imageUrl ?? opened?.imageUrl ?? null;

  const huntAgain = () => {
    if (!draft || !refineChanged(questions, h.edits)) return;
    const answers = answersFrom(questions, h.edits);
    setRefining(false);
    setSaved(false);
    // The draft carries the answers too, so a retry after a dropped connection keeps them.
    void start({ draft: { ...draft, questions: withGiven(questions, answers) }, answers });
  };

  // A hunt from the words starts over from them; a hunt again keeps the wish as read and the answers given.
  const retry = () => void (h.draft ? start({ draft: h.draft, answers: answersFrom(h.draft.questions ?? [], {}) }) : start({ text }));

  const save = async () => {
    if (!draft || !h.run?.result || !option) return;
    setSaving(true);
    try {
      const wish: NewWish = {
        name: draft.title,
        kind: draft.kind,
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

  // Hunting with nothing to show yet: the wish, and one line of what the Dandy is doing.
  if (!option && !done && !h.error) {
    return (
      <Glass style={{ padding: 18, gap: 12, borderRadius: radius.lg }}>
        <Text style={[type.title3, { fontFamily: fonts.displayItalic, color: p.ink }]} numberOfLines={2}>
          {draft?.title ?? text}
        </Text>
        <Working dandy={dandy} label={doing(h)} />
      </Glass>
    );
  }

  if (!option) {
    return (
      <Glass style={{ padding: 18, gap: 12, borderRadius: radius.lg }}>
        <Text style={[type.title3, { fontFamily: fonts.displayItalic, color: p.ink }]}>{draft?.title ?? text}</Text>
        <ErrorLine>{h.error ?? h.run?.error ?? "Couldn't find a price for that just now."}</ErrorLine>
        <QuietButton label="Try again" onPress={retry} style={{ alignSelf: "flex-start" }} />
      </Glass>
    );
  }

  return (
    <Glass style={{ padding: 0, gap: 0, borderRadius: radius.lg, overflow: "hidden" }}>
      {photo ? <Photo uri={photo} style={{ width: "100%", aspectRatio: 4 / 3 }} /> : null}
      <View style={{ padding: 18, gap: 10 }}>
        <Text style={[type.title2, { color: p.ink }]} numberOfLines={2}>
          {draft?.title}
        </Text>
        <Money cents={option.upfrontCents} size="card" />
        <Text style={[type.footnote, { color: p.ink2 }]} numberOfLines={2}>
          {option.statusLabel}
        </Text>
        {h.error ? <ErrorLine>{h.error}</ErrorLine> : null}
        {!done ? <Working dandy={dandy} label="Checking more sellers" /> : null}
        <PrimaryButton label={saved || already ? "On your list" : "Add to my list"} busy={saving} disabled={saved || already} onPress={() => void save()} />
        {questions.length ? <QuietButton label={refining ? "Done refining" : "Refine it"} onPress={() => setRefining((r) => !r)} style={{ alignSelf: "flex-start" }} /> : null}
        {refining ? <RefinePanel questions={questions} edits={h.edits} onEdit={(q, a) => keep({ ...h, edits: { ...h.edits, [q]: a } })} onHunt={huntAgain} /> : null}
      </View>
    </Glass>
  );
}
