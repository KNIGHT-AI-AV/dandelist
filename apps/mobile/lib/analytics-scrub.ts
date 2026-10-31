/**
 * What leaves the web build for PostHog, made safe (review of #139): sign-in pages send nothing, and every address the
 * SDK attaches, wherever it attaches it, is cut to its origin and path, so a sign-in link's one-time ticket or any other
 * query never reaches PostHog. That covers event properties, the person properties the SDK sets once (initial and
 * session-entry addresses it keeps in its own storage), and addresses inside replay data (page records and navigation
 * events).
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

/** Any key that can hold an address: $current_url, $referrer, $initial_*, $session_entry_*, href, url and the like. */
const ADDRESS_KEY = /url|referrer|href/i;
/** Deep enough for replay data (a snapshot's data, its payload, its node attributes), shallow enough to stay cheap. */
const MAX_DEPTH = 8;

/** Cuts every address under `value`, in place, to its origin and path. */
function scrubDeep(value: unknown, depth = 0): void {
  if (!value || typeof value !== "object" || depth > MAX_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) scrubDeep(item, depth + 1);
    return;
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (typeof v === "string") {
      if (ADDRESS_KEY.test(key)) obj[key] = bareUrl(v);
    } else if (v && typeof v === "object") scrubDeep(v, depth + 1);
  }
}

/** The capture result the SDK hands before_send: properties, plus person properties it may set at the top level. */
type Captured = { properties?: Record<string, unknown>; $set?: unknown; $set_once?: unknown };

/** Every event, replays included, on its way out: dropped on the sign-in pages, and every address cut to its path. */
export function scrub<T extends Captured | null>(event: T): T | null {
  if (!event) return event;
  const props = event.properties ?? {};
  const path = typeof props.$pathname === "string" ? props.$pathname : typeof window !== "undefined" ? window.location.pathname : "";
  if (privatePath(path)) return null;
  scrubDeep(props);
  scrubDeep(event.$set);
  scrubDeep(event.$set_once);
  return event;
}
