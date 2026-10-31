import { usePathname } from "expo-router";
import posthog from "posthog-js";
import { useEffect, type ReactNode } from "react";
import { POSTHOG_HOST, POSTHOG_TOKEN, type Analytics } from "./analytics-config";
import { useAuth } from "./auth";

/**
 * The web build's analytics (posthog-js): page views, clicks, errors, web vitals and session replay, tied to the
 * account by its id only. Replays mask every field and leave out request headers and bodies. Off on localhost.
 */
const live = typeof window !== "undefined" && !/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
if (live) {
  posthog.init(POSTHOG_TOKEN, {
    api_host: POSTHOG_HOST,
    person_profiles: "identified_only",
    capture_pageview: false,
    autocapture: true,
    mask_all_element_attributes: true,
    capture_exceptions: true,
    capture_performance: { web_vitals: true, network_timing: false },
    session_recording: { maskAllInputs: true, recordHeaders: false, recordBody: false },
  });
}

export const analytics: Analytics = {
  capture: (event, props) => void (live && posthog.capture(event, props)),
  screen: (name) => void (live && posthog.capture("$pageview", { $current_url: window.location.href, screen: name })),
  error: (e, props) => void (live && posthog.captureException(e instanceof Error ? e : new Error(String(e)), props)),
  sessionId: () => (live ? posthog.get_session_id() : undefined),
};

/** A page view per route, and the account by its id while signed in. */
function Tracker() {
  const path = usePathname();
  useEffect(() => analytics.screen(path || "/"), [path]);
  const { status, user } = useAuth();
  const id = status === "signedIn" ? user?.id : undefined;
  useEffect(() => {
    if (!live) return;
    if (id) posthog.identify(id);
    else if (status === "signedOut") posthog.reset();
  }, [id, status]);
  return null;
}

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  return (
    <>
      <Tracker />
      {children}
    </>
  );
}
