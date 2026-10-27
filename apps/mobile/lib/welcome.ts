import { entry, type Entry, heroOf, toItem } from "@dandelist/catalogue";
import { fetch as streamingFetch } from "expo/fetch";
import { Platform } from "react-native";
import { API_URL } from "./auth";
import { getSecret, setSecret } from "./storage";
import type { NewWish } from "./wishes";

/** What someone builds before signing in. It stays on this device until they save it to an account. */
export interface WelcomeState {
  picks: string[];
  horizonYears: number | null;
  monthlyCents: number;
  /** A pick the agent suggested buying last, if they took the suggestion. */
  last?: string;
  /** Set when they pressed "Keep this life"; only then do the picks become wishes after sign-in. */
  kept?: boolean;
}

const KEY = "dandelist.welcome";
const SEEN = "dandelist.welcome.seen";

export async function loadWelcome(): Promise<WelcomeState | null> {
  const raw = await getSecret(KEY);
  try {
    return raw ? (JSON.parse(raw) as WelcomeState) : null;
  } catch {
    return null;
  }
}
export const saveWelcome = (s: WelcomeState | null) => setSecret(KEY, s ? JSON.stringify(s) : null);
export const seenTitle = async () => (await getSecret(SEEN)) === "1";
export const markTitleSeen = () => setSecret(SEEN, "1");

export const picked = (s: Pick<WelcomeState, "picks">): Entry[] => s.picks.map(entry).filter((e): e is Entry => !!e);

/** Turns the pre-login picks into wishes on the new account, with the agent's source kept on each one. */
export function toWishes(s: WelcomeState): NewWish[] {
  return picked(s).map((e) => ({
    name: e.name,
    kind: e.kind,
    tier: e.id === s.last ? "dream" : "must",
    upfrontCents: e.upfrontCents,
    recurringCents: 0,
    period: "month",
    recurring: toItem(e).recurring.map((r) => ({ amountCents: r.amountCents, period: r.period, label: r.label })),
    details: {
      agent: {
        runId: `catalogue:${e.id}`,
        seller: e.seller,
        url: e.url,
        status: e.status,
        checkedAt: e.checkedAt,
        ...(heroOf(e) ? { imageUrl: heroOf(e) } : {}),
        ...(e.media ? { media: e.media } : {}),
        explanation: "",
        source: { currency: "USD", price: e.upfrontCents / 100, rate: 1, rateDate: e.checkedAt.slice(0, 10) },
      },
    },
  }));
}

export type PreviewEvent =
  | { type: "row"; id: string; state: "running" | "done"; text: string }
  | { type: "note"; text: string }
  | { type: "result"; upfrontCents: number; monthlyRunningCents: number; everythingBy: string; largest: { name: string; share: number; restBy: string } | null };

/**
 * Streams the agent's real work for these picks. Each event arrives when the server has done that step; the
 * phone build uses Expo's streaming fetch because React Native's own fetch can't read a stream.
 */
export async function streamPreview(s: WelcomeState, onEvent: (e: PreviewEvent) => void, signal?: AbortSignal): Promise<void> {
  const doFetch = (Platform.OS === "web" ? fetch : streamingFetch) as typeof fetch;
  const res = await doFetch(`${API_URL}/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ picks: s.picks, monthlyCents: s.monthlyCents, horizonYears: s.horizonYears }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "The agent couldn't start just now.");
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
      if (data) onEvent(JSON.parse(data) as PreviewEvent);
    }
  }
}

/** Log scale for the Life meter: $1k is empty, $1M is full, so a camera and a car both register. */
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
