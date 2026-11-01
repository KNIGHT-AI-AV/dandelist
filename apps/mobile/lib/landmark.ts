import { Platform } from "react-native";

/**
 * A screen's own content as the page's main landmark, on the web only, spread on the screen's outermost view: axe found
 * every screen's content outside any landmark (2026-11-01), so a screen reader had nothing to jump to. On the phones a
 * role would replace the traits a view already gives (iOS), so there it is nothing.
 */
export const MAIN = Platform.OS === "web" ? { role: "main" as const } : null;
