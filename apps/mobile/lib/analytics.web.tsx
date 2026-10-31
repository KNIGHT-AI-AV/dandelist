import { usePathname } from "expo-router";
import posthog from "posthog-js";
import { useEffect, type ReactNode } from "react";
import { POSTHOG_HOST, POSTHOG_TOKEN, type Analytics } from "./analytics-config";
import { bareUrl, privatePath, scrub } from "./analytics-scrub";
import { useAuth } from "./auth";

/**
 * The web build's analytics (posthog-js): page views, clicks, errors, web vitals and session replay, tied to the
 * account by its id only. Nothing a person wrote or is called reaches PostHog (review of #139): replays mask every
 * field, every piece of text and every element attribute (accessibility labels carry wish names), clicks carry no
 * element text or attributes, and every address the SDK attaches is cut to its path, so a sign-in link's one-time ticket
 * never leaves the page. The SDK doesn't even start on a sign-in page, so it never stores that address as where the
 * visit began; it starts on the first page after. Off on localhost.
 */
const live = typeof window !== "undefined" && !/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
let started = false;

/** Starts PostHog once, and never while a sign-in page is open. */
function start(path: string): void {
  if (!live || started || privatePath(path)) return;
  started = true;
  posthog.init(POSTHOG_TOKEN, {
    api_host: POSTHOG_HOST,
    person_profiles: "identified_only",
    capture_pageview: false,
    autocapture: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    capture_exceptions: true,
    capture_performance: { web_vitals: true, network_timing: false },
    session_recording: { maskAllInputs: true, maskTextSelector: "*", maskAllElementAttributes: true, recordHeaders: false, recordBody: false },
    before_send: (event) => scrub(event),
  });
}
if (typeof window !== "undefined") start(window.location.pathname);

export const analytics: Analytics = {
  capture: (event, props) => void (started && posthog.capture(event, props)),
  screen: (name) => void (started && !privatePath(name) && posthog.capture("$pageview", { $current_url: bareUrl(window.location.href), screen: name })),
  error: (e, props) => void (started && posthog.captureException(e instanceof Error ? e : new Error(String(e)), props)),
  sessionId: () => (started ? posthog.get_session_id() : undefined),
};

/** A page view per route, and the account by its id while signed in. */
function Tracker() {
  const path = usePathname();
  useEffect(() => {
    const where = path || "/";
    // Leaving a sign-in page starts PostHog if the visit began on one; on a sign-in page nothing records.
    start(where);
    if (started && privatePath(where)) posthog.stopSessionRecording();
    else if (started && !posthog.sessionRecordingStarted()) posthog.startSessionRecording();
    analytics.screen(where);
  }, [path]);
  const { status, user } = useAuth();
  const id = status === "signedIn" ? user?.id : undefined;
  useEffect(() => {
    if (!started) return;
    if (id) posthog.identify(id);
    else if (status === "signedOut") posthog.reset();
  }, [id, status, path]);
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
