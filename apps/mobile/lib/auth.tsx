import * as AppleAuthentication from "expo-apple-authentication";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { fetch as streamingFetch } from "expo/fetch";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { getSecret, setSecret } from "./storage";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8080";
const REFRESH_KEY = "dandelist.refresh";
/** The secret for the provider sign-in in progress; its ticket redeems only with this. */
const VERIFIER_KEY = "dandelist.oauth.verifier";

type User = { id: string; email: string };
type Status = "loading" | "signedOut" | "signedIn";

export type ProviderId = "apple" | "google" | "github" | "facebook";
/** A sign-in option to offer here. `native` means the system sheet (Apple on iOS); otherwise the API's browser flow. */
export type SignInOption = { id: ProviderId; native: boolean };
/** A sign-in account linked to this Dandelist account, as GET /me/identities lists it. */
export type LinkedIdentity = { provider: ProviderId; email: string | null; name: string | null; linkedAt: string };

interface Auth {
  status: Status;
  user: User | null;
  startEmail(email: string): Promise<void>;
  verifyEmail(email: string, code: string): Promise<void>;
  /**
   * Signs in with Google, GitHub, Facebook or Apple through the API. On the web the page leaves for the provider and comes back
   * at /auth/callback. On a phone it opens a browser sheet and resolves true once signed in, false if the person
   * backed out.
   */
  signInWith(provider: ProviderId): Promise<boolean>;
  /** Sign in with Apple through the iOS system sheet. Resolves false if the person backed out. */
  signInWithApple(): Promise<boolean>;
  /**
   * Swaps the one-time ticket from a finished provider sign-in for a session. Resolves true once signed in with it, false
   * when a newer sign-in or a sign-out took over meanwhile. Safe to call twice with one ticket.
   */
  redeemTicket(ticket: string): Promise<boolean>;
  /**
   * Links one more sign-in account to the account that is signed in (settings). Same trip as signInWith: the web
   * leaves for the provider and comes back at /auth/callback, a phone opens a sheet and resolves with the account's
   * linked identities, or null if the person backed out. Apple on an iPhone uses the system sheet.
   */
  linkWith(option: SignInOption): Promise<LinkedIdentity[] | null>;
  /** Finishes a link with the ticket a provider sent back. Safe to call twice with one ticket. */
  redeemLink(ticket: string): Promise<LinkedIdentity[]>;
  signOut(): Promise<void>;
  /** fetch against the API with the access token, refreshing once on 401. */
  api(path: string, init?: RequestInit): Promise<Response>;
  /** Like api, but the response body can be read as a stream (server-sent events) on phones too. */
  apiStream(path: string, init?: RequestInit): Promise<Response>;
}

const AuthContext = createContext<Auth | null>(null);

/**
 * Which sign-in the app's bearer belongs to (review of #131): a number that moves the moment another account's bearer,
 * or none, is put in place, in the same step and before anything can send with it, and never for a refresh of the same
 * account's. Work started under one sign-in binds its requests to it (bindToSignIn): they refuse to send once it moved.
 */
let signIn = { account: null as string | null, at: 0 };
const SIGN_IN = Symbol("sign-in");
export const currentSignIn = (): number => signIn.at;
/** Whose bearer the app holds from now on; the same account again (a refresh, a second sign-in) changes nothing. */
function bearerOf(account: string | null): void {
  if (account !== signIn.account) signIn = { account, at: signIn.at + 1 };
}

/** Thrown instead of sending a request whose sign-in has moved on. */
export class SignInChanged extends Error {
  constructor() {
    super("Signed in as someone else since.");
  }
}

/** `api` bound to the sign-in `at`: each request, and its retry after a refresh, is refused once that sign-in moved on. */
export function bindToSignIn(api: (path: string, init?: RequestInit) => Promise<Response>, at: number) {
  return (path: string, init: RequestInit = {}) => api(path, { ...init, [SIGN_IN]: at } as RequestInit);
}

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

export const PROVIDER_ORDER: ProviderId[] = ["apple", "google", "facebook", "github"];
const PROVIDER_NAME: Record<ProviderId, string> = { apple: "Apple", google: "Google", github: "GitHub", facebook: "Facebook" };

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

/** A link that didn't finish, with the code settings turns into words. */
export class LinkError extends Error {
  constructor(
    message: string,
    readonly code: "taken" | "failed",
  ) {
    super(message);
  }
}

/** What settings says when linking an account comes back without a ticket; `null` when there is nothing to say. */
export function linkErrorMessage(code: string | null | undefined): string | null {
  switch (code) {
    case undefined:
    case null:
    case "":
    case "cancelled":
      return null;
    case "taken":
      return "That account is already linked to another Dandelist account. Sign in with it there and unlink it first.";
    case "expired":
      return "That took too long. Try again.";
    default:
      return "That didn't go through. Try again.";
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
async function newChallenge(write: Write): Promise<string> {
  const verifier = Array.from(Crypto.getRandomBytes(32), (b) => b.toString(16).padStart(2, "0")).join("");
  // In line with every other secret write, so the newest challenge's verifier is the one left stored.
  await write(VERIFIER_KEY, verifier, () => true);
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 });
  return digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A secret write, made only if `holds()` is still true when its turn comes. */
type Write = (key: string, value: string | null, holds: () => boolean | Promise<boolean>) => Promise<void>;

const startUrl = (provider: ProviderId, redirect: string, challenge: string) =>
  `${API_URL}/auth/oauth/${provider}/start?redirect=${encodeURIComponent(redirect)}&challenge=${challenge}`;

/** The phone sign-in sheet that is open, if one is; a sheet that closes clears only itself. */
let broker: object | null = null;
/**
 * True while a phone sign-in sheet is open. Android also delivers the return address to the router, which opens
 * /auth; that screen steps back and lets the waiting sign-in finish instead of racing it.
 */
export function isBrokerPending(): boolean {
  return broker !== null;
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
  const redemptions = useRef(new Map<string, Promise<boolean>>());
  const linkRedemptions = useRef(new Map<string, Promise<LinkedIdentity[]>>());
  // Who may change the session (review of round40): the latest sign-in, startup or sign-out to start. A response that
  // comes back after a newer one started is dropped, the way a cancelled one would be. `session` is the committed
  // session, named by the attempt that made it (0: none); its refreshes and requests belong to it alone. Kept apart from
  // the public marker above, which moves only when the account does.
  const attempts = useRef(0);
  const session = useRef(0);
  /** The committed session's refresh token, so a refresh never depends on a storage write that hasn't landed. */
  const refreshToken = useRef<string | null>(null);
  /** One refresh at a time per session: the server takes each refresh token once. */
  const refreshing = useRef<{ session: number; done: Promise<boolean> } | null>(null);
  /** Moves whenever a sign-in commits or this device signs out: each of those decides the stored token from then on. */
  const keeper = useRef(0);
  const writes = useRef<Promise<void>>(Promise.resolve());

  const start = useCallback(() => ++attempts.current, []);
  const latest = useCallback((owner: number) => attempts.current === owner, []);

  /** Secrets are written one after another, each only if its owner still holds when its turn comes. */
  const write = useCallback<Write>((key, value, holds) => {
    const run = writes.current.then(async () => {
      if (await holds()) await setSecret(key, value);
    });
    writes.current = run.catch(() => undefined);
    return run;
  }, []);

  /**
   * Puts a sign-in's session in place in one step, unless a newer sign-in or sign-out started since `owner` did. True
   * only if it is still the newest once its token is stored; a session in place stays when a newer one starts meanwhile.
   */
  const adopt = useCallback(
    async (owner: number, t: { accessToken: string; refreshToken: string; user: User }) => {
      if (!latest(owner)) return false;
      session.current = owner;
      keeper.current++;
      // The account marker moves before the new bearer can be sent.
      bearerOf(t.user.id);
      access.current = t.accessToken;
      refreshToken.current = t.refreshToken;
      setUser(t.user);
      setStatus("signedIn");
      await write(REFRESH_KEY, t.refreshToken, () => session.current === owner);
      return latest(owner);
    },
    [latest, write],
  );

  /** Signed out on this device: no bearer, no session, nothing stored. */
  const clear = useCallback(() => {
    session.current = 0;
    keeper.current++;
    access.current = null;
    refreshToken.current = null;
    bearerOf(null);
    setUser(null);
    setStatus("signedOut");
    return write(REFRESH_KEY, null, () => session.current === 0);
  }, [write]);

  /** Renews committed session `owner`'s bearer; false when it can't. Only that same session's state ever changes. */
  const refresh = useCallback(
    (owner: number): Promise<boolean> => {
      if (!owner || session.current !== owner) return Promise.resolve(false);
      if (refreshing.current?.session === owner) return refreshing.current.done;
      const token = refreshToken.current;
      const done = (async () => {
        if (!token) return false;
        const res = await post("/auth/refresh", { refreshToken: token }).catch(() => null);
        const body = res?.ok ? ((await res.json().catch(() => null)) as { accessToken?: string; refreshToken?: string } | null) : null;
        // Another sign-in or a sign-out since: its session stands, untouched.
        if (session.current !== owner) return false;
        if (!body?.accessToken || !body.refreshToken) {
          refreshToken.current = null;
          await write(REFRESH_KEY, null, () => session.current === owner);
          return false;
        }
        // A refresh renews the same account's bearer; the account marker stays.
        access.current = body.accessToken;
        refreshToken.current = body.refreshToken;
        await write(REFRESH_KEY, body.refreshToken, () => session.current === owner);
        // Renewed, and still the session in place once its token is stored.
        return session.current === owner;
      })();
      refreshing.current = { session: owner, done };
      // Cleared however it ends. A failed token write still rejects `done` for the caller, and only for the caller.
      const settled = () => {
        if (refreshing.current?.done === done) refreshing.current = null;
      };
      done.then(settled, settled);
      return done;
    },
    [write],
  );

  const call = useCallback(
    async (path: string, init: RequestInit = {}, streaming = false) => {
      // React Native's own fetch can't read a response stream; Expo's can. The web's fetch streams already.
      const doFetch = (streaming && Platform.OS !== "web" ? streamingFetch : fetch) as typeof fetch;
      const { [SIGN_IN]: at, ...rest } = init as RequestInit & { [SIGN_IN]?: number };
      // The session this request is sent under: a 401 may refresh or end only that one, never a newer sign-in's.
      const owner = session.current;
      // Checked right where the bearer is read, for the first try and the retry after a refresh alike.
      const send = () => {
        if (at !== undefined && at !== signIn.at) throw new SignInChanged();
        return doFetch(`${API_URL}${path}`, { ...rest, headers: { ...(rest.headers ?? {}), Authorization: `Bearer ${access.current ?? ""}` } });
      };
      let res = await send();
      if (res.status === 401) {
        // Tried again only as its own, renewed session; a request bound to a sign-in that has moved on is refused.
        if ((await refresh(owner)) && session.current === owner) res = await send();
        else if (at !== undefined && at !== signIn.at) throw new SignInChanged();
      }
      if (res.status === 401 && owner && session.current === owner) await clear();
      return res;
    },
    [refresh, clear],
  );
  const api = useCallback((path: string, init: RequestInit = {}) => call(path, init), [call]);
  const apiStream = useCallback((path: string, init: RequestInit = {}) => call(path, init, true), [call]);

  useEffect(() => {
    // The stored session is restored as one more attempt: a sign-in or sign-out that starts meanwhile wins.
    const owner = start();
    const kept = keeper.current;
    (async () => {
      const stored = await getSecret(REFRESH_KEY);
      const res = stored ? await post("/auth/refresh", { refreshToken: stored }).catch(() => null) : null;
      const body = res?.ok ? ((await res.json().catch(() => null)) as { accessToken?: string; refreshToken?: string } | null) : null;
      const tokens = body?.accessToken && body.refreshToken ? { accessToken: body.accessToken, refreshToken: body.refreshToken } : null;
      let me: User | null = null;
      if (tokens) {
        const r = await fetch(`${API_URL}/me`, { headers: { Authorization: `Bearer ${tokens.accessToken}` } }).catch(() => null);
        me = r?.ok ? (((await r.json().catch(() => null)) as { user?: User } | null)?.user ?? null) : null;
      }
      if (me && tokens && latest(owner)) {
        await adopt(owner, { ...tokens, user: me });
        return;
      }
      // Not put in place: a newer sign-in or a sign-out started meanwhile, or the account didn't load. The server has
      // taken the stored token, so the renewed one is kept for next time all the same (nothing is, when the refresh
      // didn't go through), unless a sign-in has committed or this device signed out since: each of those decides.
      if (stored) await write(REFRESH_KEY, tokens?.refreshToken ?? null, () => keeper.current === kept);
      setStatus((s) => (s === "loading" ? "signedOut" : s));
    })();
  }, [start, latest, adopt, write]);

  /**
   * A step of sign-in attempt `owner` that didn't go through: thrown for the person to read while the attempt is the
   * newest, or false, ending it quietly, once a newer sign-in or a sign-out has started.
   */
  const fail = useCallback(
    async (owner: number, res: Response | null): Promise<false> => {
      const message = res ? await errorMessage(res) : "Can't reach Dandelist. Check your connection.";
      if (!latest(owner)) return false;
      throw new Error(message);
    },
    [latest],
  );

  /** Signs in with the body every sign-in route returns: { user, accessToken, refreshToken }. False when superseded. */
  const finishSignIn = useCallback(
    async (owner: number, res: Response | null) => {
      const body = res?.ok ? ((await res.json().catch(() => null)) as { accessToken: string; refreshToken: string; user: User } | null) : null;
      return body ? adopt(owner, body) : fail(owner, res);
    },
    [adopt, fail],
  );

  /**
   * Redeems a provider ticket for attempt `owner` (a sheet's own sign-in), or as its own attempt (a page that came
   * back with the ticket). Android can hand the same return address to both the sign-in sheet and the router; a ticket
   * works only once, so both share the first redemption and its attempt.
   */
  const redeem = useCallback(
    (ticket: string, owner?: number): Promise<boolean> => {
      let pending = redemptions.current.get(ticket);
      if (!pending) {
        const mine = owner ?? start();
        const p: Promise<boolean> = (async () => {
          const verifier = await getSecret(VERIFIER_KEY);
          if (!latest(mine)) return false;
          if (!verifier) throw new Error("That sign-in has expired. Try again.");
          const took = await finishSignIn(mine, await post("/auth/oauth/redeem", { ticket, verifier }).catch(() => null));
          // Only this sign-in's own verifier goes: a newer one may have stored its own since.
          if (took) await write(VERIFIER_KEY, null, async () => (await getSecret(VERIFIER_KEY)) === verifier);
          // Signed in, and still the newest sign-in once that is done.
          return took && latest(mine);
        })();
        pending = p;
        redemptions.current.set(ticket, p);
        p.catch(() => {
          if (redemptions.current.get(ticket) === p) redemptions.current.delete(ticket);
        });
      }
      return pending;
    },
    [start, latest, finishSignIn, write],
  );
  const redeemTicket = useCallback((ticket: string) => redeem(ticket), [redeem]);

  const redeemLink = useCallback(
    (ticket: string) => {
      // Like sign-in tickets, Android can deliver one return address twice; both share one redemption.
      let pending = linkRedemptions.current.get(ticket);
      if (!pending) {
        pending = (async () => {
          const verifier = await getSecret(VERIFIER_KEY);
          if (!verifier) throw new Error("That took too long. Try again.");
          const res = await api("/auth/link/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket, verifier }) }).catch(() => null);
          if (!res) throw new Error("Can't reach Dandelist. Check your connection.");
          if (!res.ok) throw new LinkError(await errorMessage(res), res.status === 409 ? "taken" : "failed");
          await write(VERIFIER_KEY, null, async () => (await getSecret(VERIFIER_KEY)) === verifier);
          return ((await res.json()) as { identities: LinkedIdentity[] }).identities;
        })();
        const p = pending;
        linkRedemptions.current.set(ticket, p);
        p.catch(() => {
          if (linkRedemptions.current.get(ticket) === p) linkRedemptions.current.delete(ticket);
        });
      }
      return pending;
    },
    [api, write],
  );

  const linkWith = useCallback(
    async (option: SignInOption): Promise<LinkedIdentity[] | null> => {
      const json = { method: "POST", headers: { "Content-Type": "application/json" } } as const;
      if (option.native && option.id === "apple") {
        const nonceRes = await fetch(`${API_URL}/auth/apple/nonce`).catch(() => null);
        if (!nonceRes) throw new Error("Can't reach Dandelist. Check your connection.");
        if (!nonceRes.ok) throw new Error(await errorMessage(nonceRes));
        const { nonce } = (await nonceRes.json()) as { nonce: string };
        let credential: AppleAuthentication.AppleAuthenticationCredential;
        try {
          credential = await AppleAuthentication.signInAsync({ requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL], nonce });
        } catch (e) {
          if ((e as { code?: string }).code === "ERR_REQUEST_CANCELED") return null;
          throw new Error("Apple didn't confirm that account. Try again.");
        }
        if (!credential.identityToken) throw new Error("Apple didn't confirm that account. Try again.");
        const fullName = credential.fullName ? { givenName: credential.fullName.givenName, familyName: credential.fullName.familyName } : null;
        const res = await api("/auth/link/apple/native", { ...json, body: JSON.stringify({ identityToken: credential.identityToken, fullName }) }).catch(() => null);
        if (!res) throw new Error("Can't reach Dandelist. Check your connection.");
        if (!res.ok) throw new Error(await errorMessage(res));
        return ((await res.json()) as { identities: LinkedIdentity[] }).identities;
      }
      const challenge = await newChallenge(write);
      const web = Platform.OS === "web";
      const back = web ? `${globalThis.location.origin}/auth/callback` : appReturnUrl();
      const res = await api(`/auth/link/${option.id}`, { ...json, body: JSON.stringify({ redirect: back, challenge }) }).catch(() => null);
      if (!res) throw new Error("Can't reach Dandelist. Check your connection.");
      if (!res.ok) throw new Error(await errorMessage(res));
      const { url } = (await res.json()) as { url: string };
      if (web) {
        // A full-page trip; /auth/callback finishes the link and returns to settings.
        globalThis.location.assign(url);
        return new Promise<LinkedIdentity[] | null>(() => {});
      }
      const sheet = {};
      broker = sheet;
      try {
        const result = await WebBrowser.openAuthSessionAsync(url, back);
        if (result.type !== "success") return null;
        const { queryParams } = Linking.parse(result.url);
        const ticket = typeof queryParams?.ticket === "string" ? queryParams.ticket : null;
        if (ticket) return await redeemLink(ticket);
        const message = linkErrorMessage(typeof queryParams?.error === "string" ? queryParams.error : "failed");
        if (message) throw new Error(message);
        return null;
      } finally {
        if (broker === sheet) broker = null;
      }
    },
    [api, redeemLink, write],
  );

  const value = useMemo<Auth>(
    () => ({
      status,
      user,
      api,
      apiStream,
      redeemTicket,
      linkWith,
      redeemLink,
      async startEmail(email) {
        const res = await post("/auth/email/start", { email }).catch(() => null);
        if (!res) throw new Error("Can't reach Dandelist. Check your connection.");
        if (!res.ok) throw new Error(await errorMessage(res));
      },
      async verifyEmail(email, code) {
        const owner = start();
        // A code that lands after a newer sign-in or a sign-out simply ends, the way a cancelled one would.
        await finishSignIn(owner, await post("/auth/email/verify", { email, code }).catch(() => null));
      },
      async signInWith(provider) {
        // One attempt from the challenge through the sheet to the ticket: a newer sign-in or a sign-out supersedes it.
        const owner = start();
        const challenge = await newChallenge(write);
        if (!latest(owner)) return false;
        if (Platform.OS === "web") {
          // A full-page trip: the provider returns to the API, which returns here at /auth/callback with a ticket.
          globalThis.location.assign(startUrl(provider, `${globalThis.location.origin}/auth/callback`, challenge));
          return new Promise<boolean>(() => {});
        }
        const back = appReturnUrl();
        const sheet = {};
        broker = sheet;
        try {
          const result = await WebBrowser.openAuthSessionAsync(startUrl(provider, back, challenge), back);
          if (result.type !== "success") return false;
          const { queryParams } = Linking.parse(result.url);
          const ticket = typeof queryParams?.ticket === "string" ? queryParams.ticket : null;
          if (ticket) return await redeem(ticket, owner);
          const message = signInErrorMessage(typeof queryParams?.error === "string" ? queryParams.error : "failed");
          if (message) throw new Error(message);
          return false;
        } finally {
          if (broker === sheet) broker = null;
        }
      },
      async signInWithApple() {
        const owner = start();
        // A single-use nonce from the API. The sheet hands it to Apple unchanged, Apple signs it into the identity
        // token, and the API accepts that token once, so a captured token can't be replayed.
        const nonceRes = await fetch(`${API_URL}/auth/apple/nonce`).catch(() => null);
        const nonce = nonceRes?.ok ? ((await nonceRes.json().catch(() => null)) as { nonce?: string } | null)?.nonce : undefined;
        if (!nonce) return fail(owner, nonceRes);
        // The sheet opens only for the newest sign-in: one a newer sign-in or a sign-out took over from ends here.
        if (!latest(owner)) return false;
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
        if (!latest(owner)) return false;
        return finishSignIn(owner, await post("/auth/apple/native", { identityToken: credential.identityToken, fullName }).catch(() => null));
      },
      async signOut() {
        // Anything still signing in is superseded, and this device signs out at once. Only the bearer it held is revoked
        // on the server afterwards, so that request coming back can't touch a sign-in made meanwhile.
        start();
        const token = access.current;
        await clear();
        if (token) await post("/auth/logout", {}, token).catch(() => null);
      },
    }),
    [status, user, api, apiStream, start, latest, write, clear, redeem, redeemTicket, linkWith, redeemLink, fail, finishSignIn],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
