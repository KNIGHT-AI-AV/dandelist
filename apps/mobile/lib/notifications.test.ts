import { describe, expect, it, vi } from "vitest";
import { CHANNELS, OFF, expoNotifier, notifier, type ExpoNotificationsLike } from "./notifications";
import type { Planned } from "./reminders";

/** A stand-in for expo-notifications that records what the app asks of it. */
function fakeModule(permission: { status: string; granted: boolean; ios?: { status?: number } } = { status: "undetermined", granted: false }) {
  const calls: { name: string; args: unknown[] }[] = [];
  let listener: ((r: unknown) => void) | null = null;
  const removed = vi.fn();
  const rec =
    (name: string, out?: unknown) =>
    async (...args: unknown[]) => {
      calls.push({ name, args });
      return out;
    };
  const mod: ExpoNotificationsLike = {
    getPermissionsAsync: rec("getPermissionsAsync", permission) as ExpoNotificationsLike["getPermissionsAsync"],
    requestPermissionsAsync: rec("requestPermissionsAsync", { status: "granted", granted: false, ios: { status: 3 } }) as ExpoNotificationsLike["requestPermissionsAsync"],
    setNotificationHandler: (h) => void calls.push({ name: "setNotificationHandler", args: [h] }),
    setNotificationChannelAsync: rec("setNotificationChannelAsync", null),
    scheduleNotificationAsync: rec("scheduleNotificationAsync", "id") as ExpoNotificationsLike["scheduleNotificationAsync"],
    cancelAllScheduledNotificationsAsync: rec("cancelAllScheduledNotificationsAsync") as ExpoNotificationsLike["cancelAllScheduledNotificationsAsync"],
    addNotificationResponseReceivedListener: (l) => {
      listener = l as (r: unknown) => void;
      return { remove: removed };
    },
    getLastNotificationResponseAsync: async () => ({ notification: { request: { identifier: "pick-2026-10-06", content: { data: { kind: "pick" } } } } }),
    AndroidImportance: { LOW: 2, DEFAULT: 3 },
    SchedulableTriggerInputTypes: { DATE: "date" },
    IosAuthorizationStatus: { PROVISIONAL: 3 },
  };
  return { mod, calls, removed, tap: (r: unknown) => listener?.(r) };
}

const plan: Planned[] = [
  { id: "pick-2026-10-06", kind: "pick", at: new Date(2026, 9, 6, 9), title: "Today's pick", body: "Hugo found something new for your list.", passive: true },
  { id: "nudge-2026-10-08", kind: "nudge", at: new Date(2026, 9, 8, 14, 12), title: null, body: "Seen something lately you'd love? Add it to your list.", passive: false },
];

describe("the phone's notifications", () => {
  it("stay off until switched on, and say so", async () => {
    expect(notifier).toBe(OFF);
    expect(notifier.available).toBe(false);
    expect(await notifier.permission()).toBe("undetermined");
    await expect(notifier.replace(plan)).resolves.toBeUndefined();
  });

  it("ask iOS provisionally and read what the phone allows", async () => {
    const { mod, calls } = fakeModule();
    const n = expoNotifier(mod, "ios");
    expect(n.available).toBe(true);
    expect(await n.request()).toBe("provisional");
    expect(calls.find((c) => c.name === "requestPermissionsAsync")!.args[0]).toEqual({ ios: { allowAlert: true, allowSound: true, allowBadge: false, allowProvisional: true } });
    expect(await n.permission()).toBe("undetermined");
    expect(await expoNotifier(fakeModule({ status: "granted", granted: true }).mod, "ios").permission()).toBe("granted");
    expect(await expoNotifier(fakeModule({ status: "denied", granted: false, ios: { status: 1 } }).mod, "ios").permission()).toBe("denied");
    // Nothing pops up over the app while someone is using it.
    const handler = calls.find((c) => c.name === "setNotificationHandler")!.args[0] as { handleNotification(): Promise<Record<string, boolean>> };
    expect(await handler.handleNotification()).toEqual({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false });
  });

  it("replaces what was scheduled with the plan: the pick passive, at its local time, on its own Android channel", async () => {
    const { mod, calls } = fakeModule();
    const n = expoNotifier(mod, "android");
    await n.replace(plan);
    await n.replace(plan);
    expect(calls.filter((c) => c.name === "setNotificationChannelAsync").map((c) => c.args)).toEqual([
      [CHANNELS.pick.id, { name: "Today's pick", importance: 2 }],
      [CHANNELS.reminders.id, { name: "Reminders", importance: 3 }],
    ]);
    const order = calls.filter((c) => c.name !== "setNotificationChannelAsync" && c.name !== "setNotificationHandler").map((c) => c.name);
    expect(order).toEqual(["cancelAllScheduledNotificationsAsync", "scheduleNotificationAsync", "scheduleNotificationAsync", "cancelAllScheduledNotificationsAsync", "scheduleNotificationAsync", "scheduleNotificationAsync"]);
    const [pick, nudge] = calls.filter((c) => c.name === "scheduleNotificationAsync").map((c) => c.args[0]);
    expect(pick).toEqual({
      identifier: "pick-2026-10-06",
      content: { title: "Today's pick", body: "Hugo found something new for your list.", data: { kind: "pick", id: "pick-2026-10-06" }, sound: false, interruptionLevel: "passive" },
      trigger: { type: "date", date: plan[0]!.at, channelId: "daily-pick" },
    });
    expect(nudge).toMatchObject({ content: { title: null, interruptionLevel: "active" }, trigger: { channelId: "reminders" } });
    // iOS has no channels.
    const ios = fakeModule();
    await expoNotifier(ios.mod, "ios").replace(plan);
    expect(ios.calls.some((c) => c.name === "setNotificationChannelAsync")).toBe(false);
  });

  it("follows taps, and says which one opened the app", async () => {
    const { mod, tap, removed } = fakeModule();
    const n = expoNotifier(mod, "ios");
    const seen: unknown[] = [];
    const stop = n.onTap((t) => seen.push(t));
    tap({ notification: { request: { identifier: "nudge-2026-10-08", content: { data: { kind: "nudge" } } } } });
    tap({ notification: { request: { identifier: "other", content: { data: { kind: "promo" } } } } });
    expect(seen).toEqual([{ id: "nudge-2026-10-08", kind: "nudge" }, { id: "other", kind: null }]);
    stop();
    expect(removed).toHaveBeenCalledOnce();
    expect(await n.openedBy()).toEqual({ id: "pick-2026-10-06", kind: "pick" });
  });
});
