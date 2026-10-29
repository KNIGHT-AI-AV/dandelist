import { useCallback, useEffect, useRef, useState } from "react";
import { deleteSession, listSessions, type SessionSummary } from "../../lib/dream";
import { UNDO_MS } from "../../lib/removal";

type Api = (path: string, init?: RequestInit) => Promise<Response>;

/**
 * The chat's history: the list of past conversations, and deletes that wait five seconds for Undo before they reach
 * the server. Another delete, closing the sheet or leaving the page sends a waiting one at once. `onDeleted` hears
 * about each delete that went through (the chat starts fresh when the open conversation goes).
 */
export function useHistory(api: Api, onDeleted: (id: string) => void) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const waiting = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ api, onDeleted });
  latest.current = { api, onDeleted };

  const refresh = useCallback(async (): Promise<SessionSummary[] | null> => {
    try {
      const list = await listSessions(latest.current.api);
      setSessions(list);
      setError(null);
      return list;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, []);

  const commit = useCallback(async (id: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (waiting.current === id) waiting.current = null;
    setPending((p) => (p === id ? null : p));
    try {
      await deleteSession(latest.current.api, id);
      setSessions((s) => s?.filter((x) => x.id !== id) ?? s);
      latest.current.onDeleted(id);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const flush = useCallback(() => {
    if (waiting.current) void commit(waiting.current);
  }, [commit]);

  const remove = useCallback(
    (id: string) => {
      if (waiting.current && waiting.current !== id) void commit(waiting.current);
      waiting.current = id;
      setPending(id);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void commit(id), UNDO_MS);
    },
    [commit],
  );

  const undo = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    waiting.current = null;
    setPending(null);
  }, []);

  // Leaving with a delete still waiting sends it.
  useEffect(() => () => flush(), [flush]);

  return { sessions, error, pending, refresh, remove, undo, flush };
}
