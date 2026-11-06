import { useEffect, useSyncExternalStore } from "react";
import { getSecret, setSecret } from "./storage";

/**
 * Permission to send what someone adds to the AI services, with the 18-or-older confirmation (App Store guideline
 * 5.1.2(i): name the third party and ask before the first send; Meta's Model API terms §10.1: every end user is 18+).
 * Asked once on a device (components/ai-consent.tsx). Bump the version when what is sent, or to whom, changes, so
 * everyone is asked again.
 */
const KEY = "dandelist.ai-consent";
export const AI_CONSENT_VERSION = "1";

let given: boolean | null = null;
let reading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const settle = (value: boolean) => {
  // A yes given while the device was still being read wins over what the read finds.
  if (given !== null) return;
  given = value;
  emit();
};

/** Reads this device's answer once; later calls share the same read. */
export function loadAiConsent(): Promise<void> {
  reading ??= getSecret(KEY).then(
    (v) => settle(v === AI_CONSENT_VERSION),
    () => settle(false),
  );
  return reading;
}

/** The yes: the app may send from now on, and the device remembers it. */
export async function giveAiConsent(): Promise<void> {
  given = true;
  emit();
  await setSecret(KEY, AI_CONSENT_VERSION);
}

/** True once given on this device, false if not, null while the device is still being read. */
export const aiConsent = (): boolean | null => given;

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** The answer as state, read on first use. */
export function useAiConsent(): boolean | null {
  const value = useSyncExternalStore(subscribe, aiConsent, aiConsent);
  useEffect(() => void loadAiConsent(), []);
  return value;
}

/** Tests only: forget the answer and the read, as a fresh launch would. */
export function resetAiConsentForTests() {
  given = null;
  reading = null;
}
