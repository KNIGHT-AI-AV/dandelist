/**
 * The Dandy's personality as the request helpers see it (lib/agent, lib/dream). Kept apart from lib/dandy, which
 * reads device storage, so those helpers and their tests load without React Native.
 */
export type PersonaId = "heir" | "it-girl" | "old-money" | "mogul";

let current: PersonaId | undefined;

/** Set by lib/dandy whenever the Dandy loads or changes. */
export function setCurrentPersona(p: PersonaId | undefined): void {
  current = p;
}

/** The personality to send with agent requests; none until the Dandy has loaded on this device. */
export const currentPersona = (): PersonaId | undefined => current;
