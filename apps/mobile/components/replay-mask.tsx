import type { ReactNode } from "react";

/**
 * Where the phone's replay mask (replay-mask.native.tsx) doesn't apply: the web build, which has no screen picture to
 * show (lib/screen-shot.ts) and whose replay masks every piece of text and every attribute (lib/analytics.web.tsx), and
 * tests. What it wraps shows as it is.
 */
export function ReplayMask({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
