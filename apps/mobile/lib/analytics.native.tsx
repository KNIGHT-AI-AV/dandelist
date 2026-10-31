import { usePathname } from "expo-router";
import PostHog, { PostHogProvider } from "posthog-react-native";
import { useEffect, type ReactNode } from "react";
import { POSTHOG_HOST, POSTHOG_TOKEN, type Analytics } from "./analytics-config";
import { useAuth } from "./auth";

/**
 * The phone's analytics (PostHog's React Native SDK): screens, taps, crashes and session replay, tied to the account by
 * its id only, never its email. Replays mask every text field as it's typed in (emails, codes, wishes being written);
 * pictures show, since what's on screen is the product. Off in development builds.
 */
const client = new PostHog(POSTHOG_TOKEN, {
  host: POSTHOG_HOST,
  personProfiles: "identified_only",
  enableSessionReplay: true,
  sessionReplayConfig: { maskAllTextInputs: true, maskAllImages: false, captureLog: false, captureNetworkTelemetry: false },
  errorTracking: { autocapture: { uncaughtExceptions: true, unhandledRejections: true, console: [] } },
  captureAppLifecycleEvents: true,
  disabled: __DEV__,
});

export const analytics: Analytics = {
  capture: (event, props) => void client.capture(event, props as never),
  screen: (name) => void client.screen(name),
  error: (e, props) => void client.captureException(e instanceof Error ? e : new Error(String(e)), props as never),
  sessionId: () => client.getSessionId() || undefined,
};

/** Screens by their route, and the account by its id while signed in. */
function Tracker() {
  const path = usePathname();
  useEffect(() => void client.screen(path || "/"), [path]);
  const { status, user } = useAuth();
  const id = status === "signedIn" ? user?.id : undefined;
  useEffect(() => {
    if (id) client.identify(id);
    else if (status === "signedOut") client.reset();
  }, [id, status]);
  return null;
}

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  return (
    // Taps are recorded by the component's test id only, never the text on it (a wish's name is the person's own).
    <PostHogProvider client={client} autocapture={{ captureScreens: false, captureTouches: true, propsToCapture: ["testID"] }}>
      <Tracker />
      {children}
    </PostHogProvider>
  );
}
