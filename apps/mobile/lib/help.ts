import type { HelpDiagnostics } from "@dandelist/catalogue";
import * as Application from "expo-application";
import { Dimensions, Platform } from "react-native";
import { analytics } from "./analytics";
import { SignInChanged } from "./auth";
import { keptLines, noteLine } from "./help-sheet";
import type { Api } from "./profile";

/**
 * Help reports (owner, 2026-10-31: "a help icon so that it takes a direct state of everything on the application ...
 * if I see an issue, I can just press a button and then immediately go to this chat and talk to you and you could
 * literally see it with pictures"). The app adds a fixed list of diagnostics (packages/catalogue/src/help.ts): where it
 * is, the device and build, and the last errors and warnings it logged in this sign-in, with anything shaped like a
 * credential cut out. The server adds the latest conversation, the list and the last hunts, and keeps it all private
 * for the team (apps/api/src/help.ts). The sheet and its sign-in ownership live in lib/help-sheet.ts.
 */

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
      noteLine(level, args.map(show).join(" "));
      original(...args);
    };
  }
}

/** The diagnostics the app sends with a report: nothing beyond the shared list. */
export function helpState(route: string): HelpDiagnostics {
  const { width, height, scale, fontScale } = Dimensions.get("window");
  return {
    route,
    platform: Platform.OS,
    os: String(Platform.Version),
    version: Application.nativeApplicationVersion ?? null,
    build: Application.nativeBuildVersion ?? null,
    window: { width, height, scale, fontScale },
    at: new Date().toISOString(),
    logs: keptLines(),
  };
}

/**
 * Sends a report, as the sheet `key` names (so sending it again after a failure is the same report), with the screen's
 * picture (a JPEG in base64, or none); answers with its id and the code to quote. `api` is bound to the sheet's sign-in
 * (components/help.tsx): once that sign-in has moved on it sends nothing and throws SignInChanged, which passes through.
 */
export async function sendHelp(api: Api, state: HelpDiagnostics, screenshot: string | null, key: string): Promise<{ id: string; code: string }> {
  const replay = analytics.sessionId();
  const res = await api("/help", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, state, ...(screenshot ? { screenshot } : {}), ...(replay ? { replay } : {}) }),
  }).catch((e: unknown) => {
    if (e instanceof SignInChanged) throw e;
    return null;
  });
  if (!res?.ok) throw new Error(((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't send it. Try again.");
  return (await res.json()) as { id: string; code: string };
}
