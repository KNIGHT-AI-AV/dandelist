import type { Permission, Planned, ReminderKind } from "./reminders";

/**
 * The one module that touches the phone's notifications. Everything else plans with lib/reminders.ts and talks to
 * `notifier` here. Local notifications only: no push server, no keys.
 *
 * SWITCHED OFF FOR NOW, and so the app hides everything about notifications (the Settings section and the "Want a
 * daily pick?" card); today's pick still shows on the list. Why: the expo-notifications version Expo SDK 57 expects
 * (~57.0.22; 57.0.22 and 57.0.23 are both over 14 days old) fails this repo's pnpm trust policy, because Expo began
 * publishing its next line with trusted-publisher evidence on 2026-08-06 and these 57.0.x releases came after without
 * it (ERR_PNPM_TRUST_DOWNGRADE, the same story as expo-asset 57.0.19). Its new dependency expo-application 57.0.3 fails
 * the same way. The policy stays on; switching on needs the owner's say-so for those two.
 *
 * To switch on:
 *   1. With the owner's approval, add "expo-notifications@57.0.22" and "expo-application@57.0.3" to trustPolicyExclude in
 *      pnpm-workspace.yaml (57.0.22 rather than 57.0.23: it shares expo-constants 57.0.21 with the rest of the app, where
 *      57.0.23 would bring a second copy of that native module), then
 *      corepack pnpm --filter @dandelist/mobile add expo-notifications@57.0.22
 *   2. Below, replace `export const notifier: Notifier = OFF;` with
 *        import { Platform } from "react-native";
 *        import * as Notifications from "expo-notifications";
 *        export const notifier: Notifier = Platform.OS === "web" ? OFF : expoNotifier(Notifications, Platform.OS);
 *   3. iOS: the package's config plugin, which Expo applies on its own once the package is installed, writes the
 *      aps-environment (push) entitlement even for local notifications (expo/expo sdk-57 branch, withNotificationsIOS.ts).
 *      Either turn on Push Notifications for com.knightaiav.dandelist and use a profile that includes it, or add a small
 *      config plugin that deletes aps-environment after it. Then a new build: the module is native.
 */

export interface Notifier {
  /** False while switched off, and always on the web. */
  available: boolean;
  /** What the phone allows now. */
  permission(): Promise<Permission>;
  /** Asks the phone, only after the person said yes in the app. On iOS provisionally: no system prompt, and picks arrive quietly until they choose Keep. */
  request(): Promise<Permission>;
  /** Replaces everything this app has scheduled with `plan`. */
  replace(plan: Planned[]): Promise<void>;
  cancelAll(): Promise<void>;
  /** Calls `on` for each notification the person taps while the app runs; returns the unsubscribe. */
  onTap(on: (tap: { id: string; kind: ReminderKind | null }) => void): () => void;
  /** The notification whose tap opened the app, if one did. */
  openedBy(): Promise<{ id: string; kind: ReminderKind | null } | null>;
}

export const OFF: Notifier = {
  available: false,
  permission: async () => "undetermined",
  request: async () => "undetermined",
  replace: async () => {},
  cancelAll: async () => {},
  onTap: () => () => {},
  openedBy: async () => null,
};

/** The phone's notifications. Switched off until the module above is switched on. */
export const notifier: Notifier = OFF;

/**
 * The slice of expo-notifications (SDK 57) this app uses, typed loosely enough that the real module fits it as it is.
 * Parameter shapes follow the docs: DATE triggers with a channel on Android, interruptionLevel on iOS 15 and later.
 */
export interface ExpoNotificationsLike {
  getPermissionsAsync(): Promise<PermissionLike>;
  requestPermissionsAsync(request?: object): Promise<PermissionLike>;
  setNotificationHandler(handler: object | null): void;
  setNotificationChannelAsync(id: string, channel: object): Promise<unknown>;
  scheduleNotificationAsync(request: { identifier?: string; content: object; trigger: object | null }): Promise<string>;
  cancelAllScheduledNotificationsAsync(): Promise<void>;
  addNotificationResponseReceivedListener(listener: (response: ResponseLike) => void): { remove(): void };
  getLastNotificationResponseAsync?(): Promise<ResponseLike | null>;
  AndroidImportance: { LOW: number; DEFAULT: number };
  SchedulableTriggerInputTypes: { DATE: string };
  IosAuthorizationStatus: { PROVISIONAL: number };
}

interface PermissionLike {
  status: string;
  granted: boolean;
  ios?: { status?: number } | null;
}

interface ResponseLike {
  notification: { request: { identifier: string; content: { data?: Record<string, unknown> | null } } };
}

/** Android channels, as the person sees them in the phone's settings. */
export const CHANNELS = {
  pick: { id: "daily-pick", name: "Today's pick" },
  reminders: { id: "reminders", name: "Reminders" },
} as const;

const KINDS: ReminderKind[] = ["pick", "nudge", "pause"];
const kindOf = (r: ResponseLike): ReminderKind | null => {
  const k = r.notification.request.content.data?.kind;
  return KINDS.includes(k as ReminderKind) ? (k as ReminderKind) : null;
};

/** The phone's notifications through expo-notifications. Tested against a stand-in of the module. */
export function expoNotifier(mod: ExpoNotificationsLike, os: string): Notifier {
  const read = (p: PermissionLike): Permission =>
    p.granted ? "granted" : p.ios?.status === mod.IosAuthorizationStatus.PROVISIONAL ? "provisional" : p.status === "denied" ? "denied" : "undetermined";
  // The app open is the pick: nothing pops up over it while someone is using it.
  mod.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }) });
  let channels: Promise<unknown> | null = null;
  const ensureChannels = () =>
    (channels ??= os === "android"
      ? Promise.all([
          mod.setNotificationChannelAsync(CHANNELS.pick.id, { name: CHANNELS.pick.name, importance: mod.AndroidImportance.LOW }),
          mod.setNotificationChannelAsync(CHANNELS.reminders.id, { name: CHANNELS.reminders.name, importance: mod.AndroidImportance.DEFAULT }),
        ])
      : Promise.resolve());
  return {
    available: true,
    permission: async () => read(await mod.getPermissionsAsync()),
    request: async () => read(await mod.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false, allowProvisional: true } })),
    async replace(plan) {
      await ensureChannels();
      await mod.cancelAllScheduledNotificationsAsync();
      for (const n of plan) {
        await mod.scheduleNotificationAsync({
          identifier: n.id,
          content: { title: n.title, body: n.body, data: { kind: n.kind, id: n.id }, sound: false, interruptionLevel: n.passive ? "passive" : "active" },
          trigger: { type: mod.SchedulableTriggerInputTypes.DATE, date: n.at, channelId: n.kind === "nudge" ? CHANNELS.reminders.id : CHANNELS.pick.id },
        });
      }
    },
    cancelAll: () => mod.cancelAllScheduledNotificationsAsync(),
    onTap(on) {
      const sub = mod.addNotificationResponseReceivedListener((r) => on({ id: r.notification.request.identifier, kind: kindOf(r) }));
      return () => sub.remove();
    },
    async openedBy() {
      const r = (await mod.getLastNotificationResponseAsync?.()) ?? null;
      return r ? { id: r.notification.request.identifier, kind: kindOf(r) } : null;
    },
  };
}
