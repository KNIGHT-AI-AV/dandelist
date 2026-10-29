import { router } from "expo-router";
import { useEffect, useMemo, useRef } from "react";
import { AppState } from "react-native";
import { useAuth } from "../../lib/auth";
import { useDandy } from "../../lib/dandy";
import { notifier } from "../../lib/notifications";
import { EMPTY_REMINDERS, loadReminders, updateReminders, useReminderState } from "../../lib/reminder-state";
import { mayNotify, planReminders, settle, type ReminderKind } from "../../lib/reminders";
import { useWishes } from "../../lib/wishes";

/**
 * Keeps the phone's notifications planned (lib/reminders.ts): on every app open, start and coming back to the front,
 * and whenever the settings, the wishes or the Dandy's name change. Signing out clears them. A tap that opens the app
 * lands on the list, where today's pick waits; a tap on a nudge while the app runs opens the new wish screen. Renders
 * nothing; does nothing while notifications are switched off (lib/notifications.ts) and on the web.
 */
export function Reminders() {
  return notifier.available ? <Planner /> : null;
}

const ROUTE: Record<ReminderKind, "/wishes" | "/wishes/new"> = { pick: "/wishes", pause: "/wishes", nudge: "/wishes/new" };

function Planner() {
  const auth = useAuth();
  const { wishes, status } = useWishes();
  const dandy = useDandy();
  const { prefs, ask } = useReminderState();
  const lastWishAt = useMemo(() => wishes.reduce((m, w) => Math.max(m, Date.parse(w.createdAt) || 0), 0), [wishes]);
  // One plan at a time; a change while one runs plans once more after it.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const live = useRef({ lastWishAt, name: dandy.name });
  live.current = { lastWishAt, name: dandy.name };

  const ready = auth.status === "signedIn" && status === "ready";
  const plan = () => {
    queue.current = queue.current.then(async () => {
      try {
        const now = new Date();
        const s = await loadReminders();
        // The tap that opened the app counts once: the phone keeps answering with it until another one.
        const opened = await notifier.openedBy();
        const fresh = opened && opened.id !== s.openedBy ? opened.id : null;
        const { delivered, nudges } = settle(s.planned, s.delivered, [...s.tapped, ...(fresh ? [fresh] : [])], now);
        const nudgesSent = s.nudgesSent + nudges;
        const permission = await notifier.permission();
        const plan =
          s.ask?.answer === "yes" && mayNotify(permission)
            ? planReminders({ now, prefs: s.prefs, delivered, lastWishAt: live.current.lastWishAt ? new Date(live.current.lastWishAt) : null, nudgesSent, dandyName: live.current.name, random: Math.random })
            : [];
        await notifier.replace(plan);
        await updateReminders((x) => ({ ...x, planned: plan.map((p) => ({ id: p.id, kind: p.kind, at: p.at.toISOString() })), delivered, tapped: [], nudgesSent, openedBy: opened?.id ?? x.openedBy }));
      } catch (e) {
        console.warn("could not plan notifications", e instanceof Error ? e.message : e);
      }
    });
  };

  // Every open, and every change that moves the plan.
  useEffect(() => {
    if (ready) plan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, lastWishAt, dandy.name, prefs, ask?.answer]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s === "active" && ready && plan());
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Signed out: nothing more for whoever signed out.
  useEffect(() => {
    if (auth.status !== "signedOut") return;
    void notifier.cancelAll().then(() => updateReminders(() => EMPTY_REMINDERS));
  }, [auth.status]);

  // A tap while the app runs.
  useEffect(
    () =>
      notifier.onTap(({ id, kind }) => {
        void updateReminders((s) => ({ ...s, tapped: [...s.tapped, id] }));
        router.push(ROUTE[kind ?? "pick"]);
      }),
    [],
  );
  return null;
}
