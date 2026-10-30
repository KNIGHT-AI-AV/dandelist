import { OFF, type Notifier } from "./notifications-core";

export * from "./notifications-core";

/** The web has no local notifications; phones get the real one from notifications.native.ts. */
export const notifier: Notifier = OFF;
