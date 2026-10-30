import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { expoNotifier, type Notifier } from "./notifications-core";

export * from "./notifications-core";

/** The phone's own local notifications (lib/notifications-core.ts says what they're for and why push is stripped). */
export const notifier: Notifier = expoNotifier(Notifications, Platform.OS);
