import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { UNDO_MS } from "../../lib/removal";
import { layout, space } from "../../lib/theme";
import { useWishes, type Wish } from "../../lib/wishes";
import { dockRoom } from "../inputs";
import { Toast, type Note } from "../list/undo-toast";
import { useRemovals } from "../list/use-removals";
import { useHome } from "./bridge";
import { usePager } from "./pager";

interface Removals {
  /** The wish waiting out its undo window, hidden on every page. */
  pendingId: string | undefined;
  /** Starts a removal with undo; `focusUndo` moves focus to Undo (keyboard and screen-reader users). */
  remove(w: Wish, focusUndo?: boolean): void;
  showError(text: string): void;
}

const Ctx = createContext<Removals | null>(null);

/**
 * One undo window for the whole ring: a wish removed on Details also leaves the list at once, and one toast says so
 * wherever you are, above the composer on the list and the chat.
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
  const remove = useCallback(
    (w: Wish, focusUndo = true) => {
      begin(w);
      if (focusUndo) setClaim((c) => c + 1);
    },
    [begin],
  );
  const pending = removals.pending;
  const note: Note | null = pending ? { key: pending.id, text: `Removed ${pending.name}`, action: { label: "Undo", onPress: () => removals.undo(pending.id) } } : errorNote;
  const docked = page === "list" || page === "chat";
  const bottom = docked ? dockRoom(home.dock || layout.control.primary, insets.bottom) - space[12] : insets.bottom + space[16];
  const value = useMemo<Removals>(() => ({ pendingId: pending?.id, remove, showError }), [pending?.id, remove, showError]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <Toast note={note} bottom={bottom} side={layout.gutter(width)} claim={claim} onHold={removals.hold} onRelease={removals.release} />
    </Ctx.Provider>
  );
}

export function useHomeRemovals(): Removals {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useHomeRemovals must be used inside RemovalsProvider");
  return ctx;
}
