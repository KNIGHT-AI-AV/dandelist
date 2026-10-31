import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { getRun, resumeHunt, retakePhoto, startHunt, type Answer, type Draft, type FoundPhoto, type PriceOption, type Run, type Step, type WishQuestion, type WorthCard } from "../../lib/agent";
import { useAuth } from "../../lib/auth";
import { getSecret, setSecret } from "../../lib/storage";
import { useMoney } from "../../lib/currency";
import { useDandy } from "../../lib/dandy";
import { haptic } from "../../lib/motion";
import { stepLine } from "../../lib/recheck";
import { answersFrom, refineChanged, withGiven } from "../../lib/refine";
import { guessCandidates, guessOthers } from "../../lib/guess";
import { cardState, listedWish } from "../../lib/listed";
import { fonts, radius, type, usePalette } from "../../lib/theme";
import { useWaitingMusic, type WaitPhase } from "../../lib/waiting";
import { useWishes, type NewWish } from "../../lib/wishes";
import { amountSteps, photoOnly, startAmount, wholeCents } from "../../lib/worth";
import { AddedLine } from "../added-line";
import { AskNote } from "../ask";
import { CandidateRow, GuessRow } from "../guess";
import { ErrorLine, Glass, Money, Photo, PrimaryButton, QuietButton } from "../lux";
import { RefinePanel } from "../refine";
import { WaitingLight } from "../waiting-light";
import { AmountPicker, PricelessPrice, glyphFor } from "../worth";
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
  /** A photo the AI found again for this card (a retake), shown and saved in place of the hunt's. */
  shot?: FoundPhoto;
  /** Photos this card has shown, never offered again by a retake. */
  shown?: string[];
  /** A money wish's amount as the person set it on the slider (US cents). */
  amount?: number;
  /** Hunted as an ordinary priced wish after "Price it" on its money or priceless card. */
  price?: boolean;
  /** The wish this card put on the list. */
  savedId?: string;
}

// One hunt per chat item, kept across remounts (the feed re-renders, the pager moves) so nothing starts twice. Keyed by
// the item and its words: item ids start again in every conversation, so an id alone would hand a new chat's first
// card the hunt of an earlier chat's.
const hunts = new Map<string, Hunt>();
const POLL_MS = 1500;
/**
 * The hunt a card started is remembered across app restarts for a day, so a card that comes back follows its own hunt
 * (which ran on with the app closed) instead of starting another that lands at another price (owner, 2026-10-31:
 * "Not to mention different pricing").
 */
const HUNT_KEEP_MS = 24 * 60 * 60 * 1000;
/** A remembered hunt the server hasn't answered for yet: polled like a running one until it does. */
const following = (id: string): Run => ({ id, status: "running", steps: [], result: null, error: null, createdAt: "" }) as unknown as Run;
function huntKey(id: string): string {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
  return `dandelist.hunt.${h.toString(36)}`;
}
const fresh = (draft: Draft | null = null, price = false): Hunt => ({ run: null, draft, edits: {}, error: null, ...(price ? { price } : {}) });

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

/**
 * `watched`: the chat is the page in front, so a picture being made here is one the person is looking at. `onPhase`
 * hears whether the card is still being worked out (the chat's "Add another while you wait" shows while one is);
 * `onShowOnList` turns to the list with the saved wish in view.
 */
export function HuntCard({ id: item, text, watched = true, onPhase, onShowOnList }: { id: string; text: string; watched?: boolean; onPhase?(id: string, working: boolean): void; onShowOnList?(wishId: string): void }) {
  const id = `${item}\n${text}`;
  const p = usePalette();
  const { api } = useAuth();
  const dandy = useDandy();
  const money = useMoney();
  const { add, wishes } = useWishes();
  const [h, setH] = useState<Hunt>(() => hunts.get(id) ?? fresh());
  const [refining, setRefining] = useState(false);
  const [saving, setSaving] = useState(false);
  // The Dandy's line when it kept its pick for a question left open.
  const [note, setNote] = useState<string | null>(null);
  // "Yes, that's the one" on a best guess (components/guess.tsx): the row goes away.
  const [guessKept, setGuessKept] = useState(false);
  // How the last retake went: a picture that couldn't be found ends the wait quietly.
  const [retook, setRetook] = useState<"none" | "found" | "failed">("none");
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
    async (wish: { text: string; price?: boolean } | { draft: Draft; answers: Answer[] }) => {
      const draft = "draft" in wish ? wish.draft : null;
      const price = "text" in wish && !!wish.price;
      setRetook("none");
      keep(fresh(draft, price));
      try {
        const run = await startHunt(api, wish);
        keep({ ...fresh(draft, price), run });
        void setSecret(huntKey(id), JSON.stringify({ run: run.id, at: Date.now() })).catch(() => undefined);
      } catch (e) {
        keep({ ...fresh(draft, price), error: sorry(e) });
      }
    },
    [api, keep, id],
  );

  // Starts the moment the item appears, unless this item already has a hunt: in this session, or remembered from before
  // the app closed.
  useEffect(() => {
    if (hunts.has(id)) return;
    let gone = false;
    void (async () => {
      let saved: { run?: string; at?: number } | null = null;
      try {
        saved = JSON.parse((await getSecret(huntKey(id))) ?? "null") as { run?: string; at?: number } | null;
      } catch {
        // Nothing readable remembered: hunt afresh.
      }
      if (saved?.run && Date.now() - (saved.at ?? 0) < HUNT_KEEP_MS) {
        const back = await resumeHunt(api, saved.run);
        if (gone || hunts.has(id)) return;
        if (back.kind === "run") return keep({ ...fresh(), run: back.run });
        // The server can't answer just now: keep following the remembered hunt; the poll tries again until it does.
        if (back.kind === "follow") return keep({ ...fresh(), run: following(saved.run) });
        // Gone for good on the server: hunt afresh below.
      }
      if (!gone && !hunts.has(id)) void start({ text });
    })();
    return () => void (gone = true);
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
        // Its landing (the ramp and the chime) follows the picture: see useWaitingMusic below.
        keep({ ...cur, run: next });
      } catch {
        // A missed poll is retried on the next tick.
        keep({ ...(hunts.get(id) ?? h) });
      }
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [h, api, id, keep]);

  const draft = h.run?.draft ?? h.draft;
  // The reading's other likely names when it had to work out what was meant; the chat can also just be told.
  const guess = guessOthers(draft);
  // Photos to pick from when the wish named only a brand or a kind (owner, 2026-10-30), while it hunts and after.
  const candidatePick = guessCandidates(draft);
  const questions = questionsOf(h);
  const option: PriceOption | undefined = h.run?.result?.options[0];
  const done = h.run?.status === "done" || h.run?.status === "error";
  const opened = h.run?.steps.slice().reverse().find((s): s is Extract<Step, { type: "open" }> => s.type === "open" && !!s.imageUrl);
  const photo = h.shot?.imageUrl ?? option?.imageUrl ?? opened?.imageUrl ?? null;
  const [retaking, setRetaking] = useState(false);

  // Retake photo: the AI looks again with what the wish is, never offering a photo this card has shown.
  const retake = useCallback(async () => {
    const cur = hunts.get(id) ?? h;
    const d = cur.run?.draft ?? cur.draft;
    if (!d || retaking) return;
    setRetaking(true);
    setRetook("none");
    // The photo on screen goes first: it is the one being turned down, and the hunt starts from what was wrong with it.
    const seen = [...new Set([...(photo ? [photo] : []), ...(cur.shown ?? [])])];
    const page = cur.run?.result?.options[0]?.url;
    try {
      const shot = await retakePhoto(api, { title: d.title, kind: d.kind, summary: d.summary, ...(page ? { page } : {}) }, seen);
      keep({ ...(hunts.get(id) ?? cur), shot, shown: [...seen, shot.imageUrl] });
      setRetook("found");
    } catch (e) {
      keep({ ...(hunts.get(id) ?? cur), shown: seen, error: sorry(e) });
      setRetook("failed");
    } finally {
      if (alive.current) setRetaking(false);
    }
  }, [api, h, id, keep, photo, retaking]);

  // Photos always come (owner, 2026-10-29): a finished hunt with no photo asks for one once, by itself.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || !option || photo || h.run?.status !== "done") return;
    asked.current = true;
    void retake();
  }, [option, photo, h.run?.status, retake]);

  // The picture: being made while the hunt has none to show, or a retake (asked for, or about to start by itself) looks
  // for one; landed once one is in. The ballad plays while it's made, and the ramp and the chime come as it lands.
  const autoRetake = !!option && !photo && h.run?.status === "done" && !asked.current;
  const picture: WaitPhase = retaking || autoRetake ? "waiting" : retook === "failed" ? "idle" : h.run?.result?.worth || (option && photo) ? "landed" : !done && !h.error ? "waiting" : "idle";
  useWaitingMusic(picture, watched);

  // Where the card stands (lib/listed.ts). A hunt again with changed answers is a new find, so only the wish saved from
  // it counts then, not an older one of the same name.
  const landed = !!option || !!h.run?.result?.worth;
  const listedId = listedWish(wishes, h.savedId, h.draft ? [] : [text, draft?.title, h.run?.result?.worth?.title]);
  const state = cardState({ landed, failed: !!h.error || done, listedId });
  const phase = useRef(onPhase);
  phase.current = onPhase;
  useEffect(() => phase.current?.(item, state === "working"), [item, state]);
  useEffect(() => () => phase.current?.(item, false), [item]);

  const huntAgain = (edits: Record<string, string> = h.edits) => {
    if (!draft || !refineChanged(questions, edits)) return;
    const answers = answersFrom(questions, edits);
    setRefining(false);
    // The draft carries the answers too, so a retry after a dropped connection keeps them.
    void start({ draft: { ...draft, questions: withGiven(questions, answers) }, answers });
  };

  // A hunt from the words starts over from them; a hunt again keeps the wish as read and the answers given.
  const retry = () => void (h.draft ? start({ draft: h.draft, answers: answersFrom(h.draft.questions ?? [], {}) }) : start({ text, ...(h.price ? { price: true } : {}) }));

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
            ...(h.shot ? { media: h.shot.media } : option.media ? { media: option.media } : {}),
            explanation: h.run.result.explanation,
            source: option.source,
          },
        },
      };
      const saved = await add(wish);
      haptic.success();
      keep({ ...(hunts.get(id) ?? h), savedId: saved.id });
    } catch (e) {
      keep({ ...h, error: sorry(e) });
    } finally {
      setSaving(false);
    }
  };

  // Money itself or something priceless (owner, 2026-10-30): nothing was hunted. Money asks how much, starting at any
  // amount the wish named; something priceless shows infinity and the Dandy's line. Neither shows an empty photo box.
  const worth = h.run?.result?.worth;
  if (worth) {
    const named = worth.worth === "money" ? worth.amountCents : undefined;
    const amountCents = h.amount ?? startAmount(amountSteps(money.rate, money.unit, named), named);
    const shot = h.run?.result?.photo;
    const saveWorth = async (w: WorthCard) => {
      setSaving(true);
      try {
        const saved = await add({
          name: w.title,
          kind: w.kind,
          tier: "nice",
          upfrontCents: w.worth === "money" ? wholeCents(amountCents) : 0,
          recurringCents: 0,
          period: "month",
          recurring: [],
          details: { ...(w.worth === "money" ? { worth: "money" as const } : { worth: "priceless" as const, line: w.line.slice(0, 120) }), ...(shot ? { agent: photoOnly(shot.imageUrl, shot.media) } : {}) },
        });
        haptic.success();
        keep({ ...(hunts.get(id) ?? h), savedId: saved.id });
      } catch (e) {
        keep({ ...(hunts.get(id) ?? h), error: sorry(e) });
      } finally {
        setSaving(false);
      }
    };
    return (
      <Glass style={{ padding: 0, gap: 0, borderRadius: radius.lg, overflow: "hidden" }}>
        <View style={{ width: "100%", aspectRatio: 4 / 3 }}>
          <Photo uri={shot?.imageUrl} glyph={glyphFor(worth.worth, worth.title, money.symbol)} />
        </View>
        <View style={{ padding: 18, gap: 10 }}>
          <Text style={[type.title2, { color: p.ink }]} numberOfLines={2}>
            {worth.title}
          </Text>
          {worth.worth === "money" ? <AmountPicker cents={amountCents} namedCents={named} onChange={(c) => keep({ ...(hunts.get(id) ?? h), amount: c })} /> : <PricelessPrice line={worth.line} />}
          {h.error ? <ErrorLine>{h.error}</ErrorLine> : null}
          {listedId ? <AddedLine onPress={() => onShowOnList?.(listedId)} /> : <PrimaryButton label="Add to my list" busy={saving} onPress={() => void saveWorth(worth)} />}
          {/* The reading can be wrong ("a gold bar" is a thing to buy): hunt it as an ordinary wish instead. */}
          {listedId ? null : <QuietButton label="Price it" onPress={() => void start({ text, price: true })} style={{ alignSelf: "flex-start" }} />}
        </View>
      </Glass>
    );
  }

  // Hunting with nothing to show yet: the picture's place, held while it's made, the wish, and one line of what the
  // Dandy is doing.
  if (!option && !done && !h.error) {
    return (
      <Glass style={{ padding: 0, gap: 0, borderRadius: radius.lg, overflow: "hidden" }}>
        <View style={{ width: "100%", aspectRatio: 4 / 3 }}>
          <Photo />
          <WaitingLight active />
        </View>
        <View style={{ padding: 18, gap: 12 }}>
          <Text style={[type.title3, { fontFamily: fonts.displayItalic, color: p.ink }]} numberOfLines={2}>
            {draft?.title ?? text}
          </Text>
          {candidatePick && !guessKept ? <CandidateRow pick={candidatePick} onConfirm={() => setGuessKept(true)} onPick={(name) => void start({ text: name })} /> : null}
          <Working dandy={dandy} label={doing(h)} />
        </View>
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
      {/* The photo in its 4:3 frame; while one is still coming (or a retake looks for a better one), light crosses it. */}
      {photo || picture === "waiting" ? (
        <View style={{ width: "100%", aspectRatio: 4 / 3 }}>
          <Photo uri={photo} />
          <WaitingLight active={picture === "waiting"} />
        </View>
      ) : null}
      <View style={{ padding: 18, gap: 10 }}>
        <Text style={[type.title2, { color: p.ink }]} numberOfLines={2}>
          {draft?.title}
        </Text>
        {guessKept || listedId ? null : candidatePick ? (
          <CandidateRow pick={candidatePick} onConfirm={() => setGuessKept(true)} onPick={(name) => void start({ text: name })} />
        ) : guess ? (
          <GuessRow others={guess} onConfirm={() => setGuessKept(true)} onPick={(name) => void start({ text: name })} />
        ) : null}
        <Money cents={option.upfrontCents} size="card" />
        <Text style={[type.footnote, { color: p.ink2 }]} numberOfLines={2}>
          {option.statusLabel}
        </Text>
        {h.error ? <ErrorLine>{h.error}</ErrorLine> : null}
        {!done ? <Working dandy={dandy} label="Checking more sellers" /> : null}
        <QuietButton label={retaking ? "Finding a better photo..." : "Retake photo"} onPress={() => void retake()} style={{ alignSelf: "flex-start" }} />
        {listedId ? <AddedLine onPress={() => onShowOnList?.(listedId)} /> : <PrimaryButton label="Add to my list" busy={saving} onPress={() => void save()} />}
        {questions.length ? (
          <QuietButton
            label={refining ? "Done refining" : "Refine it"}
            onPress={() => {
              setNote(null);
              setRefining((r) => !r);
            }}
            style={{ alignSelf: "flex-start" }}
          />
        ) : null}
        {refining ? (
          <RefinePanel
            questions={questions}
            edits={h.edits}
            onEdit={(q, a) => {
              const cur = hunts.get(id) ?? h;
              keep({ ...cur, edits: { ...cur.edits, [q]: a } });
            }}
            onHunt={huntAgain}
            onClose={(line) => {
              setRefining(false);
              setNote(line);
            }}
          />
        ) : (
          <AskNote text={note} />
        )}
      </View>
    </Glass>
  );
}
