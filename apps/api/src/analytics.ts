import type { Usage } from "@dandelist/meta";
import { PostHog } from "posthog-node";

/**
 * The API's side of PostHog (owner, 2026-10-31: "wired to the bone ... only the credits"): every model call as an AI
 * Observability generation (which model, tokens, web searches and what it cost, under the account's id, never its
 * words), and errors the server catches. The project token is PostHog's write-only key, the same one the apps ship.
 * Off under tests and when POSTHOG_OFF is set.
 */
const TOKEN = process.env.POSTHOG_TOKEN || "phc_v6KCcDTe83rni5HRTUS2YVJZxacenpwvbAxdBrMnDPGy";
const off = !!process.env.VITEST || process.env.NODE_ENV === "test" || !!process.env.POSTHOG_OFF;

export const posthog: PostHog | null = off ? null : new PostHog(TOKEN, { host: "https://us.i.posthog.com", flushAt: 20, flushInterval: 5_000 });

/** One model call (spend.ts recordSpend), as PostHog's AI Observability reads it. Guests and the server stay anonymous. */
export function aiGeneration(userId: string | null, kind: string, usage: Usage, costUsd: number): void {
  posthog?.capture({
    distinctId: userId ?? "dandelist-server",
    event: "$ai_generation",
    properties: {
      $ai_provider: "meta",
      $ai_model: usage.model,
      $ai_span_name: kind,
      $ai_input_tokens: usage.inputTokens,
      $ai_cache_read_input_tokens: usage.cachedInputTokens,
      $ai_output_tokens: usage.outputTokens,
      $ai_web_search_count: usage.searches,
      $ai_total_cost_usd: costUsd,
      $ai_cost_passthrough: true,
      ...(userId ? {} : { $process_person_profile: false }),
    },
  });
}

/** An error the server caught, with where it happened. */
export function serverError(e: unknown, userId?: string | null, props: Record<string, unknown> = {}): void {
  posthog?.captureException(e instanceof Error ? e : new Error(String(e)), userId ?? undefined, props);
}

/** Sends what's queued before the process goes (server.ts on SIGTERM). */
export async function closeAnalytics(): Promise<void> {
  await posthog?.shutdown(5_000);
}
