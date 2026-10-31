import { describe, expect, it, vi } from "vitest";
import { createWishSession, updateWishSession } from "./wish-session";

type State = { wishes: string[]; status: "idle" | "loading" | "ready" | "error"; error: string | null };
const ready = (wish: string): State => ({ wishes: [wish], status: "ready", error: null });
const empty = (): State => ({ wishes: [], status: "idle", error: null });

describe("wish store account sessions", () => {
  const lateChanges: [string, (value: State) => State][] = [
    ["GET success", (value) => ({ ...value, wishes: ["A-old"], status: "ready" })],
    ["loading status", (value) => ({ ...value, status: "loading", error: null })],
    ["GET failure", (value) => ({ ...value, status: "error", error: "A's old request failed" })],
    ["add success", (value) => ({ ...value, wishes: ["A-added", ...value.wishes] })],
    ["whole-list rollback", (value) => ({ ...value, wishes: ["A-before-removal"] })],
  ];

  it.each(lateChanges)("ignores an old account's %s after the new account is ready", (_name, change) => {
    const a = createWishSession("A", ready("A-existing"));
    const b = createWishSession("B", ready("B-current"));
    const update = vi.fn(change);
    const after = updateWishSession(b, a.scope, update);
    expect(after).toBe(b);
    expect(after.value).toEqual(ready("B-current"));
    // A stale updater must not even receive the new account's state.
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps the signed-out store empty when old work finishes", () => {
    const a = createWishSession("A", ready("A-existing"));
    const signedOut = createWishSession(null, empty());
    expect(updateWishSession(signedOut, a.scope, () => ready("A-late"))).toBe(signedOut);
    const inactive = vi.fn(() => ready("not-signed-in"));
    expect(updateWishSession(signedOut, signedOut.scope, inactive)).toBe(signedOut);
    expect(inactive).not.toHaveBeenCalled();
    expect(signedOut.value).toEqual(empty());
  });

  it("does not revive old A closures after A signs out and returns", () => {
    const firstA = createWishSession("A", ready("A-old-session"));
    const signedOut = createWishSession(null, empty());
    const nextA = createWishSession("A", ready("A-new-session"));
    expect(nextA.scope).not.toBe(firstA.scope);
    expect(nextA.scope).not.toBe(signedOut.scope);
    expect(updateWishSession(nextA, firstA.scope, () => firstA.value)).toBe(nextA);
    expect(updateWishSession(nextA, signedOut.scope, () => empty())).toBe(nextA);
    const updated = updateWishSession(nextA, nextA.scope, (value) => ({ ...value, wishes: [...value.wishes, "A-new-add"] }));
    expect(updated.value.wishes).toEqual(["A-new-session", "A-new-add"]);
  });

  it("applies current-session loading, error, recovery and sequential functional updates", () => {
    const initial = createWishSession("A", empty());
    const loading = updateWishSession(initial, initial.scope, (value) => ({ ...value, status: "loading" }));
    const failed = updateWishSession(loading, initial.scope, (value) => ({ ...value, status: "error", error: "Try again" }));
    expect(failed.value).toEqual({ wishes: [], status: "error", error: "Try again" });
    const loaded = updateWishSession(failed, initial.scope, () => ready("A-existing"));
    const added = updateWishSession(loaded, initial.scope, (value) => ({ ...value, wishes: ["A-added", ...value.wishes] }));
    const removed = updateWishSession(added, initial.scope, (value) => ({ ...value, wishes: value.wishes.filter((wish) => wish !== "A-existing") }));
    expect(removed.value).toEqual(ready("A-added"));
    expect(removed.scope).toBe(initial.scope);
    expect(initial.value).toEqual(empty());
    expect(loaded.value).toEqual(ready("A-existing"));
  });

  it("still permits a failed optimistic change to roll back within the active session", () => {
    const before = createWishSession("A", ready("A-before-removal"));
    const optimistic = updateWishSession(before, before.scope, (value) => ({ ...value, wishes: [] }));
    const rolledBack = updateWishSession(optimistic, before.scope, () => before.value);
    expect(rolledBack.value).toEqual(ready("A-before-removal"));
    expect(rolledBack.scope).toBe(before.scope);
  });
});
