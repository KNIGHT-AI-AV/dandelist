/**
 * Sliding-window counter kept in memory. The API runs as one Railway instance, so this is shared by all requests;
 * a restart resets it, which only ever loosens limits briefly.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records a hit for `key` and reports whether it is still within the limit. */
  take(key: string, nowMs: number): boolean {
    const since = nowMs - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(nowMs);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(since);
    return true;
  }

  private prune(since: number) {
    for (const [k, ts] of this.hits) if (!ts.some((t) => t > since)) this.hits.delete(k);
  }
}

/** The client address as Railway's edge saw it: the last X-Forwarded-For hop, which the client cannot forge. */
export function clientIp(forwardedFor: string | undefined, fallback = "unknown"): string {
  const hops = (forwardedFor ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return hops.at(-1) ?? fallback;
}
