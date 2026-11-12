import { Stack, useGlobalSearchParams, usePathname, useSegments } from "expo-router";
import type { ReactNode } from "react";
import { appOpen, useAccountConsent } from "../lib/account-consent";
import { useAuth } from "../lib/auth";
import { usePalette } from "../lib/theme";

/**
 * Every route in app/, by whether it may show before a signed-in account has accepted how Dandelist uses AI. A test
 * (consent-gate.test.ts) fails when a route is added to app/ without being placed here.
 */
export const OPEN_ROUTES = ["consent", "legal", "privacy", "terms"] as const;
export const APP_ROUTES = [
  "index",
  "welcome",
  "sign-in",
  "auth/index",
  "auth/callback",
  "wishes/index",
  "wishes/new",
  "wishes/manual",
  "wishes/[id]",
  "picks/[id]",
  "dream",
  "plan",
  "theme",
  "lab",
  "store-test",
  "admin",
] as const;

/** Where someone was headed when the app closed for the consent (a deep link, a page reloaded): back there after. */
const RETURNABLE = /^\/(wishes|picks|dream|plan|theme)(\/|$)/;
let returnTo: string | null = null;
/** Where the consent page sends them once the app opens (app/consent.tsx), once; null for the start. */
export function takeReturn(): string | null {
  const to = returnTo;
  returnTo = null;
  return to;
}

/**
 * Above the app's own providers (root layout): signed in, the app and everything it starts (lists, today's pick,
 * descriptions, chats) exist only once the account's yes is saved. Before that, whether the answer is still being
 * read, couldn't be read, or is no, only the consent page and the legal pages exist: a navigator of their own, so no
 * product screen mounts behind a card. Signed out, the app is the welcome and sign-in, which send nothing to AI.
 */
export function ConsentGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const consent = useAccountConsent();
  const open = appOpen(auth.status, consent.state);
  const pathname = usePathname();
  const segments = useSegments();
  const params = useGlobalSearchParams();
  // Kept while the app is open, query and all (the chat is /wishes?page=chat), so a deep link that closed it for the
  // consent is where the consent page sends them on. A route's own parameters are in the path already.
  if (open && RETURNABLE.test(pathname)) returnTo = withQuery(pathname, segments, params);
  else if (open && pathname !== "/consent") returnTo = null;
  return open ? children : <ConsentStack />;
}

/** The path with the search parameters that aren't the route's own ([id] and the like). */
export function withQuery(pathname: string, segments: readonly string[], params: Record<string, string | string[] | undefined>): string {
  const own = new Set(segments.filter((s) => s.startsWith("[")).map((s) => s.replace(/^\[(\.\.\.)?|\]$/g, "")));
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (!own.has(k) && typeof v === "string") query.append(k, v);
  const q = query.toString();
  return q ? `${pathname}?${q}` : pathname;
}

/** The navigator while the app is closed: the consent page first, the legal pages beside it, every other route guarded. */
function ConsentStack() {
  const p = usePalette();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.bg } }}>
      {OPEN_ROUTES.map((name) => (
        <Stack.Screen key={name} name={name} />
      ))}
      <Stack.Protected guard={false}>
        {APP_ROUTES.map((name) => (
          <Stack.Screen key={name} name={name} />
        ))}
      </Stack.Protected>
    </Stack>
  );
}
