import {
  HORIZON_YEARS,
  applyAnswers,
  explainFacts,
  fallbackExplanation,
  interpret,
  pickQuestions,
  research,
  type Answer,
  type Draft,
  type Meta,
  type PriceOption,
  type ResearchContext,
  type ResearchResult,
  type WishQuestion,
} from "./agent";
import type { MediaImage } from "./media";
import { QUICK_MS, mediaKindOf, quickFind, subjectPhoto } from "./quick";
import { within } from "./time";
import { publicFetch } from "./tools";

/**
 * One hunt for one wish, the way every caller runs it: the guest's first wish (SSE), a signed-in run (polled) and the
 * chat's item hunt (a run). The draft is read while a fast find already searches the person's own words; its card
 * goes out the moment it is ready (in about 10 to 15 s) and the full research keeps going beside it. Questions never
 * wait for an answer: a small call beside the research picks the likely one for each, and the card carries the
 * questions so the person can change an answer, or type their own, and hunt again.
 */

/** Everything stops by then (owner, 2026-10-29). App Runner cuts a request at 120 s; this is well inside it. */
export const HUNT_STOP_MS = 60_000;
/** When the research hands back its best, leaving room to send it before the stop. */
export const RESEARCH_MS = 54_000;

export interface HuntResult extends ResearchResult {
  draft: Draft;
  /** Each question with the answer this hunt used: the person's own (`answered`), or the agent's pick. */
  questions: WishQuestion[];
  /** True only for the fast card, which the full research may still replace. */
  provisional: boolean;
}

export interface HuntContext extends Omit<ResearchContext, "draft" | "answers" | "deadline"> {
  /** What the person said; read into a draft here unless a draft comes with it. */
  text?: string;
  /** A draft read before (hunting again with new answers): no second read, and the fast find uses its answers. */
  draft?: Draft;
  /** Answers by question id or by the question's words; free text is fine. Others count as extra details. */
  answers?: Answer[];
  /** When the hunt began (epoch ms); every deadline counts from it. Defaults to now. */
  startedAt?: number;
  onDraft?: (draft: Draft) => Promise<void> | void;
  /** The fast card, as soon as it is ready, while the full research carries on. */
  onProvisional?: (result: HuntResult) => Promise<void> | void;
}

/** The draft with every question answered, by the person or by the agent's pick, and the answers left over. */
export function withAnswers(draft: Draft, answers: Answer[]): { draft: Draft; extra: Answer[] } {
  const { questions, extra } = applyAnswers(draft.questions ?? [], answers);
  return { draft: { ...draft, questions }, extra };
}

/** Page-checked first, then a merchant's listing, then an estimate, then a price seen on someone else's site. */
const standing = (o: PriceOption) => (o.status === "verified" ? 3 : o.listing ? 2 : o.statusLabel.startsWith("Estimate: seen on") ? 0 : 1);
const samePage = (a: string, b: string) => a.replace(/[?#].*$/, "").replace(/\/+$/, "") === b.replace(/[?#].*$/, "").replace(/\/+$/, "");

/**
 * A photo of this very thing may stand on another option's card: one watch or car model looks the same from any
 * seller, and a trip shows its place. A home or a service is a different thing on every listing, so never.
 */
const photoTravels = (draft: Draft, photo: { media?: { kind: string } }) => draft.kind === "buy" || draft.kind === "visit" || (draft.kind === "own" && photo.media?.kind === "vehicle");

/**
 * The research's options with the fast card among them: first when it is better checked, otherwise after them. The
 * best card always carries a photograph when one of the wish itself is known (the fast card's, or `standIn`: the
 * archive's, or a trip's place), and never one of something else.
 */
export function mergeFast(draft: Draft, researched: ResearchResult | null, fast: PriceOption | null, standIn: MediaImage | null = null): ResearchResult {
  const options = [...(researched?.options ?? [])];
  let explanation = researched?.explanation ?? "";
  if (fast) {
    const top = options[0];
    if (!top || standing(fast) > standing(top)) {
      options.unshift(fast);
      if (options.length > 1) explanation = fallbackExplanation(explainFacts(draft, options));
    } else if (options.length < 4 && !options.some((o) => samePage(o.url, fast.url))) options.push(fast);
  }
  const best = options[0];
  // A car's photo is the model itself, the same from any seller.
  const vehicle = draft.kind === "own" && mediaKindOf(draft)[0] === "vehicle";
  if (best && !best.imageUrl) {
    if (fast && best !== fast && fast.imageUrl && photoTravels(draft, fast)) {
      best.imageUrl = fast.imageUrl;
      if (fast.media) best.media = fast.media;
    } else if (standIn && (draft.kind === "visit" || draft.kind === "buy" || draft.kind === "do" || vehicle)) {
      best.imageUrl = standIn.url;
      best.media = { kind: draft.kind === "visit" ? "place" : draft.kind === "do" ? "experience" : vehicle ? "vehicle" : "product", images: [standIn] };
    }
  }
  return { options: options.slice(0, 4), explanation, note: researched?.note ?? "", horizonYears: researched?.horizonYears ?? HORIZON_YEARS };
}

export async function huntWish(meta: Meta, ctx: HuntContext): Promise<HuntResult> {
  const t0 = ctx.startedAt ?? Date.now();
  const home = (ctx.homeCurrency ?? "USD").toUpperCase();
  const fetcher = ctx.fetcher ?? publicFetch;
  const given = ctx.answers ?? [];
  const known = ctx.draft ? withAnswers(ctx.draft, given) : null;
  const reading: Promise<{ draft: Draft; extra: Answer[] }> = known ? Promise.resolve(known) : interpret(meta, ctx.text ?? "").then((d) => withAnswers(d, given));
  reading.catch(() => undefined);

  // The fast find starts on the person's own words at once; the draft joins it when it lands.
  const words = ctx.text?.trim() || (known ? `${known.draft.title}. ${known.draft.summary}` : "");
  const details = known
    ? [...(known.draft.questions ?? []).map((q) => `${q.label} ${q.picked}`), ...known.extra.map((a) => `${a.question} ${a.answer}`)]
    : given.map((a) => `${a.question} ${a.answer}`);
  const quick = quickFind(
    meta,
    { words, draft: reading.then((r) => r.draft).catch(() => null), details, homeCurrency: home },
    { fetcher, now: ctx.now, onStep: ctx.onStep, archive: ctx.archive, by: t0 + QUICK_MS },
  ).catch((e) => {
    console.warn("fast find failed", (e as Error).message);
    return null;
  });

  const read = await reading; // a wish that can't be read fails here, as it always has
  const extra = read.extra;
  let draft = read.draft;
  await ctx.onDraft?.(draft);

  // The questions are their own small call beside the research, so nothing waits on them; a re-hunt brings its own.
  const asked: Promise<WishQuestion[]> = known
    ? Promise.resolve(draft.questions ?? [])
    : pickQuestions(meta, draft)
        .then((qs) => applyAnswers(qs, given).questions)
        .catch((e) => {
          console.warn("questions failed", (e as Error).message);
          return [];
        });
  const settledQuestions = asked.then(async (qs) => {
    if (!known && qs.length) {
      draft = { ...draft, questions: qs };
      await ctx.onDraft?.(draft);
    }
    return qs;
  });
  settledQuestions.catch(() => undefined);
  const questionsBy = async (ms: number) => (await within(settledQuestions, ms)) ?? draft.questions ?? [];
  // A photo of the wish itself, for a card the research finds without one.
  const standIn = subjectPhoto(draft, { archive: ctx.archive, api: fetcher, by: t0 + RESEARCH_MS }).catch(() => null);

  const card: { fast: PriceOption | null; settled: boolean; told: Promise<void> } = { fast: null, settled: false, told: Promise.resolve() };
  const early = quick.then((q) => {
    if (!q || card.settled) return;
    card.fast = q;
    card.told = (async () => {
      const questions = await questionsBy(2_000);
      await ctx.onProvisional?.({ options: [q], explanation: "", note: "", horizonYears: HORIZON_YEARS, draft, questions, provisional: true });
    })().then(
      () => undefined,
      (e) => console.error("could not send the fast card", e),
    );
  });

  let researched: ResearchResult | null = null;
  let failure: unknown = null;
  try {
    researched = await research(meta, { ...ctx, fetcher, draft, answers: extra, deadline: t0 + RESEARCH_MS });
  } catch (e) {
    failure = e;
  }
  // Research that ends early still gives the fast card until its own deadline.
  await within(early, t0 + QUICK_MS - Date.now());
  card.settled = true;
  await card.told;
  if (failure && !card.fast) throw failure;
  if (failure) console.warn("research failed; the fast card stands", (failure as Error).message);
  const questions = await questionsBy(Math.max(0, t0 + HUNT_STOP_MS - 2_000 - Date.now()));
  const photo = await within(standIn, Math.max(0, t0 + HUNT_STOP_MS - 2_000 - Date.now()));
  return { ...mergeFast(draft, researched, card.fast, photo), draft: { ...draft, questions }, questions, provisional: false };
}
