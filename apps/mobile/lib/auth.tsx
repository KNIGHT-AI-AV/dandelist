import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getSecret, setSecret } from "./storage";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8080";
const REFRESH_KEY = "dandelist.refresh";

type User = { id: string; email: string };
type Status = "loading" | "signedOut" | "signedIn";

interface Auth {
  status: Status;
  user: User | null;
  startEmail(email: string): Promise<void>;
  verifyEmail(email: string, code: string): Promise<void>;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const access = useRef<string | null>(null);

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

  const value = useMemo<Auth>(
    () => ({
      status,
      user,
      api,
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
      async signOut() {
        if (access.current) await post("/auth/logout", {}, access.current).catch(() => null);
        access.current = null;
        await setSecret(REFRESH_KEY, null);
        setUser(null);
        setStatus("signedOut");
      },
    }),
    [status, user, api, takeTokens],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
