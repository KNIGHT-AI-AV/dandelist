import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { TextInput } from "react-native";
import { usePager } from "./pager";

/**
 * The one composer at the bottom of the list and the chat (owner, recording 03: "'Tell me what you want' should be a
 * text field in place that transforms the background into the agent area, carrying the typed text"). What someone
 * types on the list stays in the field as the chat slides in under it, and sends there.
 */
export interface Home {
  draft: string;
  setDraft(text: string): void;
  /** Turns to the chat and sends `text` to the Dandy. */
  ask(text: string): void;
  /** A reply is on its way: the composer waits. */
  busy: boolean;
  /** The docked composer's height, for the space under a page's content. */
  dock: number;
  setDock(height: number): void;
  /**
   * The field has focus on the list: the list steps back and the Dandy comes forward. Only while the list is the page
   * the field sits under: one page in view and the list in front (in a spread the field sits under the chat).
   */
  focused: boolean;
  /** The field took or lost focus, wherever it is. */
  setFocused(on: boolean): void;
  /** The docked composer's input, and a way to put the cursor in it (the chat's "Add another while you wait"). */
  composer: RefObject<TextInput | null>;
  focusComposer(): void;
  /**
   * Turns to the list with this wish's card in view (owner, 2026-10-30: the chat card's "Added to your list" takes them
   * "to that screen where they see the actual list"). The chat stays as it was underneath.
   */
  showOnList(wishId: string): void;
  /** The wish the list is to bring into view; the list clears it once it has. */
  shown: string | null;
  clearShown(): void;
}

const Ctx = createContext<Home | null>(null);
const Inbox = createContext<{ attach(send: (text: string) => void): () => void; setBusy(b: boolean): void } | null>(null);

export function HomeProvider({ children }: { children: ReactNode }) {
  const pager = usePager();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [dock, setDock] = useState(0);
  const [typing, setFocused] = useState(false);
  // Worked out on every layout, not only when focus changes: unfolding to a spread while typing on the list moves the
  // field under the chat and the list's ideas go with it, with the words kept; folding back brings them back (review
  // R45-DUO-FOCUS-1).
  const focused = typing && pager.page === "list" && pager.span === 1;
  const [shown, setShown] = useState<string | null>(null);
  const composer = useRef<TextInput | null>(null);
  const handler = useRef<((text: string) => void) | null>(null);
  // A message sent before the chat has mounted waits here.
  const waiting = useRef<string | null>(null);

  const ask = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      setDraft("");
      setFocused(false);
      pager.go("chat");
      if (handler.current) handler.current(t);
      else waiting.current = t;
    },
    [pager],
  );

  const inbox = useMemo(
    () => ({
      attach(send: (text: string) => void) {
        handler.current = send;
        if (waiting.current) {
          const t = waiting.current;
          waiting.current = null;
          send(t);
        }
        return () => {
          if (handler.current === send) handler.current = null;
        };
      },
      setBusy,
    }),
    [],
  );

  const focusComposer = useCallback(() => composer.current?.focus(), []);
  const showOnList = useCallback(
    (wishId: string) => {
      setShown(wishId);
      pager.go("list");
    },
    [pager],
  );
  const clearShown = useCallback(() => setShown(null), []);

  const value = useMemo<Home>(
    () => ({ draft, setDraft, ask, busy, dock, setDock, focused, setFocused, composer, focusComposer, showOnList, shown, clearShown }),
    [draft, ask, busy, dock, focused, focusComposer, showOnList, shown, clearShown],
  );
  return (
    <Ctx.Provider value={value}>
      <Inbox.Provider value={inbox}>{children}</Inbox.Provider>
    </Ctx.Provider>
  );
}

export function useHome(): Home {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useHome must be used inside HomeProvider");
  return ctx;
}

/** The chat page receives what the composer sends, and says when it's busy. */
export function useChatInbox(send: (text: string) => void, busy: boolean) {
  const inbox = useContext(Inbox);
  const latest = useRef(send);
  latest.current = send;
  useEffect(() => inbox?.attach((t) => latest.current(t)), [inbox]);
  useEffect(() => inbox?.setBusy(busy), [inbox, busy]);
}
