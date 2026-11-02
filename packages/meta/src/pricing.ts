/**
 * Meta Model API prices in US dollars, from https://dev.meta.ai/docs/pricing-rate-limits (read 2026-10-26; the SAM
 * and Muse Image rows read 2026-10-27). Used only to estimate spend for the API's own caps; Meta's billing is the
 * source of truth.
 */
export const TOKEN_PRICES: Record<string, { input: number; cachedInput: number; output: number }> = {
  "muse-wonder-1.0": { input: 4.0, cachedInput: 0.2, output: 20.0 },
  "muse-spark-1.3": { input: 1.25, cachedInput: 0.15, output: 4.25 },
  "muse-spark-1.2": { input: 1.25, cachedInput: 0.15, output: 4.25 },
  "muse-spark-1.1": { input: 1.25, cachedInput: 0.15, output: 4.25 },
};

/** Models billed per image instead of per token: SAM 3.1 segmentation, and Muse Image generations and edits. */
export const IMAGE_PRICES: Record<string, number> = {
  "sam-3.1": 2.5 / 1000,
  "muse-image-1.0": 0.01,
};

export const SEARCH_PRICE_PER_QUERY = 2.5 / 1000;
export const IMAGE_PRICE = 0.01;
export const TRANSCRIBE_PRICE_PER_SECOND = 0.18 / 3600;

export interface Usage {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  searches: number;
  /** Images segmented or returned, for the models billed per image. */
  images?: number;
  /** Input tokens written to the prompt cache, for Claude (claude.ts); counted in inputTokens too. */
  cacheWriteTokens?: number;
}

export function estimateCostUsd(u: Usage): number {
  const perImage = IMAGE_PRICES[u.model];
  if (perImage !== undefined) return (u.images ?? 0) * perImage;
  const p = TOKEN_PRICES[u.model];
  if (!p) throw new Error(`No price on file for model ${u.model}`);
  const uncached = Math.max(0, u.inputTokens - u.cachedInputTokens);
  return (
    (uncached * p.input + u.cachedInputTokens * p.cachedInput + u.outputTokens * p.output) / 1_000_000 +
    u.searches * SEARCH_PRICE_PER_QUERY
  );
}

/**
 * Claude Opus 5.5, the agent under Meta (claude.ts), from https://platform.claude.com/docs/en/about-claude/pricing
 * (read 2026-11-02): $4 a million input tokens and $20 output; cache reads 0.05x input and five-minute cache writes
 * 1.25x. Fast mode is twice the price, and the cache multipliers apply on top of it. Web search is $10 a thousand.
 */
export const CLAUDE_PRICES = {
  standard: { input: 4, cachedInput: 0.2, cacheWrite: 5, output: 20 },
  fast: { input: 8, cachedInput: 0.4, cacheWrite: 10, output: 40 },
} as const;
export const CLAUDE_SEARCH_PRICE = 10 / 1000;

/** What one Claude reply cost, at the speed it ran. */
export function claudeCostUsd(u: Usage, fast: boolean): number {
  const p = fast ? CLAUDE_PRICES.fast : CLAUDE_PRICES.standard;
  const written = u.cacheWriteTokens ?? 0;
  const uncached = Math.max(0, u.inputTokens - u.cachedInputTokens - written);
  return (uncached * p.input + u.cachedInputTokens * p.cachedInput + written * p.cacheWrite + u.outputTokens * p.output) / 1_000_000 + u.searches * CLAUDE_SEARCH_PRICE;
}
