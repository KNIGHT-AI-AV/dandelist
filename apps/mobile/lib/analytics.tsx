import type { ReactNode } from "react";
import type { Analytics } from "./analytics-config";

/**
 * Analytics where no platform file applies (tests, scripts): nothing is sent. The phone uses analytics.native.tsx and
 * the web build analytics.web.tsx, both on PostHog (lib/analytics-config.ts).
 */
export const analytics: Analytics = {
  capture: () => undefined,
  screen: () => undefined,
  error: () => undefined,
  sessionId: () => undefined,
};

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
