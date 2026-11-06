import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { bindToSignIn, currentSignIn, onConsentRequired, SignInChanged, useAuth } from "./auth";

/**
 * The signed-in account's acceptance of how Dandelist uses AI, as the API keeps it (apps/api src/consent.ts; the owner,
 * 2026-11-06: "It should be the first thing they do when they login to their account or make their account is accept").
 * Read from the account at every sign-in, never from the device: a yes on one device holds on the others, and another
 * account on the same device is asked for its own. Only the server's saved yes opens the app (components/consent-gate).
 */
export const AI_CONSENT_VERSION = 1;

/**
 * `none`: signed out, or the session still being restored: nothing to gate. `checking`: signed in, the answer not read
 * yet. `required`: the account hasn't accepted (or accepted older words). `failed`: the answer couldn't be read.
 */
export type ConsentState = "none" | "checking" | "required" | "accepted" | "failed";

interface AccountConsent {
  state: ConsentState;
  /** A yes is being saved: the button waits, and a second tap does nothing. */
  saving: boolean;
  /** Why the last read or save didn't work, in words to show. */
  error: string | null;
  /** Saves the yes; the app opens only once the server has it. */
  accept(): Promise<void>;
  /** Reads the account's answer again after a failed read. */
  retry(): void;
}

const Ctx = createContext<AccountConsent | null>(null);

type ConsentBody = { consent?: { accepted?: boolean }; error?: string; code?: string };
const OFFLINE = "Couldn't reach Dandelist just now. Check your connection and try again.";

export function AccountConsentProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const account = auth.status === "signedIn" ? (auth.user?.id ?? null) : null;
  const [state, setState] = useState<ConsentState>("none");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reads, setReads] = useState(0);
  // The sign-in the current answer belongs to: an answer for any other (a sign-out, another account) is dropped.
  const owner = useRef<number | null>(null);
  const api = useRef(auth.api);
  api.current = auth.api;

  useEffect(() => {
    setSaving(false);
    setError(null);
    if (!account) {
      owner.current = null;
      setState("none");
      return;
    }
    const at = currentSignIn();
    owner.current = at;
    setState("checking");
    let live = true;
    const mine = () => live && owner.current === at && currentSignIn() === at;
    void bindToSignIn(api.current, at)("/me/consent")
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as ConsentBody | null;
        if (!mine()) return;
        if (res.ok && body?.consent) setState(body.consent.accepted ? "accepted" : "required");
        else {
          setError(body?.error ?? OFFLINE);
          setState("failed");
        }
      })
      .catch((e: unknown) => {
        if (e instanceof SignInChanged || !mine()) return;
        setError(OFFLINE);
        setState("failed");
      });
    return () => {
      live = false;
    };
  }, [account, auth.status, reads]);

  // The server turned a request down for want of the consent (new words since this sign-in read its answer): ask again.
  useEffect(
    () =>
      onConsentRequired((at) => {
        if (owner.current !== null && at === owner.current && currentSignIn() === at) setState("required");
      }),
    [],
  );

  // The sign-in whose yes is being saved: a second tap for it does nothing; another account's tap is its own.
  const busy = useRef<number | null>(null);
  const accept = useCallback(async () => {
    const at = owner.current;
    if (at === null || busy.current === at) return;
    busy.current = at;
    setSaving(true);
    setError(null);
    const mine = () => owner.current === at && currentSignIn() === at;
    try {
      const res = await bindToSignIn(api.current, at)("/me/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: AI_CONSENT_VERSION }),
      });
      const body = (await res.json().catch(() => null)) as ConsentBody | null;
      if (!mine()) return;
      if (res.ok && body?.consent?.accepted) setState("accepted");
      else setError(body?.error ?? "Couldn't save that. Try again.");
    } catch (e) {
      if (!(e instanceof SignInChanged) && mine()) setError(OFFLINE);
    } finally {
      if (busy.current === at) busy.current = null;
      if (owner.current === at) setSaving(false);
    }
  }, []);

  const retry = useCallback(() => setReads((n) => n + 1), []);
  return <Ctx.Provider value={{ state, saving, error, accept, retry }}>{children}</Ctx.Provider>;
}

export function useAccountConsent(): AccountConsent {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAccountConsent needs AccountConsentProvider");
  return v;
}

/** Whether the app itself may be shown: signed out (the welcome and sign-in), or signed in with the server's yes. */
export const appOpen = (status: "loading" | "signedOut" | "signedIn", state: ConsentState) => status !== "signedIn" || state === "accepted";
