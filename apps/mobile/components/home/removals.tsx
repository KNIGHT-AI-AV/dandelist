import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { UNDO_MS } from "../../lib/removal";
import { layout, space } from "../../lib/theme";
import { useWishes, type Wish } from "../../lib/wishes";
import { dockRoom } from "../inputs";
import { ConfirmRemove } from "../list/confirm-remove";
import { Toast, type Note } from "../list/undo-toast";
import { useRemovals } from "../list/use-removals";
import { useHome } from "./bridge";
import { usePager } from "./pager";
import { useRemoveGrace } from "./remove-grace";

interface Removals {
  /** The wish waiting out its undo window, hidden on every page. */
  pendingId: string | undefined;
  /**
   * Starts a removal with undo; `focusUndo` moves focus to Undo (keyboard and screen-reader users). The first one asks
   * first (lib/remove-confirm.ts); after a yes, more go through without asking for a while.
   */
  remove(w: Wish, focusUndo?: boolean): void;
  showError(text: string): void;
}

const Ctx = createContext<Removals | null>(null);

/**
 * One undo window for the whole ring: a wish removed on Details also leaves the list at once, and one toast says so
 * wherever you are, above the composer on the list and the chat. Removing asks first, once (owner, 2026-10-31): after
 * a yes, removals go through without asking for two minutes, or until the app goes to the background or they move on
 * to a page other than the list and Details, or to another screen (components/home/remove-grace.ts).
 */
export function RemovalsProvider({ children }: { children: ReactNode }) {
  const { remove: commit } = useWishes();
  const home = useHome();
  const { page } = usePager();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [errorNote, setErrorNote] = useState<Note | null>(null);
  const showError = useCallback((text: string) => setErrorNote({ key: `error:${Date.now()}`, text }), []);
  useEffect(() => {
    if (!errorNote) return;
    const t = setTimeout(() => setErrorNote(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [errorNote]);
  const removals = useRemovals(commit, showError);
  const [claim, setClaim] = useState(0);
  const begin = removals.remove;
  const go = useCallback(
    (w: Wish, focusUndo: boolean) => {
      begin(w);
      if (focusUndo) setClaim((c) => c + 1);
    },
    [begin],
  );
  // The free window after a yes, and the removal waiting on an answer.
  const grace = useRemoveGrace(page);
  const [asking, setAsking] = useState<{ w: Wish; focusUndo: boolean } | null>(null);
  const remove = useCallback(
    (w: Wish, focusUndo = true) => {
      if (grace.needs()) setAsking({ w, focusUndo });
      else go(w, focusUndo);
    },
    [go, grace],
  );
  const confirm = useCallback(() => {
    if (!asking) return;
    grace.granted();
    setAsking(null);
    go(asking.w, asking.focusUndo);
  }, [asking, go, grace]);
  const keep = useCallback(() => setAsking(null), []);
  const pending = removals.pending;
  const note: Note | null = pending ? { key: pending.id, text: `Removed ${pending.name}`, action: { label: "Undo", onPress: () => removals.undo(pending.id) } } : errorNote;
  const docked = page === "list" || page === "chat";
  const bottom = docked ? dockRoom(home.dock || layout.control.primary, insets.bottom) - space[12] : insets.bottom + space[16];
  const value = useMemo<Removals>(() => ({ pendingId: pending?.id, remove, showError }), [pending?.id, remove, showError]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <Toast note={note} bottom={bottom} side={layout.gutter(width)} claim={claim} onHold={removals.hold} onRelease={removals.release} />
      <ConfirmRemove name={asking?.w.name ?? null} onRemove={confirm} onKeep={keep} />
    </Ctx.Provider>
  );
}

export function useHomeRemovals(): Removals {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useHomeRemovals must be used inside RemovalsProvider");
  return ctx;
}
