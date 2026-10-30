import { useEffect, useSyncExternalStore } from "react";
import { getSecret, setSecret } from "./storage";
import { DEFAULT_PREFS, type AskState, type Delivered, type ReminderKind, type ReminderPrefs } from "./reminders";

/**
 * What this phone remembers about its notifications: the person's settings, their answer to the "Want a daily pick?"
 * card, what was scheduled at the last open, and what was delivered and tapped, so the next plan can learn from it.
 * One store for the app, kept on the device.
 */

export interface ReminderState {
  prefs: ReminderPrefs;
  ask: AskState | null;
  planned: { id: string; kind: ReminderKind; at: string }[];
  delivered: Delivered[];
  /** Taps since the last plan, by notification id. */
  tapped: string[];
  /** Nudges delivered so far, so each one says something new. */
  nudgesSent: number;
  /** The notification whose tap opened the app last, once counted, so it is never counted twice. */
  openedBy: string | null;
}

const KEY = "dandelist.reminders";
export const EMPTY_REMINDERS: ReminderState = { prefs: DEFAULT_PREFS, ask: null, planned: [], delivered: [], tapped: [], nudgesSent: 0, openedBy: null };

let state: ReminderState = EMPTY_REMINDERS;
let loading: Promise<ReminderState> | null = null;
/** True when this device had nothing saved as the app started: its first launch, when nothing is asked. */
let firstLaunch = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Reads the store once per app start. */
export function loadReminders(): Promise<ReminderState> {
  loading ??= (async () => {
    try {
      const raw = await getSecret(KEY);
      firstLaunch = raw === null;
      if (raw) {
        const saved = JSON.parse(raw) as Partial<ReminderState>;
        state = { ...EMPTY_REMINDERS, ...saved, prefs: { ...DEFAULT_PREFS, ...(saved.prefs ?? {}) } };
      } else {
        // Written now, so the next launch is not the first.
        await setSecret(KEY, JSON.stringify(state));
      }
    } catch {}
    emit();
    return state;
  })();
  return loading;
}

export const isFirstLaunch = () => firstLaunch;

/** Changes the store and keeps it on the device. */
export async function updateReminders(change: (s: ReminderState) => ReminderState): Promise<ReminderState> {
  await loadReminders();
  state = change(state);
  emit();
  try {
    await setSecret(KEY, JSON.stringify(state));
  } catch {}
  return state;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** The store, kept current across screens. */
export function useReminderState(): ReminderState {
  useEffect(() => void loadReminders(), []);
  return useSyncExternalStore(subscribe, () => state, () => state);
}
