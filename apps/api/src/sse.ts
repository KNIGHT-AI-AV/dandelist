/**
 * Every server-sent stream sends a comment line every 15 s while it works, so proxies (App Runner's included) and
 * phones never close a quiet stream. A comment carries no `data:` line, so every client's parser skips it.
 */
export const HEARTBEAT_MS = 15_000;

/** Starts the beat; call the returned function to stop it. */
export function heartbeat(stream: { write(input: string): Promise<unknown> }, ms = HEARTBEAT_MS): () => void {
  const timer = setInterval(() => void stream.write(": beat\n\n").catch(() => undefined), ms);
  return () => clearInterval(timer);
}

/** A fetch that gives up when `signal` fires, on top of any signal the caller passed. */
export function stoppable(base: typeof fetch, signal: AbortSignal): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) => base(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal })) as typeof fetch;
}
