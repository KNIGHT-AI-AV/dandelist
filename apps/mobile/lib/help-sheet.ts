import { HELP_LINE_MAX, HELP_LOG_KEEP, redactDiagnostic, type HelpLine } from "@dandelist/catalogue";
import { useEffect, useSyncExternalStore } from "react";

/**
 * The help sheet and what a report may carry from the app, kept to the sign-in that made them (review of #140): the
 * last log lines, the screen's picture, the open sheet and its answer all belong to one sign-in (its account and that
 * sign-in's own key, as lib/rechecks.ts keys its looks). Signing out, in as someone else, or out and back in as the
 * same person clears them all, and a picture or an answer that arrives after that is dropped. Log lines are kept with
 * anything shaped like a credential cut out (packages/catalogue/src/help.ts), and the server cuts them again.
 *
 * A sheet also keeps the sign-in generation it was made under (lib/auth.tsx currentSignIn, passed in as `signIn`), which
 * moves the moment another account's bearer is in place, before React hears of it (review of #140): a picture taken, or
 * a Send pressed, after it moved is dropped, and the report goes out bound to that generation (components/help.tsx), so
 * its retry after a refresh never goes as whoever signed in since.
 */
export interface Sheet {
  /** The sheet's own id, sent as the report's key: sending it again after a failure is the same report. */
  id: string;
  /** The sign-in it belongs to (setHelpOwner): the account, a colon, then that sign-in's own key. */
  owner: string;
  /** The sign-in generation (lib/auth.tsx currentSignIn) it was made under: its report goes as that one or not at all. */
  signIn: number;
  /** The screen as it was before the sheet opened, a JPEG in base64; null when none could be taken. */
  shot: string | null;
  phase: "ready" | "sending" | "sent";
  /** The report's code to quote, once it's in. */
  code: string | null;
  error: string | null;
}

let owner: string | null = null;
let sheet: Sheet | null = null;
/** The sign-in whose picture is being taken: one at a time. */
let taking: string | null = null;
const lines: HelpLine[] = [];
const listeners = new Set<() => void>();
const set = (next: Sheet | null) => {
  sheet = next;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const nonce = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const accountOf = (key: string) => key.slice(0, key.lastIndexOf(":"));
/** A random UUID: the platform's where it has one, otherwise made here (a report key, not a secret). */
const uuid = () =>
  globalThis.crypto?.randomUUID?.() ??
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });

/** Sets whose help this is: the signed-in person and this sign-in, or null. A change clears everything help holds. */
export function setHelpOwner(next: string | null): void {
  if (next === owner) return;
  owner = next;
  lines.length = 0;
  taking = null;
  set(null);
}

/** Keeps help to the person signed in now; the help sheet's host calls it once, high in the app. */
export function useHelpOwner(account: string | null): void {
  useEffect(() => {
    // A fresh key on every sign-in, so signing out and back in as the same person starts afresh too.
    setHelpOwner(account ? `${account}:${nonce()}` : null);
  }, [account]);
}

/** Keeps a log line for the next report, with anything shaped like a credential cut out before it is kept. */
export function noteLine(level: HelpLine["level"], text: string, at = new Date().toISOString()): void {
  lines.push({ at, level, text: redactDiagnostic(text.slice(0, HELP_LINE_MAX * 4)).slice(0, HELP_LINE_MAX) });
  if (lines.length > HELP_LOG_KEEP) lines.shift();
}

/** The log lines kept for this sign-in, oldest first. */
export const keptLines = (): HelpLine[] => [...lines];

/**
 * Takes the screen's picture with `take` and opens the sheet on it, for the sign-in it was taken in only: a picture
 * that comes back after someone signed out, or in as someone else, is dropped. `signIn` reads the sign-in generation.
 */
export async function askForHelp(take: () => Promise<string | null>, signIn: () => number): Promise<void> {
  const mine = owner;
  const at = signIn();
  if (!mine || taking === mine) return;
  taking = mine;
  let shot: string | null = null;
  try {
    shot = await take();
  } catch {
    shot = null;
  } finally {
    if (taking === mine) taking = null;
  }
  if (owner !== mine || signIn() !== at) return;
  set({ id: uuid(), owner: mine, signIn: at, shot, phase: "ready", code: null, error: null });
}

/** Closes the sheet `id` names, or whatever sheet is open. */
export function closeHelp(id?: string): void {
  if (sheet && (!id || sheet.id === id)) set(null);
}

/**
 * Sends the open sheet with `send`, which answers with the report's code and must send as the sheet's own sign-in
 * generation (s.signIn). A sheet made under an earlier generation isn't sent at all. The answer lands on that sheet of
 * that sign-in only: closed, replaced or signed out meanwhile, it changes nothing. Says what became of it.
 */
export async function sendSheet(send: (s: Sheet) => Promise<{ code: string }>, signIn: () => number): Promise<"sent" | "failed" | "dropped"> {
  const s = sheet;
  if (!s || s.owner !== owner || s.phase !== "ready" || signIn() !== s.signIn) return "dropped";
  const mine = () => sheet?.id === s.id && sheet.owner === owner && signIn() === s.signIn;
  set({ ...s, phase: "sending", error: null });
  try {
    const { code } = await send(s);
    if (!mine()) return "dropped";
    set({ ...sheet!, phase: "sent", code });
    return "sent";
  } catch (e) {
    if (!mine()) return "dropped";
    set({ ...sheet!, phase: "ready", error: (e as Error).message || null });
    return "failed";
  }
}

/** The open sheet, if it belongs to `account`: never another account's, from the first render after a change. */
export function useHelpSheet(account: string | null): Sheet | null {
  const s = useSyncExternalStore(subscribe, () => sheet, () => sheet);
  return s && account && accountOf(s.owner) === account ? s : null;
}

/** The sheet as it stands, outside React (tests). */
export const currentSheet = (): Sheet | null => sheet;
