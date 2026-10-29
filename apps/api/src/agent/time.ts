/** Resolves to the promise's value, or null once `ms` pass (at once when `ms` is not positive). A late rejection is swallowed; an early one still throws. */
export async function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  p.catch(() => undefined);
  if (!(ms > 0)) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), Math.min(ms, 2_147_000_000))))]);
  } finally {
    clearTimeout(timer);
  }
}
