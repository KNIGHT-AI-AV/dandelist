/**
 * PostHog, on the company's startup credits (owner, 2026-10-31: "We need all the analytical tools to be pulling data ...
 * fully up and running with posthog ... only the credits"). The project token is PostHog's write-only key, made to ship
 * inside apps; it can send events and nothing else. Billing limits on every product keep it inside the credits.
 */
export const POSTHOG_TOKEN = process.env.EXPO_PUBLIC_POSTHOG_TOKEN || "phc_v6KCcDTe83rni5HRTUS2YVJZxacenpwvbAxdBrMnDPGy";
export const POSTHOG_HOST = "https://us.i.posthog.com";

/** What every platform's analytics can do (lib/analytics.native.tsx, lib/analytics.web.tsx; lib/analytics.tsx is off). */
export interface Analytics {
  capture(event: string, props?: Record<string, unknown>): void;
  screen(name: string): void;
  error(e: unknown, props?: Record<string, unknown>): void;
  /** This visit's replay id, for a help report to point at. */
  sessionId(): string | undefined;
}

/** A price as a band, so events say how big a wish is without carrying the wish itself. */
export function priceBand(cents: number): string {
  const dollars = cents / 100;
  if (!dollars) return "none";
  const top = [100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000].find((b) => dollars < b);
  return top ? `under ${top}` : "10M or more";
}
