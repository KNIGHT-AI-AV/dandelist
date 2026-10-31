import { randomUUID } from "node:crypto";

/**
 * App Runner throttles an instance's CPU while it serves no request ("a CPU-throttled instance", aws.amazon.com/apprunner/faqs),
 * so work that outlives its request crawls once the phone goes away: a hunt after POST /agent/runs has answered, a chat
 * turn whose phone left mid-stream, a search the Dandy runs in the background. Owner, 2026-10-31: "users need to be
 * able to leave the app completely and it still works. Nonstop until the job is done".
 *
 * While any such work is in flight, the instance keeps one request to itself open (GET /internal/hold), held up to
 * HOLD_MS and renewed while work remains. One instance takes 100 requests at once, so the request lands here; when it
 * lands on another (a deploy runs two for a while), that one doesn't know this instance's token, answers 404 at once
 * and the next try comes round.
 */
export const HOLD_MS = 100_000;
const RETRY_MS = 2_000;
const TICK_MS = 500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface AliveOptions {
  /** The API's public origin (PUBLIC_API_URL); without one, the first request's own origin is used. */
  origin?: string;
  fetch?: typeof fetch;
  holdMs?: number;
  tickMs?: number;
  retryMs?: number;
}

export class Alive {
  /** This instance's own: a hold carrying another instance's token is turned away. */
  readonly token = randomUUID();
  private busy = 0;
  private holding = false;
  private seen?: string;

  constructor(private readonly opts: AliveOptions = {}) {}

  /** Work in flight right now. */
  get inFlight(): number {
    return this.busy;
  }

  /** Remembers where this API is reached, from the first request that names it (local runs have no PUBLIC_API_URL). */
  noteOrigin(origin: string): void {
    this.seen ??= origin.replace(/\/+$/, "");
  }

  /** Runs `work` with the instance kept awake until it settles; the result and any error pass through untouched. */
  keep<T>(work: Promise<T>): Promise<T> {
    this.busy++;
    void this.hold();
    return work.finally(() => void this.busy--);
  }

  private async hold(): Promise<void> {
    const origin = (this.opts.origin ?? this.seen)?.replace(/\/+$/, "");
    if (this.holding || !origin) return;
    this.holding = true;
    try {
      while (this.busy > 0) {
        try {
          const res = await (this.opts.fetch ?? fetch)(`${origin}/internal/hold`, { headers: { "x-hold": this.token } });
          await res.body?.cancel().catch(() => undefined);
          if (res.status !== 204) await sleep(this.opts.retryMs ?? RETRY_MS);
        } catch {
          await sleep(this.opts.retryMs ?? RETRY_MS);
        }
      }
    } finally {
      this.holding = false;
    }
  }

  /** GET /internal/hold: answers once nothing is in flight or HOLD_MS has passed; 404 for anyone else's token. */
  async wait(token: string | undefined): Promise<204 | 404> {
    if (token !== this.token) return 404;
    const until = Date.now() + (this.opts.holdMs ?? HOLD_MS);
    while (this.busy > 0 && Date.now() < until) await sleep(this.opts.tickMs ?? TICK_MS);
    return 204;
  }
}
