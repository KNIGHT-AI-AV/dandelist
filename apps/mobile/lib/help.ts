import * as Application from "expo-application";
import { useSyncExternalStore } from "react";
import { Dimensions, Platform } from "react-native";
import { analytics } from "./analytics";
import type { Api } from "./profile";

/**
 * Help reports (owner, 2026-10-31: "a help icon so that it takes a direct state of everything on the application ...
 * if I see an issue, I can just press a button and then immediately go to this chat and talk to you and you could
 * literally see it with pictures"). The app adds what only it knows: where it is, the device and build, the last
 * errors and warnings it logged, and what its parts registered (addToHelp). The server adds the latest conversation,
 * the list and the last hunts, and keeps it all private for the team (apps/api/src/help.ts).
 */

const LOG_KEEP = 40;
type Line = { at: string; level: "error" | "warn"; text: string };
const lines: Line[] = [];
let kept = false;

const json = (v: unknown) => {
  try {
    return JSON.stringify(v).slice(0, 300);
  } catch {
    return String(v);
  }
};
const show = (v: unknown) => (v instanceof Error ? `${v.name}: ${v.message}` : typeof v === "string" ? v : json(v));

/** Keeps the last errors and warnings the app logs, for the next report. Installed once, at start. */
export function keepLogs(): void {
  if (kept) return;
  kept = true;
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      lines.push({ at: new Date().toISOString(), level, text: args.map(show).join(" ").slice(0, 600) });
      if (lines.length > LOG_KEEP) lines.shift();
      original(...args);
    };
  }
}

const parts = new Map<string, () => unknown>();
/** Adds a part of the app's own state to every report while it's mounted; returns the function that takes it out. */
export function addToHelp(name: string, read: () => unknown): () => void {
  parts.set(name, read);
  return () => void parts.delete(name);
}

/** Everything the app itself can say about where it is now. */
export function helpState(route: string): Record<string, unknown> {
  const { width, height, scale, fontScale } = Dimensions.get("window");
  const state: Record<string, unknown> = {
    route,
    platform: Platform.OS,
    os: String(Platform.Version),
    version: Application.nativeApplicationVersion ?? null,
    build: Application.nativeBuildVersion ?? null,
    window: { width, height, scale, fontScale },
    at: new Date().toISOString(),
    logs: [...lines],
  };
  for (const [name, read] of parts) {
    try {
      state[name] = read();
    } catch (e) {
      state[name] = `unreadable: ${String(e)}`;
    }
  }
  return state;
}

/** Sends a report with the screen's picture (a JPEG in base64, or none); answers with its id and the code to quote. */
export async function sendHelp(api: Api, state: Record<string, unknown>, screenshot?: string | null): Promise<{ id: string; code: string }> {
  const replay = analytics.sessionId();
  const res = await api("/help", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, ...(screenshot ? { screenshot } : {}), ...(replay ? { replay } : {}) }),
  }).catch(() => null);
  if (!res?.ok) throw new Error(((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't send it. Try again.");
  return (await res.json()) as { id: string; code: string };
}

// The one help sheet: opened from the bar's help button or Settings, shown by <HelpHost /> (components/help.tsx).
type Asking = { shot: string | null } | null;
let asking: Asking = null;
const listeners = new Set<() => void>();
const set = (next: Asking) => {
  asking = next;
  listeners.forEach((l) => l());
};
/** Opens the help sheet with the picture taken a moment before (or none). */
export const openHelp = (shot: string | null) => set({ shot });
export const closeHelp = () => set(null);
export function useHelpAsking(): Asking {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => asking,
    () => asking,
  );
}
