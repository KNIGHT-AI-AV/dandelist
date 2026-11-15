/** Historical Responses-shaped fixtures exercise app logic without becoming a runtime/provider compatibility lane.
 * New no-Meta integration tests import the real createApp and exercise the real Haiku Messages adapter instead.
 */
import { createApp as actualApp } from "../src/app";
import { MetaApiError, parseResponses, HAIKU_MODEL } from "@dandelist/meta";
import type { NoMetaPolicy } from "../src/inference-policy";
import type { ClaudeSetup } from "../src/under";

type LegacyFixture = { apiKey: string; baseUrl?: string; fetch?: typeof fetch };
export type FixtureAppDeps = Parameters<typeof actualApp>[0] & { meta?: LegacyFixture; claude?: ClaudeSetup };
export function fixturePolicy(now: Date, caps = { dailyUsd: 10, totalUsd: 120 }): NoMetaPolicy {
  return {
    provider: "anthropic-api", billingAccountId: "synthetic-test-org", modelId: HAIKU_MODEL,
    funding: { verified: true, provider: "anthropic-api", billingAccountId: "synthetic-test-org", receiptId: "synthetic-route-fixture",
      modelIds: [HAIKU_MODEL], capabilities: ["text", "vision", "app-tools", "web-search"], checkedAtMs: now.getTime() - 1000,
      expiresAtMs: now.getTime() + 3_600_000, eligibleRemainingUsd: Math.max(120, caps.totalUsd) },
    limits: { callUsd: Math.min(0.6, caps.dailyUsd, caps.totalUsd), dailyUsd: Math.min(caps.dailyUsd, caps.totalUsd), totalUsd: caps.totalUsd,
      inputBytes: 8_388_608, outputTokens: 2048, toolCalls: 8 },
  };
}
export function createApp(deps: FixtureAppDeps) {
  if (!deps.meta || deps.inference) return actualApp(deps);
  const fixture = deps.meta;
  return actualApp({ ...deps, inference: {
    apiKey: "synthetic-fixture-only", keyOrganizationVerified: true, get policy() { return fixturePolicy(deps.now(), deps.spendCaps); },
    transport: {
      // Historical protocol fixtures still share the real account cap; their synthetic request hold fits this pilot.
      quote: body => ((body.text as { format?: { name?: string } } | undefined)?.format?.name === "photo_check" ? 0.02 : 0.05),
      respond: async body => {
        if (!fixture.fetch) throw Error("Offline route fixture requires its fake fetch");
        const response = await fixture.fetch("https://responses-fixture.invalid/responses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!response.ok) throw new MetaApiError(response.status, "Synthetic fixture refusal");
        const raw = await response.json();
        const parsed = parseResponses(raw as Record<string, unknown>, "muse-spark-1.3");
        return { ...parsed, usage: { ...parsed.usage, model: HAIKU_MODEL } };
      },
    },
  } });
}
