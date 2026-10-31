/** Object identity distinguishes separate sign-ins, including returning to the same account. */
export interface WishSessionScope {
  readonly owner: string | null;
}

export interface WishSession<T> {
  readonly scope: WishSessionScope;
  readonly value: T;
}

export function createWishSession<T>(owner: string | null, value: T): WishSession<T> {
  return { scope: { owner }, value };
}

/**
 * Runs `fn` only while `scope` is still the current sign-in's: a completion that lands after a sign-out, or after
 * someone else (or the same person again) signed in, does nothing (review of #139: an analytics event for one account
 * must not be told under another's id).
 */
export function whileCurrent(current: () => WishSessionScope, scope: WishSessionScope, fn: () => void): void {
  if (scope.owner !== null && current() === scope) fn();
}

/** An old completion cannot read or change the current session, even through a functional updater. */
export function updateWishSession<T>(current: WishSession<T>, scope: WishSessionScope, update: (value: T) => T): WishSession<T> {
  if (scope.owner === null || current.scope !== scope) return current;
  const value = update(current.value);
  return value === current.value ? current : { ...current, value };
}
