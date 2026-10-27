import * as AppleAuthentication from "expo-apple-authentication";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { getSecret, setSecret } from "./storage";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8080";
const REFRESH_KEY = "dandelist.refresh";
/** The secret for the provider sign-in in progress; its ticket redeems only with this. */
const VERIFIER_KEY = "dandelist.oauth.verifier";

type User = { id: string; email: string };
type Status = "loading" | "signedOut" | "signedIn";

export type ProviderId = "apple" | "google" | "github";
/** A sign-in option to offer here. `native` means the system sheet (Apple on iOS); otherwise the API's browser flow. */
export type SignInOption = { id: ProviderId; native: boolean };

interface Auth {
  status: Status;
  user: User | null;
  startEmail(email: string): Promise<void>;
  verifyEmail(email: string, code: string): Promise<void>;
  /**
   * Signs in with Google, GitHub or Apple through the API. On the web the page leaves for the provider and comes back
   * at /auth/callback. On a phone it opens a browser sheet and resolves true once signed in, false if the person
   * backed out.
   */
  signInWith(provider: ProviderId): Promise<boolean>;
  /** Sign in with Apple through the iOS system sheet. Resolves false if the person backed out. */
  signInWithApple(): Promise<boolean>;
  /** Swaps the one-time ticket from a finished provider sign-in for a session. Safe to call twice with one ticket. */
  redeemTicket(ticket: string): Promise<void>;
  signOut(): Promise<void>;
  /** fetch against the API with the access token, refreshing once on 401. */
  api(path: string, init?: RequestInit): Promise<Response>;
}

const AuthContext = createContext<Auth | null>(null);

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {}
  return "Something went wrong. Try again.";
}

async function post(path: string, body: unknown, token?: string) {
  return fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

const PROVIDER_ORDER: ProviderId[] = ["apple", "google", "github"];
const PROVIDER_NAME: Record<ProviderId, string> = { apple: "Apple", google: "Google", github: "GitHub" };

/** What the person sees when a provider sign-in comes back without a ticket; `null` when there is nothing to say. */
export function signInErrorMessage(code: string | null | undefined): string | null {
  switch (code) {
    case undefined:
    case null:
    case "":
    case "cancelled":
      return null;
    case "expired":
      return "That sign-in took too long. Try again.";
    case "no_email":
      return "That account has no verified email address. Verify one with the provider, or use an email code below.";
    default:
      return "That sign-in didn't go through. Try again.";
  }
}

/** Where the API should send a phone back to: the app's own scheme, or Expo Go's address while developing. */
function appReturnUrl(): string {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient ? Linking.createURL("auth") : "dandelist://auth";
}

/**
 * Makes a fresh secret for one sign-in attempt, keeps it on this device and returns its SHA-256 (base64url). The API
 * binds the ticket to that hash, so only this app, holding the secret, can redeem it; another app that catches the
 * dandelist://auth redirect gets nothing it can use. Hermes has no Web Crypto, so the randomness comes from expo-crypto
 * (the system generator on phones, crypto.getRandomValues on the web).
 */
async function newChallenge(): Promise<string> {
  const verifier = Array.from(Crypto.getRandomBytes(32), (b) => b.toString(16).padStart(2, "0")).join("");
  await setSecret(VERIFIER_KEY, verifier);
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 });
  return digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const startUrl = (provider: ProviderId, redirect: string, challenge: string) =>
  `${API_URL}/auth/oauth/${provider}/start?redirect=${encodeURIComponent(redirect)}&challenge=${challenge}`;

let brokerPending = false;
/**
 * True while a phone sign-in sheet is open. Android also delivers the return address to the router, which opens
 * /auth; that screen steps back and lets the waiting sign-in finish instead of racing it.
 */
export function isBrokerPending(): boolean {
  return brokerPending;
}

/** The sign-in options the API has turned on that work on this device, in display order; null while loading. */
export function useSignInOptions(): SignInOption[] | null {
  const [options, setOptions] = useState<SignInOption[] | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const res = await fetch(`${API_URL}/auth/providers`).catch(() => null);
      const body = res?.ok ? ((await res.json().catch(() => null)) as { providers?: { id: string; web: boolean; native: boolean }[] } | null) : null;
      const offered = new Map((body?.providers ?? []).map((p) => [p.id, p]));
      const appleSheet = Platform.OS === "ios" && (await AppleAuthentication.isAvailableAsync().catch(() => false));
      const list: SignInOption[] = [];
      for (const id of PROVIDER_ORDER) {
        const p = offered.get(id);
        if (!p) continue;
        if (id === "apple" && appleSheet && p.native) list.push({ id, native: true });
        else if (p.web) list.push({ id, native: false });
      }
      if (live) setOptions(list);
    })();
    return () => {
      live = false;
    };
  }, []);
  return options;
}

export function providerName(id: ProviderId): string {
  return PROVIDER_NAME[id];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const access = useRef<string | null>(null);
  const redemptions = useRef(new Map<string, Promise<void>>());

  const takeTokens = useCallback(async (t: { accessToken: string; refreshToken: string; user?: User }) => {
    access.current = t.accessToken;
    await setSecret(REFRESH_KEY, t.refreshToken);
    if (t.user) setUser(t.user);
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    const refreshToken = await getSecret(REFRESH_KEY);
    if (!refreshToken) return false;
    const res = await post("/auth/refresh", { refreshToken }).catch(() => null);
    if (!res?.ok) {
      await setSecret(REFRESH_KEY, null);
      return false;
    }
    await takeTokens(await res.json());
    return true;
  }, [takeTokens]);

  const api = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const send = () =>
        fetch(`${API_URL}${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${access.current ?? ""}` } });
      let res = await send();
      if (res.status === 401 && (await refresh())) res = await send();
      if (res.status === 401) {
        setUser(null);
        setStatus("signedOut");
      }
      return res;
    },
    [refresh],
  );

  useEffect(() => {
    (async () => {
      if (await refresh()) {
        const me = await api("/me");
        if (me.ok) {
          setUser(((await me.json()) as { user: User }).user);
          setStatus("signedIn");
          return;
        }
      }
      setStatus("signedOut");
    })();
  }, [refresh, api]);

  /** Signs in with the body every sign-in route returns: { user, accessToken, refreshToken }. */
  const finishSignIn = useCallback(
    async (res: Response | null) => {
      if (!res) throw new Error("Can't reach Dandelist. Check your connection.");
      if (!res.ok) throw new Error(await errorMessage(res));
      await takeTokens(await res.json());
      setStatus("signedIn");
    },
    [takeTokens],
  );

  const redeemTicket = useCallback(
    (ticket: string) => {
      // Android can hand the same return address to both the sign-in sheet and the router; a ticket works only once,
      // so both share one redemption.
      let pending = redemptions.current.get(ticket);
      if (!pending) {
        pending = (async () => {
          const verifier = await getSecret(VERIFIER_KEY);
          if (!verifier) throw new Error("That sign-in has expired. Try again.");
          await finishSignIn(await post("/auth/oauth/redeem", { ticket, verifier }).catch(() => null));
          await setSecret(VERIFIER_KEY, null);
        })();
        redemptions.current.set(ticket, pending);
        pending.catch(() => redemptions.current.delete(ticket));
      }
      return pending;
    },
    [finishSignIn],
  );

  const value = useMemo<Auth>(
    () => ({
      status,
      user,
      api,
      redeemTicket,
      async startEmail(email) {
        const res = await post("/auth/email/start", { email }).catch(() => null);
        if (!res) throw new Error("Can't reach Dandelist. Check your connection.");
        if (!res.ok) throw new Error(await errorMessage(res));
      },
      async verifyEmail(email, code) {
        const res = await post("/auth/email/verify", { email, code }).catch(() => null);
        if (!res) throw new Error("Can't reach Dandelist. Check your connection.");
        if (!res.ok) throw new Error(await errorMessage(res));
        await takeTokens(await res.json());
        setStatus("signedIn");
      },
      async signInWith(provider) {
        const challenge = await newChallenge();
        if (Platform.OS === "web") {
          // A full-page trip: the provider returns to the API, which returns here at /auth/callback with a ticket.
          globalThis.location.assign(startUrl(provider, `${globalThis.location.origin}/auth/callback`, challenge));
          return new Promise<boolean>(() => {});
        }
        const back = appReturnUrl();
        brokerPending = true;
        try {
          const result = await WebBrowser.openAuthSessionAsync(startUrl(provider, back, challenge), back);
          if (result.type !== "success") return false;
          const { queryParams } = Linking.parse(result.url);
          const ticket = typeof queryParams?.ticket === "string" ? queryParams.ticket : null;
          if (ticket) {
            await redeemTicket(ticket);
            return true;
          }
          const message = signInErrorMessage(typeof queryParams?.error === "string" ? queryParams.error : "failed");
          if (message) throw new Error(message);
          return false;
        } finally {
          brokerPending = false;
        }
      },
      async signInWithApple() {
        // A single-use nonce from the API. The sheet hands it to Apple unchanged, Apple signs it into the identity
        // token, and the API accepts that token once, so a captured token can't be replayed.
        const nonceRes = await fetch(`${API_URL}/auth/apple/nonce`).catch(() => null);
        if (!nonceRes) throw new Error("Can't reach Dandelist. Check your connection.");
        if (!nonceRes.ok) throw new Error(await errorMessage(nonceRes));
        const { nonce } = (await nonceRes.json()) as { nonce: string };
        let credential: AppleAuthentication.AppleAuthenticationCredential;
        try {
          credential = await AppleAuthentication.signInAsync({
            requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
            nonce,
          });
        } catch (e) {
          if ((e as { code?: string }).code === "ERR_REQUEST_CANCELED") return false;
          throw new Error("Sign in with Apple didn't go through. Try again.");
        }
        if (!credential.identityToken) throw new Error("Sign in with Apple didn't go through. Try again.");
        // Apple shares the name only the first time, so it goes up with that first sign-in.
        const fullName = credential.fullName ? { givenName: credential.fullName.givenName, familyName: credential.fullName.familyName } : null;
        await finishSignIn(await post("/auth/apple/native", { identityToken: credential.identityToken, fullName }).catch(() => null));
        return true;
      },
      async signOut() {
        if (access.current) await post("/auth/logout", {}, access.current).catch(() => null);
        access.current = null;
        await setSecret(REFRESH_KEY, null);
        setUser(null);
        setStatus("signedOut");
      },
    }),
    [status, user, api, takeTokens, redeemTicket, finishSignIn],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
