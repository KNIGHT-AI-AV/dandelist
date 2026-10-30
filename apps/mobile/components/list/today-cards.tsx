import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState, Text, View } from "react-native";
import { endTask, startTask } from "../../lib/activity";
import { useAuth } from "../../lib/auth";
import { useDandy } from "../../lib/dandy";
import { haptic } from "../../lib/motion";
import { notifier } from "../../lib/notifications";
import { answerPick, fetchTodayPick, hiddenDay, hideForDay, localDay, showsPick, wasPickAdded, type TodayPick } from "../../lib/picks";
import { isFirstLaunch, updateReminders, useReminderState } from "../../lib/reminder-state";
import { shouldAsk, type Permission } from "../../lib/reminders";
import { layout, radius, space, type, usePalette, useType } from "../../lib/theme";
import { useWishes } from "../../lib/wishes";
import { AgentDot, Eyebrow, Glass, IconButton, Photo, PrimaryButton, QuietButton, Shade } from "../lux";
import { Presence } from "./presence";

/** A request still waiting after this shows "Finding today's pick" in the Dandy's corner. */
const SLOW_MS = 800;
/** While another request makes the pick, ask again this often, a few times. */
const PENDING_MS = 4000;
const PENDING_TRIES = 4;
/** "Noted" stays this long before the card goes. */
const NOTED_MS = 2400;
const PHOTO_HEIGHT = 200;

/** Picks already fetched this run of the app, by person and day, so the list opening again asks nothing. */
const seen = new Map<string, TodayPick>();

/**
 * Today's pick for the list (lib/picks.ts): asked for once the person has a wish, again when the app comes back on a
 * new day. The close button hides it until tomorrow on this device.
 */
function useTodayPick() {
  const auth = useAuth();
  const { wishes, status } = useWishes();
  const dandy = useDandy();
  const [day, setDay] = useState(localDay);
  const [pick, setPick] = useState<TodayPick | null>(null);
  // undefined until read from the device.
  const [hidden, setHidden] = useState<string | null | undefined>(undefined);
  const [noted, setNoted] = useState(false);
  const persona = useRef(dandy.persona);
  persona.current = dandy.persona;
  const userId = auth.user?.id ?? null;
  const hasWish = wishes.length > 0;

  // Closing the card is remembered per person on this device.
  useEffect(() => {
    if (userId) void hiddenDay(userId).then(setHidden);
  }, [userId]);

  useEffect(() => {
    // Coming back on another day brings that day's pick.
    const sub = AppState.addEventListener("change", (s) => s === "active" && setDay(localDay()));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (auth.status !== "signedIn" || status !== "ready" || !hasWish || !userId) return;
    const key = `${userId}:${day}`;
    const known = seen.get(key);
    if (known) {
      setPick(known);
      return;
    }
    let live = true;
    let tries = 0;
    let task: string | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const slow = setTimeout(() => (task = startTask("Finding today's pick")), SLOW_MS);
    const done = () => {
      clearTimeout(slow);
      if (task) endTask(task);
      task = null;
    };
    const ask = async () => {
      try {
        const r = await fetchTodayPick(auth.api, day, persona.current);
        if (!live) return;
        if (r.pending && ++tries <= PENDING_TRIES) {
          retry = setTimeout(() => void ask(), PENDING_MS);
          return;
        }
        // Only a pick is kept: no pick yet is asked again next time the list opens.
        if (r.pick) seen.set(key, r.pick);
        setPick(r.pick);
      } catch {
        // No pick today is a fine answer; the next open asks again.
      }
      done();
    };
    void ask();
    return () => {
      live = false;
      clearTimeout(retry);
      done();
    };
  }, [auth.status, auth.api, status, hasWish, userId, day]);

  const decide = (outcome: "added" | "skipped") => {
    if (!pick) return;
    const next = { ...pick, status: outcome };
    if (userId) seen.set(`${userId}:${pick.day}`, next);
    void answerPick(auth.api, pick.id, outcome).catch(() => {});
    return next;
  };

  return {
    day,
    pick,
    noted,
    visible: hidden !== undefined && showsPick(pick, day, hidden) && !wasPickAdded(pick.id),
    /**
     * Adds it the usual way: the new wish screen hunts its real price, and "added" is recorded once the person saves
     * it there. Backing out leaves the pick on the list.
     */
    add() {
      if (!pick) return;
      router.push({ pathname: "/wishes/new", params: { text: pick.title, pick: pick.id } });
    },
    skip() {
      const next = decide("skipped");
      if (!next) return;
      haptic.select();
      setNoted(true);
      setTimeout(() => {
        setPick(next);
        setNoted(false);
      }, NOTED_MS);
    },
    close() {
      setHidden(day);
      if (userId) void hideForDay(userId, day);
    },
  };
}

function PickCard({ pick, noted, onAdd, onSkip, onClose }: { pick: TodayPick; noted: boolean; onAdd(): void; onSkip(): void; onClose(): void }) {
  const p = usePalette();
  const t = useType();
  const close = <IconButton icon="close" label="Hide today's pick until tomorrow" onPress={onClose} />;
  const label = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[8] }}>
      <AgentDot />
      <Eyebrow color={p.ink}>Today's pick</Eyebrow>
    </View>
  );
  return (
    <Glass style={{ borderRadius: radius.lg, borderCurve: "continuous" }}>
      {pick.photo ? (
        <View style={{ height: PHOTO_HEIGHT }}>
          <Photo uri={pick.photo.url} />
          <Shade from={0.2} />
          <View style={{ position: "absolute", left: layout.cardPad, right: layout.cardPad, bottom: space[12], gap: layout.stack.tight }}>
            {label}
            <Text accessibilityRole="header" numberOfLines={2} style={[t.title2, { color: p.ink }]}>
              {pick.title}
            </Text>
          </View>
          <View style={{ position: "absolute", top: space[12], right: space[12] }}>{close}</View>
        </View>
      ) : (
        <View style={{ paddingTop: layout.cardPad, paddingHorizontal: layout.cardPad, gap: layout.stack.tight }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            {label}
            {close}
          </View>
          <Text accessibilityRole="header" style={[t.title2, { color: p.ink }]}>
            {pick.title}
          </Text>
        </View>
      )}
      <View style={{ padding: layout.cardPad, paddingTop: pick.photo ? space[12] : layout.stack.tight, gap: layout.stack.base }}>
        <Text style={[type.callout, { color: p.ink2 }]}>{pick.why}</Text>
        {noted ? (
          <Text accessibilityLiveRegion="polite" style={[type.footnote, { color: p.ink3 }]}>
            Noted. Tomorrow's pick will learn from this.
          </Text>
        ) : (
          <View style={{ gap: space[4] }}>
            <PrimaryButton label="Add to my list" commit onPress={onAdd} />
            <QuietButton label="Not for me" onPress={onSkip} style={{ alignSelf: "center" }} />
          </View>
        )}
        {pick.photo?.credit ? (
          <Text numberOfLines={1} style={[type.figure, { color: p.ink3 }]}>
            {[pick.photo.credit, pick.photo.license].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
      </View>
    </Glass>
  );
}

/**
 * The soft ask before the phone's own (owner's brief, 2026-10-29): once there is a wish, never on the first launch.
 * "Yes" asks the phone (provisionally on iOS, so picks arrive quietly until they choose Keep); "Not now" waits a month.
 */
function AskCard({ hold }: { hold: boolean }) {
  const p = usePalette();
  const { wishes } = useWishes();
  const { ask } = useReminderState();
  const [permission, setPermission] = useState<Permission | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => void notifier.permission().then(setPermission), []);
  const show = !hold && permission !== null && shouldAsk({ available: notifier.available, permission, wishes: wishes.length, firstLaunch: isFirstLaunch(), ask, now: new Date() });
  const answer = (a: "yes" | "later") => updateReminders((s) => ({ ...s, ask: { answer: a, at: new Date().toISOString(), laters: (s.ask?.laters ?? 0) + (a === "later" ? 1 : 0) } }));
  const yes = async () => {
    setBusy(true);
    try {
      const allowed = await notifier.request();
      await answer("yes");
      setPermission(allowed);
      haptic.success();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Presence show={show}>
      <Glass style={{ borderRadius: radius.lg, borderCurve: "continuous", padding: layout.cardPad, gap: layout.stack.base }}>
        <View style={{ gap: layout.stack.tight }}>
          <Text style={[type.title3, { color: p.ink }]}>Want a daily pick and the odd nudge?</Text>
          <Text style={[type.callout, { color: p.ink2 }]}>One new find each morning, and once in a while a reminder to add what you've spotted. You can change both in Settings.</Text>
        </View>
        <View style={{ gap: space[4] }}>
          <PrimaryButton label="Yes" busy={busy} onPress={() => void yes()} />
          <QuietButton label="Not now" onPress={() => void answer("later")} style={{ alignSelf: "center" }} />
        </View>
      </Glass>
    </Presence>
  );
}

/**
 * The cards at the head of the list (owner, 2026-10-29: "daily item suggestions with notifications and banner pop up
 * cards"): today's pick, and when no pick is showing, the ask about notifications. Each opens its space when it
 * arrives and closes it when it goes; under reduced motion they only fade.
 */
export function TodayCards() {
  const s = useTodayPick();
  return (
    <>
      <Presence show={s.visible}>{s.pick ? <PickCard pick={s.pick} noted={s.noted} onAdd={s.add} onSkip={s.skip} onClose={s.close} /> : null}</Presence>
      {notifier.available ? <AskCard hold={s.visible} /> : null}
    </>
  );
}
