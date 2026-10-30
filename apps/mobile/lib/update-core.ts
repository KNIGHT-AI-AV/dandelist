/**
 * The update prompt's rules, with no React Native in them so tests can check them (owner, 2026-10-30: "a nice little
 * pop-up when they first log in or get onto the app ... And if they deny it, then the next time they go to the app,
 * it'll prompt them again"). `updater` comes from update.native.ts on phones and update.ts on the web, and
 * components/update-prompt.tsx shows the prompt.
 *
 * One file says what is newest: latest.json, served with the web app from apps/mobile/public, so publishing it is a
 * web deploy and never an API release:
 *
 *   { "ios": { "build": 21, "url": "<TestFlight's public link now, the App Store later>" },
 *     "android": { "build": 14, "url": "<the APK>" },
 *     "web": { "version": "<written by scripts/deploy-web.mjs>" } }
 *
 * Raise a phone's build (and its url) only once that build can be installed from the url: a TestFlight build after
 * Apple's beta review, an APK once it is uploaded. scripts/deploy-web.mjs writes web.version, the commit the deployed
 * bundle was built from, which the bundle itself carries as EXPO_PUBLIC_WEB_VERSION.
 *
 * A phone whose own build is lower than its platform's entry is offered the url; a web page whose bundle version
 * differs from web.version is offered a reload. The check runs once a visit: at launch, and when the app comes back
 * after AWAY_MS or more in the background. iOS often resumes a suspended app rather than launching it again, and that
 * is still "the next time they go to the app". "Later" closes the prompt for the rest of the visit.
 */

export type Os = "ios" | "android";

/** What runs here: a phone's build number, or the commit the web bundle was built from. */
export type Running = { platform: Os; build: number } | { platform: "web"; version: string };

export interface StoreEntry {
  build: number;
  url: string;
}

export interface Latest {
  ios: StoreEntry | null;
  android: StoreEntry | null;
  web: { version: string } | null;
}

/** An update to offer. `target` names what it leads to, so the web never offers a reload that already failed to help. */
export type Offer = { kind: "store"; url: string; target: string } | { kind: "reload"; target: string };

/** What each platform runs, where it reads latest.json and how it takes someone to the update. */
export interface Updater {
  /** What runs here, or null where nothing is offered (development builds, Expo Go, a web build without a version). */
  running: Running | null;
  /** latest.json's address. */
  source: string;
  /** The reload this browser tab already tried (web only), so a reload that changed nothing doesn't ask again. */
  tried(): string | null;
  /** Goes to the update: the store link on a phone, a reload on the web. */
  go(offer: Offer): void;
}

/** A build number from a number or a string of digits ("21"); null for anything else, zero included. */
export function buildNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : Number.NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** The button only ever opens a web address, whatever the file says. */
const HTTPS = /^https:\/\/[^\s"'<>\\]+$/i;

function storeEntry(v: unknown): StoreEntry | null {
  if (!v || typeof v !== "object") return null;
  const { build, url } = v as Record<string, unknown>;
  const b = buildNumber(build);
  return b !== null && typeof url === "string" && HTTPS.test(url.trim()) ? { build: b, url: url.trim() } : null;
}

/**
 * latest.json as data. An entry without a whole build and an https link is left out, and so is a web entry without a
 * version, so an empty url means that platform is never asked.
 */
export function parseLatest(raw: unknown): Latest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const web = o.web && typeof o.web === "object" ? (o.web as Record<string, unknown>).version : undefined;
  return { ios: storeEntry(o.ios), android: storeEntry(o.android), web: typeof web === "string" && web.trim() ? { version: web.trim() } : null };
}

/**
 * The update to offer, if any. A phone is offered only a strictly higher build of its own platform, never an equal or
 * older one. The web is offered any other version, because a reload can only fetch what is deployed, unless this tab
 * already reloaded for that version (`tried`) and still runs the old bundle.
 */
export function offerFor(running: Running, latest: Latest | null, tried: string | null = null): Offer | null {
  if (!latest) return null;
  if (running.platform === "web") {
    const v = latest.web?.version;
    const target = `web:${v}`;
    return v && v !== running.version && target !== tried ? { kind: "reload", target } : null;
  }
  const entry = latest[running.platform];
  return entry && entry.build > running.build ? { kind: "store", url: entry.url, target: `${running.platform}:${entry.build}` } : null;
}

/** How long the check may take before it counts as no answer. */
export const CHECK_TIMEOUT_MS = 5000;

/** The slice of fetch the check uses, so tests can stand in for it. */
export type Get = (url: string, init: { cache: "no-store"; signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** Reads latest.json past every cache. Null on any failure (offline, slow, missing, not JSON); never throws. */
export async function fetchLatest(url: string, get: Get = (u, init) => fetch(u, init), timeoutMs = CHECK_TIMEOUT_MS): Promise<Latest | null> {
  const abort = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      abort?.abort();
      resolve(null);
    }, timeoutMs);
  });
  const read = (async () => {
    const res = await get(url, { cache: "no-store", signal: abort?.signal });
    return res.ok ? parseLatest(await res.json()) : null;
  })().catch(() => null);
  try {
    return await Promise.race([read, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** This long in the background and the app counts as opened anew: it checks again, and an earlier "Later" is gone. */
export const AWAY_MS = 30 * 60_000;

export interface Prompt {
  /** 1 at launch, and one more each time the app comes back after AWAY_MS or more in the background. */
  visit: number;
  /** When the app went to the background, or null while it is in front. */
  awaySince: number | null;
  /** This visit's answer from latest.json: the update to offer, or null (nothing newer, no answer yet, a failed check). */
  offer: Offer | null;
  /** The visit in which the person chose Later or Update; the prompt stays closed for the rest of it. */
  answeredIn: number | null;
}

export type PromptEvent =
  | { type: "background"; at: number }
  | { type: "active"; at: number }
  | { type: "checked"; visit: number; offer: Offer | null }
  | { type: "answered" };

/** Every launch starts here, with nothing answered: a "Later" from the last launch is gone. */
export const LAUNCH: Prompt = { visit: 1, awaySince: null, offer: null, answeredIn: null };

export function promptStep(s: Prompt, e: PromptEvent): Prompt {
  switch (e.type) {
    case "background":
      return s.awaySince === null ? { ...s, awaySince: e.at } : s;
    case "active":
      if (s.awaySince === null) return s;
      // A short trip away is the same visit. A long one is a new visit, which waits for its own check.
      return e.at - s.awaySince >= AWAY_MS ? { ...s, visit: s.visit + 1, awaySince: null, offer: null } : { ...s, awaySince: null };
    case "checked":
      // An answer that arrives after its visit ended is stale.
      return e.visit === s.visit ? { ...s, offer: e.offer } : s;
    case "answered":
      return { ...s, answeredIn: s.visit };
  }
}

/** Whether there is an update to offer and the person hasn't answered it this visit. The screen decides the moment. */
export function promptDue(s: Prompt): boolean {
  return s.offer !== null && s.answeredIn !== s.visit;
}
