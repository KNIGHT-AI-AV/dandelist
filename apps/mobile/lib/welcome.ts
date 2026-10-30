import { entries as catalogue, type Entry } from "@dandelist/catalogue";
import { recurringBreakdown, type Period } from "@dandelist/cost";
import { fetch as streamingFetch } from "expo/fetch";
import { Platform } from "react-native";
import type { Media, PriceOption, Step, WishQuestion, WorthCard } from "./agent";
import { API_URL } from "./auth";
import type { WishPair } from "./pairs";
import { getSecret, setSecret } from "./storage";
import type { NewWish, WishDetails, WishKind } from "./wishes";
import { photoOnly, wholeCents, type Worth } from "./worth";

/**
 * The pre-login experience, rebuilt from the owner's walkthrough (2026-10-28): what Dandelist is, then the first
 * thing someone wants (typed, said or tapped), priced for real by the agent while they play this or that from the
 * pool, then when they want it all. Everything here is kept on this device until they save it to an account; the
 * first wish, the picks and a spoken clip go to the server only to be priced, previewed and written down, and the
 * server stores none of them (the privacy page says so; keep the two in step).
 */

export type PoolGroup = "travel" | "things" | "home";

/**
 * One card from the pool (GET /guest/pool): a catalogue entry checked on its seller's page, or an archive subject; or a
 * card made from the first wish for this or that (id starting PAIR_PREFIX), priced typical like the archive's.
 */
export interface PoolItem {
  id: string;
  name: string;
  kind: WishKind;
  category: string;
  group: PoolGroup;
  upfrontCents: number;
  recurring: { label: string; amountCents: number; period: Period }[];
  status: "verified" | "estimate";
  seller: string;
  /** The page the price was checked on; empty for a typical price. */
  url: string;
  checkedAt: string;
  /** Replaces the source line, e.g. "Typical price · 7 nights for two incl. economy flights". */
  note?: string;
  credit?: string;
  media?: Entry["media"];
  imageUrl?: string;
  /** The first wish when no shop prices it: money (the amount picked) or priceless (zero, left out of every total). */
  worth?: Worth;
}

/** Ids of cards made from the first wish (the server's pairs.ts), which the pool doesn't hold. */
export const PAIR_PREFIX = "p:";
/** A card made from the first wish: the preview can't look it up in the pool, so it goes with its price. */
export const madeFromWish = (e: Pick<PoolItem, "id">) => e.id.startsWith(PAIR_PREFIX);

/** The first wish as the guest agent priced it: the best option, with where the price came from. */
export type GuestOption = Pick<PriceOption, "label" | "seller" | "url" | "upfrontCents" | "recurring" | "status" | "statusLabel" | "checkedAt" | "imageUrl" | "media" | "source">;

export interface FirstWish {
  text: string;
  title?: string;
  kind?: WishKind;
  option?: GuestOption;
  /** Research completed after sign-in, kept on this device until the account write succeeds. */
  runId?: string;
  explanation?: string;
  /** Why it couldn't be priced; it still goes on the list to price after saving. */
  failed?: string;
  /** Money itself or something priceless (lib/worth.ts): no shop prices it, so there is no option. */
  worth?: Worth;
  /** Money: the amount picked on the slider, in US cents. It starts at what the wish named. */
  amountCents?: number;
  /** Money: the amount the wish named, in US cents, when it named one; the slider reaches at least that far. */
  namedCents?: number;
  /** Priceless: the Dandy's line for it. */
  line?: string;
  /** Money: a checked photo, when one was found. */
  photo?: { imageUrl: string; media?: Media };
}

/** A first wish that is on the list: priced, money with its amount, or priceless. */
export const settled = (w: FirstWish | null | undefined): boolean => !!w && (!!w.option || w.worth === "priceless" || (w.worth === "money" && !!w.amountCents));

/** When they'd most want all of it (owner: not years; now, soon, in time, not sure). */
export type When = "now" | "soon" | "time" | "unsure";
export const WHEN_YEARS: Record<When, number | null> = { now: 1, soon: 3, time: 10, unsure: null };

export interface WelcomeState {
  v: 2;
  /** What they chose in this or that, as the pool described it then. */
  items: PoolItem[];
  wish: FirstWish | null;
  when: When | null;
  /** The preview's monthly figure; the welcome no longer asks for it (owner: "not a savings app"). */
  monthlyCents: number;
  /** Where they left the "what would it take" fader: a year's income, in cents. */
  incomeCents?: number;
  /** The one the agent suggested buying last, if they took the suggestion ("wish" for the first wish). */
  last?: string;
  /** Set when they pressed "Keep this list"; only then does it become wishes after sign-in. */
  kept?: boolean;
}

export const emptyWelcome = (): WelcomeState => ({ v: 2, items: [], wish: null, when: null, monthlyCents: 100_000 });

const KEY = "dandelist.welcome";
const SEEN = "dandelist.welcome.seen";

/** The saved list; a list saved by the earlier flow (no version) starts over rather than half-loading. */
export async function loadWelcome(): Promise<WelcomeState | null> {
  const raw = await getSecret(KEY);
  try {
    const s = raw ? (JSON.parse(raw) as Partial<WelcomeState>) : null;
    return s?.v === 2 && Array.isArray(s.items) ? (s as WelcomeState) : null;
  } catch {
    return null;
  }
}
export const saveWelcome = (s: WelcomeState | null) => setSecret(KEY, s ? JSON.stringify(s) : null);
export const seenTitle = async () => (await getSecret(SEEN)) === "1";
export const markTitleSeen = () => setSecret(SEEN, "1");

const STANDBY_CATEGORY: Record<WishKind, string> = { visit: "travel", do: "travel", own: "live", buy: "capture" };

/**
 * The first wish as a card, once it is on the list: its title, the agent's price and photos; or for money, the amount
 * picked and its photo; or for something priceless, zero, marked so every total leaves it out.
 */
export function wishCard(w: FirstWish | null): PoolItem | null {
  if (!w || !settled(w)) return null;
  const kind = w.kind ?? "buy";
  if (w.worth === "money" || w.worth === "priceless") {
    return {
      id: "wish",
      name: w.title ?? w.text,
      kind,
      category: STANDBY_CATEGORY[kind],
      group: kind === "visit" || kind === "do" ? "travel" : "things",
      upfrontCents: w.worth === "money" ? wholeCents(w.amountCents!) : 0,
      recurring: [],
      status: "estimate",
      seller: "",
      url: "",
      checkedAt: "",
      worth: w.worth,
      ...(w.photo ? { imageUrl: w.photo.imageUrl, ...(w.photo.media ? { media: w.photo.media as Entry["media"] } : {}) } : {}),
    };
  }
  const o = w.option!;
  return {
    id: "wish",
    name: w.title ?? w.text,
    kind,
    category: STANDBY_CATEGORY[kind],
    group: kind === "visit" || kind === "do" ? "travel" : "things",
    upfrontCents: o.upfrontCents,
    recurring: o.recurring.map((r) => ({ label: r.label, amountCents: r.amountCents, period: r.period })),
    status: o.status,
    seller: o.seller,
    url: o.url,
    checkedAt: o.checkedAt,
    ...(o.media ? { media: o.media as Entry["media"] } : {}),
    ...(o.imageUrl ? { imageUrl: o.imageUrl } : {}),
  };
}

/** Everything on the list so far, the first wish first. */
export const listed = (s: Pick<WelcomeState, "items" | "wish">): PoolItem[] => [...(wishCard(s.wish) ? [wishCard(s.wish)!] : []), ...s.items];
/** What the list adds up to; a priceless wish is never in it. */
export const listTotal = (s: Pick<WelcomeState, "items" | "wish">) => listed(s).reduce((n, e) => (e.worth === "priceless" ? n : n + e.upfrontCents), 0);

/** A wish no shop prices, as the list keeps it: what it is worth, and a priceless one's line. */
const worthDetails = (w: FirstWish): WishDetails => ({
  worth: w.worth,
  ...(w.worth === "priceless" && w.line ? { line: w.line.slice(0, 120) } : {}),
  // Money's gold bars, or the priceless wish's own photo (owner, 2026-10-30: "own the moon" needs "a great image").
  ...(w.photo ? { agent: photoOnly(w.photo.imageUrl, w.photo.media) } : {}),
});
export const monthlyOf = (e: Pick<PoolItem, "id" | "upfrontCents" | "recurring">) => recurringBreakdown([{ id: e.id, upfrontCents: e.upfrontCents, recurring: e.recurring }]).perMonth;

/** Turns the kept list into wishes on the new account: the first wish is a must, the rest nice to have. */
export function toWishes(s: WelcomeState): NewWish[] {
  const out: NewWish[] = [];
  const w = s.wish;
  if (w && settled(w) && (w.worth === "money" || w.worth === "priceless")) {
    out.push({
      name: w.title ?? w.text,
      kind: w.kind ?? "buy",
      tier: s.last === "wish" ? "dream" : "must",
      upfrontCents: w.worth === "money" ? wholeCents(w.amountCents!) : 0,
      recurringCents: 0,
      period: "month",
      recurring: [],
      details: worthDetails(w),
    });
  } else if (w?.option) {
    const o = w.option;
    out.push({
      name: w.title ?? w.text,
      kind: w.kind ?? "buy",
      tier: s.last === "wish" ? "dream" : "must",
      upfrontCents: o.upfrontCents,
      recurringCents: 0,
      period: "month",
      recurring: o.recurring.map((r) => ({ amountCents: r.amountCents, period: r.period, label: r.label.slice(0, 60) })),
      details: { agent: { runId: w.runId ?? "guest", seller: o.seller, url: o.url, status: o.status, checkedAt: o.checkedAt, ...(o.imageUrl ? { imageUrl: o.imageUrl } : {}), ...(o.media ? { media: o.media as Media } : {}), explanation: w.explanation ?? "", source: o.source } },
    });
  }
  for (const e of s.items) {
    const hero = e.media?.images.find((i) => !i.generated)?.url ?? e.imageUrl;
    out.push({
      name: e.name,
      kind: e.kind,
      tier: s.last === e.id ? "dream" : "nice",
      upfrontCents: e.upfrontCents,
      recurringCents: 0,
      period: "month",
      recurring: e.recurring.map((r) => ({ amountCents: r.amountCents, period: r.period, label: r.label })),
      details: {
        agent: {
          runId: e.url ? `catalogue:${e.id}` : `typical:${e.id}`,
          seller: e.seller,
          url: e.url,
          status: e.status,
          checkedAt: e.checkedAt,
          ...(hero ? { imageUrl: hero } : {}),
          ...(e.media ? { media: e.media as Media } : {}),
          explanation: "",
          source: { currency: "USD", price: e.upfrontCents / 100, rate: 1, rateDate: e.checkedAt.slice(0, 10) },
        },
      },
    });
  }
  return out;
}

/** Available immediately, while the server refreshes the pool for this or that. */
export const cataloguePool = (): PoolItem[] =>
  catalogue.map((e): PoolItem => ({ id: e.id, name: e.name, kind: e.kind, category: e.category, group: e.category === "travel" ? "travel" : e.category === "live" ? "home" : "things", upfrontCents: e.upfrontCents, recurring: e.recurring, status: e.status, seller: e.seller, url: e.url, checkedAt: e.checkedAt, media: e.media, imageUrl: e.imageUrl }));

/** The pool for this or that; the catalogue alone when the server can't be reached, so the flow never stalls. */
export async function fetchPool(signal?: AbortSignal): Promise<PoolItem[]> {
  try {
    const res = await fetch(`${API_URL}/guest/pool`, { signal });
    if (!res.ok) return cataloguePool();
    const body = (await res.json()) as { items?: PoolItem[] };
    return body.items?.length ? body.items : cataloguePool();
  } catch {
    return cataloguePool();
  }
}

/** Reads a server-sent event stream, one JSON event at a time. Phones use Expo's fetch, which can read a stream. */
async function readEvents<T>(path: string, body: unknown, onEvent: (e: T) => void, signal?: AbortSignal): Promise<void> {
  const doFetch = (Platform.OS === "web" ? fetch : streamingFetch) as typeof fetch;
  const res = await doFetch(`${API_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const b = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(b?.error ?? "That couldn't start just now. Try again in a moment.");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const data = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (data) onEvent(JSON.parse(data) as T);
    }
  }
}

/**
 * The guest hunt's events. A draft may come twice (again when its questions land); a card may too: first the fast one
 * (`provisional`, about 10 to 15 s in), then the full research's when it found better, by 60 s.
 */
export type GuestEvent =
  | { type: "draft"; title: string; kind: WishKind; questions?: WishQuestion[] }
  | { type: "step"; step: Step }
  | { type: "priced"; title: string; kind: WishKind; option: PriceOption; explanation: string; questions?: WishQuestion[]; provisional?: boolean }
  /**
   * Money itself or something priceless: no hunt. The server follows it with an error event for apps that predate
   * it; once this has come, that error is not a failure.
   */
  | ({ type: "worth" } & WorthCard)
  /** A money wish's checked photo, when one is found in time. */
  | { type: "photo"; imageUrl: string; media?: Media }
  /** This or that made from the wish, when asked for: it can come before or after the card, or not at all. */
  | { type: "pairs"; pairs: WishPair[] }
  | { type: "error"; message: string };

/**
 * Prices the first wish for real, before sign-in: what it is, the agent's live trail, then the best option. `price` is
 * a money or priceless card's "Price it": the words are hunted as an ordinary priced wish. `pairs` asks for this or
 * that made from the same words, on the same stream, while the wish is priced.
 */
export const streamGuestWish = (text: string, onEvent: (e: GuestEvent) => void, signal?: AbortSignal, price = false, pairs = false) =>
  readEvents<GuestEvent>("/guest/wish", { text, ...(price ? { price: true } : {}), ...(pairs ? { pairs: true } : {}) }, onEvent, signal);

export type PreviewEvent =
  | { type: "row"; id: string; state: "running" | "done"; text: string }
  | { type: "note"; text: string }
  | { type: "result"; upfrontCents: number; monthlyRunningCents: number; everythingBy: string; largest: { name: string; share: number; restBy: string } | null };

/**
 * The first wish as the preview prices it: as priced, or money at the amount picked. A priceless one is left out of
 * the sums, so it sends nothing.
 */
export function previewExtra(w: FirstWish | null): { name: string; upfrontCents: number; recurring: { label: string; amountCents: number; period: Period }[] } | null {
  if (!w || w.worth === "priceless") return null;
  const name = (w.title ?? w.text).slice(0, 120);
  const whole = (cents: number) => Math.max(100, Math.round(cents / 100) * 100);
  if (w.worth === "money") return w.amountCents ? { name, upfrontCents: whole(w.amountCents), recurring: [] } : null;
  const o = w.option;
  return o ? { name, upfrontCents: whole(o.upfrontCents), recurring: o.recurring.slice(0, 6).map((r) => ({ label: r.label.slice(0, 60), amountCents: r.amountCents, period: r.period })) } : null;
}

/**
 * Streams the agent's real work on the whole list: the pool picks by id, the first wish as priced, and the cards made
 * from it with their prices (the pool doesn't hold those, so by id they would be left out of the sum).
 */
export function streamPreview(s: WelcomeState, onEvent: (e: PreviewEvent) => void, signal?: AbortSignal): Promise<void> {
  const extra = previewExtra(s.wish);
  // Nothing on the list has a price (a priceless first wish, nothing picked): the list comes to nothing to add up.
  if (!s.items.length && !extra) {
    onEvent({ type: "result", upfrontCents: 0, monthlyRunningCents: 0, everythingBy: "", largest: null });
    return Promise.resolve();
  }
  const made = s.items.filter(madeFromWish);
  return readEvents<PreviewEvent>(
    "/preview",
    {
      picks: s.items.filter((e) => !madeFromWish(e)).map((e) => e.id),
      ...(made.length ? { extras: made.map((e) => ({ name: e.name.slice(0, 120), upfrontCents: Math.max(1, Math.round(e.upfrontCents)), recurring: e.recurring.slice(0, 6).map((r) => ({ label: r.label.slice(0, 60), amountCents: r.amountCents, period: r.period })) })) } : {}),
      ...(extra ? { extra } : {}),
      monthlyCents: s.monthlyCents,
      horizonYears: s.when ? WHEN_YEARS[s.when] : null,
    },
    onEvent,
    signal,
  );
}

/** Say the first wish before an account exists: the guest route, capped per network address. */
export async function transcribeGuest(wav: Uint8Array): Promise<string> {
  const res = await fetch(`${API_URL}/guest/transcribe`, { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav as unknown as BodyInit }).catch(() => null);
  if (!res) throw new Error("Can't reach Dandelist. Check your connection.");
  const body = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
  if (!res.ok || !body?.text) throw new Error(body?.error ?? "Couldn't hear that. Try again, or type it.");
  return body.text;
}

/** Log scale for the list meter: $1k is empty, $1M is full, so a camera and a car both register. */
export function meterFraction(cents: number): number {
  const dollars = cents / 100;
  if (dollars <= 1000) return dollars > 0 ? 0.04 : 0;
  return Math.min(1, Math.log10(dollars / 1000) / 3);
}

/** The month a total is reached saving `monthlyCents` a month from now. */
export function reachBy(cents: number, monthlyCents: number, now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth() + Math.ceil(cents / monthlyCents), 1);
}
export const monthYearLong = (d: Date) => d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short" });
export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
