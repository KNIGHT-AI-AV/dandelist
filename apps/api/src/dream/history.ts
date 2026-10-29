import type { TranscriptEntry } from "./types";

/**
 * Chat history (owner, 2026-10-28): each conversation is listed by what the person first said, with its latest plain
 * line as the preview. Both are kept on the session row (sql/020_chat_history.sql) so the list never loads transcripts.
 */

export const TITLE_MAX = 80;
export const PREVIEW_MAX = 140;
export const HISTORY_LIMIT = 50;

export interface SessionSummary {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
}

/** The app's own notes in a transcript ("[picked l_3]", "[just search]"), never shown to the person. */
const isNote = (e: TranscriptEntry) => e.role === "user" && e.text.trimStart().startsWith("[");
/** A line the person saw as words: their messages and the concierge's sentences, not its notes about a widget. */
const isSaid = (e: TranscriptEntry) => !e.widget && !isNote(e) && !!e.text.trim();

/** One line, at most `max` characters, cut at a word where it can be. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  // One character past the limit shows whether the cut falls between words.
  const space = t.slice(0, max + 1).lastIndexOf(" ");
  return (space >= max * 0.6 ? t.slice(0, space) : t.slice(0, max)).replace(/[\s,.;:]+$/, "");
}

/** The first thing the person said, or null when they've only tapped (a chip, a swipe). */
export function titleOf(t: TranscriptEntry[]): string | null {
  const first = t.find((e) => e.role === "user" && isSaid(e));
  return first ? clip(first.text, TITLE_MAX) : null;
}

/** The latest line either of them said in words. */
export function previewOf(t: TranscriptEntry[]): string | null {
  for (let i = t.length - 1; i >= 0; i--) if (isSaid(t[i]!)) return clip(t[i]!.text, PREVIEW_MAX);
  return null;
}

const iso = (v: unknown) => new Date(v as string | Date).toISOString();

/** A session row as the history list shows it. */
export function summary(row: { id: string; title: string | null; preview: string | null; created_at: unknown; updated_at: unknown }): SessionSummary {
  return {
    id: row.id,
    title: row.title || row.preview || "A new conversation",
    preview: row.preview ?? "",
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
