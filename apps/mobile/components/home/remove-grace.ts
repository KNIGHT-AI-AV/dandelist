import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { AppState } from "react-native";
import type { PageId } from "../../lib/pager";
import { graceAfter, keepsGrace, needsConfirm } from "../../lib/remove-confirm";

/**
 * The free window after a confirmed removal (lib/remove-confirm.ts). It closes when the app goes to the background,
 * when the ring moves to a page other than the list and Details, and when the home screen gives way to another screen
 * such as the theme chooser or a wish's page, even if they come straight back (Codex, round 44: the theme screen and
 * back kept it open).
 */
export function useRemoveGrace(page: PageId): { needs(): boolean; granted(): void } {
  const until = useRef(0);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") until.current = 0;
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!keepsGrace(page)) until.current = 0;
  }, [page]);
  useFocusEffect(
    useCallback(
      () => () => {
        until.current = 0;
      },
      [],
    ),
  );
  return useMemo(() => ({ needs: () => needsConfirm(until.current, Date.now()), granted: () => void (until.current = graceAfter(Date.now())) }), []);
}
