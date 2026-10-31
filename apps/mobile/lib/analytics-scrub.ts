/**
 * What leaves the web build for PostHog, made safe (review of #139): sign-in pages send nothing, and every address is
 * cut to its origin and path, so a sign-in link's one-time ticket or any other query never reaches PostHog.
 */

/** Sign-in pages carry one-time tickets: nothing is captured or recorded while one is open. */
export const privatePath = (path: string) => /^\/auth(\/|$)/.test(path);

/** An address cut to its origin and path: no query, no fragment. */
export function bareUrl(value: unknown): unknown {
  if (typeof value !== "string" || !value) return value;
  try {
    const u = new URL(value);
    return `${u.origin}${u.pathname}`;
  } catch {
    return value.split(/[?#]/)[0];
  }
}

const URL_KEYS = ["$current_url", "$referrer", "$initial_referrer", "$initial_current_url", "$prev_pageview_url", "url", "href"];

/** Every event, replays included, on its way out: dropped on the sign-in pages, and every address cut to its path. */
export function scrub<T extends { properties?: Record<string, unknown> } | null>(event: T): T | null {
  if (!event) return event;
  const props = event.properties ?? {};
  const path = typeof props.$pathname === "string" ? props.$pathname : typeof window !== "undefined" ? window.location.pathname : "";
  if (privatePath(path)) return null;
  for (const key of URL_KEYS) if (key in props) props[key] = bareUrl(props[key]);
  for (const key of Object.keys(props)) if (key.startsWith("$set") && props[key] && typeof props[key] === "object") for (const k of URL_KEYS) if (k in (props[key] as Record<string, unknown>)) (props[key] as Record<string, unknown>)[k] = bareUrl((props[key] as Record<string, unknown>)[k]);
  // A replay's own page records (rrweb's meta events, type 4) carry the address too.
  const snaps = props.$snapshot_data;
  if (Array.isArray(snaps)) for (const snap of snaps) if (snap && typeof snap === "object" && (snap as { type?: number }).type === 4) {
    const data = (snap as { data?: { href?: unknown } }).data;
    if (data && "href" in data) data.href = bareUrl(data.href);
  }
  return event;
}

