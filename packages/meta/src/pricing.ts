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
