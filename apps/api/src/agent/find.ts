import {
  HORIZON_YEARS,
  applyAnswers,
  asPriced,
  explainFacts,
  fallbackExplanation,
  interpret,
  pickQuestions,
  research,
  unpriced,
  type Answer,
  type Draft,
  type Meta,
  type PriceOption,
  type ResearchContext,
  type ResearchResult,
  type WishQuestion,
} from "./agent";
import { SpendLimitError } from "../spend";
import { estimateCard } from "./estimate";
import { clip, withLine } from "./lines";
import type { MediaImage } from "./media";
import { fallbackPlan, findPhoto, photoPlan, subjectOf, verifyPhoto, type FoundPhoto } from "./photos";
import { QUICK_MS, mediaKindOf, quickFind, subjectPhoto } from "./quick";
import { within } from "./time";
import { publicFetch } from "./tools";
import { worthCard, type WorthCard } from "./worth";

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
  /**
   * Money itself, or something priceless (agent.ts WORTHS): no shop prices it, so no hunt ran and `options` is empty.
   * The caller shows this card instead and stops whatever started beside the reading.
   */
  worth?: WorthCard;
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
  /** Price it anyway (a money or priceless card's "Price it"): hunt it as an ordinary priced wish, whatever it reads as. */
  price?: boolean;
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
 * best card always carries a photograph (owner, 2026-10-29: "Photos must always come"): the fast card's, else
 * `standIn` (the archive's, or a trip's place), else `found`, the photo search's checked pick for this wish.
 */
export function mergeFast(draft: Draft, researched: ResearchResult | null, fast: PriceOption | null, standIn: MediaImage | null = null, found: FoundPhoto | null = null): ResearchResult {
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
    } else if (found) withPhoto(best, found);
  }
  return { options: options.slice(0, 4), explanation, note: researched?.note ?? "", horizonYears: researched?.horizonYears ?? HORIZON_YEARS };
}

/** A questions call that failed leaves the card without questions; the hunt itself goes on. */
function questionsFailed(e: unknown): WishQuestion[] {
  console.warn("questions failed", (e as Error).message);
  return [];
}

/** Puts a found photo on an option that has none. */
function withPhoto(o: PriceOption, found: FoundPhoto) {
  o.imageUrl = found.image.url;
  o.media = { kind: found.kind, images: [found.image] };
}

export async function huntWish(meta: Meta, ctx: HuntContext): Promise<HuntResult> {
  const t0 = ctx.startedAt ?? Date.now();
  const home = (ctx.homeCurrency ?? "USD").toUpperCase();
  const fetcher = ctx.fetcher ?? publicFetch;
  const given = ctx.answers ?? [];
  const priced = (d: Draft) => (ctx.price ? asPriced(d) : d);
  const known = ctx.draft ? withAnswers(priced(ctx.draft), given) : null;
  // A reading that fails on the network ("fetch failed", twice in ten live hunts on 2026-10-30) is tried once more
  // before the wish fails; a spend cap is final.
  const readWish = () => interpret(meta, ctx.text ?? "");
  const readTwice = () => readWish().catch((e: unknown) => (e instanceof SpendLimitError ? Promise.reject(e) : new Promise<void>((r) => setTimeout(r, 800)).then(readWish)));
  const reading: Promise<{ draft: Draft; extra: Answer[] }> = known ? Promise.resolve(known) : readTwice().then((d) => withAnswers(priced(d), given));
  reading.catch(() => undefined);
  // The questions start at once from the person's own words, beside reading the wish, so they are usually in hand
  // before the research starts and it prices their picks; nothing ever waits for them. A re-hunt brings its own.
  const fromWords = !known && !!ctx.text?.trim();
  const asking: Promise<WishQuestion[]> | null = fromWords ? pickQuestions(meta, { text: ctx.text, homeCurrency: home }, ctx.now()).catch(questionsFailed) : null;

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

  // Answers the person already gave count against the questions as soon as they land.
  const held: { questions: WishQuestion[] | null } = { questions: null };
  const fromStart = asking?.then((qs) => (held.questions = applyAnswers(qs, given).questions));

  const read = await reading; // a wish that can't be read fails here, as it always has
  const extra = read.extra;
  let draft = read.draft;
  // Money itself or something priceless: no shop has a price for it, so nothing is hunted or asked. The fast find
  // and the questions that started beside the reading are dropped; the caller's stop ends any call still running.
  if (unpriced(draft)) {
    await ctx.onDraft?.(draft);
    const worth = await worthCard(draft, fetcher);
    if (worth) return { options: [], explanation: "", note: "", horizonYears: HORIZON_YEARS, draft, questions: [], provisional: false, worth };
  }
  // Questions already in hand go on the draft before the research reads it, so the hunt prices their picks.
  if (held.questions?.length) draft = { ...draft, questions: held.questions };
  await ctx.onDraft?.(draft);
  // The live line names what the wish was understood as, not the words as typed (owner, 2026-10-30).
  await ctx.onStep?.(withLine({ type: "note", text: `Hunting for ${clip(draft.title, 48)}`, at: ctx.now().toISOString() }));
  // The last word, should nothing else price in time (owner, 2026-10-30: "It needs to work every single time"): when
  // the fast card hasn't landed by its own deadline, one search for the understood name's typical price, shown as an
  // estimate with its source. It costs one search, and only on hunts that would otherwise come back empty.
  const lastWord = quick.then((q) => (q ? null : estimateCard(meta, draft, { home, fetcher, by: t0 + HUNT_STOP_MS - 4_000 }))).catch(() => null);
  lastWord.catch(() => undefined);

  // The questions are their own small call beside the research, so nothing waits on them; a re-hunt brings its own.
  const asked: Promise<WishQuestion[]> = known
    ? Promise.resolve(draft.questions ?? [])
    : (fromStart ?? pickQuestions(meta, { draft, homeCurrency: home }, ctx.now()).then((qs) => applyAnswers(qs, given).questions)).catch(questionsFailed);
  const settledQuestions = asked.then(async (qs) => {
    if (!known && qs.length && draft.questions !== qs) {
      draft = { ...draft, questions: qs };
      await ctx.onDraft?.(draft);
    }
    return qs;
  });
  settledQuestions.catch(() => undefined);
  const questionsBy = async (ms: number) => (await within(settledQuestions, ms)) ?? draft.questions ?? [];
  // A photo of the wish itself. Only a photo the vision checks passed goes on a card (owner, 2026-10-29, shown a
  // Sky-Dweller wearing an Oyster Perpetual: "That can not happen", "Not any photo will do!!"): the hunt's own pick,
  // or any other photo once it has passed the same two checks. One plan serves the hunt and those checks; the page the
  // fast card was priced on joins the hunt, since its own product photo is usually the very thing.
  const subject = subjectOf(draft);
  const planned = photoPlan(meta, subject).catch(() => fallbackPlan(subject));
  const standIn = subjectPhoto(draft, { archive: ctx.archive, api: fetcher, by: t0 + RESEARCH_MS }).catch(() => null);
  const searched = findPhoto(meta, subject, { fetcher, by: t0 + RESEARCH_MS, plan: planned, pages: quick.then((q) => (q?.url ? [q.url] : [])) }).catch(() => null);
  const passed = new Map<string, Promise<boolean>>();
  const stands = (url: string) => {
    let p = passed.get(url);
    if (!p) passed.set(url, (p = planned.then((plan) => verifyPhoto(meta, url, plan, { fetcher })).then((v) => v.ok, () => false)));
    return p;
  };
  searched.then((f) => f && passed.set(f.image.url, Promise.resolve(true)));

  const card: { fast: PriceOption | null; estimate: boolean; settled: boolean; told: Promise<void> } = { fast: null, estimate: false, settled: false, told: Promise.resolve() };
  const tell = (q: PriceOption) => {
    card.fast = q;
    card.told = (async () => {
      // The hunt's checked pick first; else the card's own photo (its page's, or a stand-in) once it passes the
      // checks; else no photo yet, and the full card brings the hunt's.
      const own = q.imageUrl;
      const [found, ownOk] = await Promise.all([within(searched, 5_000), own ? within(stands(own), 5_000) : Promise.resolve(null)]);
      if (found) withPhoto(q, found);
      else if (!own || !ownOk) {
        const stand = await within(standIn, 500);
        if (stand && stand.url !== own && (await within(stands(stand.url), 4_000))) {
          q.imageUrl = stand.url;
          q.media = { kind: mediaKindOf(draft)[0]!, images: [stand] };
        } else {
          delete q.imageUrl;
          delete q.media;
        }
      }
      const questions = await questionsBy(2_000);
      await ctx.onProvisional?.({ options: [q], explanation: "", note: "", horizonYears: HORIZON_YEARS, draft, questions, provisional: true });
    })().then(
      () => undefined,
      (e) => console.error("could not send the fast card", e),
    );
  };
  const early = quick.then((q) => {
    if (q && !card.settled) tell(q);
  });
  // The last word shows the moment it lands, rather than after the research gives up a minute in.
  void lastWord.then((e) => {
    if (e && !card.settled && !card.fast) {
      card.estimate = true;
      tell(e);
    }
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
  // Nothing else priced: the last word stands in, labelled an estimate with its source, rather than no card at all.
  if (!card.fast && (failure || !researched?.options.length)) {
    const estimate = await within(lastWord, Math.max(0, t0 + HUNT_STOP_MS - 3_000 - Date.now()));
    if (estimate) {
      card.fast = estimate;
      card.estimate = true;
    }
  }
  if (failure && !card.fast) throw failure;
  if (failure) console.warn(`research failed; the ${card.estimate ? "estimate" : "fast card"} stands`, (failure as Error).message);
  const questions = await questionsBy(Math.max(0, t0 + HUNT_STOP_MS - 2_000 - Date.now()));
  const [photo, found] = await Promise.all([within(standIn, Math.max(0, t0 + HUNT_STOP_MS - 2_000 - Date.now())), within(searched, Math.max(0, t0 + HUNT_STOP_MS - 2_000 - Date.now()))]);
  // The last word only stands in: research that priced the wish replaces it rather than sitting beside it.
  const merged = mergeFast(draft, researched, card.estimate && researched?.options.length ? null : card.fast, photo, found);
  // The full card's photo passes the checks too: the hunt's pick for a thing or a trip (one model looks the same from
  // any seller); a listing's own photo for a home or a service, when it passes; otherwise none.
  const best = merged.options[0];
  if (best) {
    if (found && (!best.imageUrl || photoTravels(draft, best))) withPhoto(best, found);
    else if (best.imageUrl && !(await within(stands(best.imageUrl), Math.max(0, t0 + HUNT_STOP_MS - 1_500 - Date.now())))) {
      if (found) withPhoto(best, found);
      else {
        delete best.imageUrl;
        delete best.media;
      }
    }
  }
  return { ...merged, draft: { ...draft, questions }, questions, provisional: false };
}
