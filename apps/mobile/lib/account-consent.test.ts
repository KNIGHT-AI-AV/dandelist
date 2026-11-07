import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The signed-in account's AI consent as the app holds it (account-consent.tsx): read from the account at each sign-in,
 * opened only by the server's saved yes, and never confused across accounts, devices or a device's old local answer.
 * The real provider; the auth layer and the server stand in.
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;

type Reply = { status: number; body: unknown } | "offline";
const h = vi.hoisted(() => ({
  status: "signedOut" as "loading" | "signedOut" | "signedIn",
  user: null as { id: string } | null,
  /** The sign-in generation (lib/auth.tsx currentSignIn). */
  at: 0,
  /** Accounts' saved answers on the server. */
  server: new Map<string, boolean>(),
  calls: [] as string[],
  /** Holds the next POST until released, to stand for a slow save. */
  hold: null as null | { release: () => void; wait: Promise<void> },
  /** What the next GET or POST returns instead of the server's answer. */
  nextRead: null as Reply | null,
  nextSave: null as Reply | null,
  refusal: new Set<(at: number) => void>(),
  local: new Map<string, string>(),
}));

vi.mock("./storage", () => ({ getSecret: async (k: string) => h.local.get(k) ?? null, setSecret: async () => {} }));
vi.mock("./auth", () => {
  class SignInChanged extends Error {}
  const reply = (r: Exclude<Reply, "offline">) => new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  const api = async (path: string, init: RequestInit = {}) => {
    const who = h.user!.id;
    const method = init.method ?? "GET";
    h.calls.push(`${method} ${path} ${who}`);
    if (method === "GET") {
      const r = h.nextRead;
      h.nextRead = null;
      if (r === "offline") throw new TypeError("Network request failed");
      return reply(r ?? { status: 200, body: { consent: { accepted: h.server.get(who) ?? false } } });
    }
    if (h.hold) await h.hold.wait;
    const r = h.nextSave;
    h.nextSave = null;
    if (r === "offline") throw new TypeError("Network request failed");
    if (r) return reply(r);
    h.server.set(who, true);
    return reply({ status: 200, body: { consent: { accepted: true } } });
  };
  return {
    SignInChanged,
    currentSignIn: () => h.at,
    bindToSignIn: (call: typeof api, at: number) => (path: string, init?: RequestInit) => {
      if (at !== h.at) return Promise.reject(new SignInChanged());
      return call(path, init);
    },
    onConsentRequired: (l: (at: number) => void) => {
      h.refusal.add(l);
      return () => void h.refusal.delete(l);
    },
    useAuth: () => ({ status: h.status, user: h.user, api }),
  };
});

const { AccountConsentProvider, useAccountConsent } = await import("./account-consent");

let root: ReactTestRenderer | null = null;
let seen: ReturnType<typeof useAccountConsent> | null = null;
function Probe() {
  seen = useAccountConsent();
  return null;
}
const settle = () =>
  act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  });
const mount = async () => {
  await act(async () => {
    root = create(createElement(AccountConsentProvider, null, createElement(Probe)));
  });
  await settle();
};
/** Another render with the auth state as it is now (a sign-in, a sign-out, a switch). */
const rerender = async () => {
  await act(async () => root!.update(createElement(AccountConsentProvider, null, createElement(Probe))));
  await settle();
};
const signIn = (id: string) => {
  h.status = "signedIn";
  h.user = { id };
  h.at++;
};

beforeEach(() => {
  Object.assign(h, { status: "signedOut", user: null, at: 0, calls: [], hold: null, nextRead: null, nextSave: null });
  h.server.clear();
  h.local.clear();
  h.refusal.clear();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("the account's AI consent", () => {
  it("is nothing to gate when signed out, and asks nothing of the server", async () => {
    await mount();
    expect(seen!.state).toBe("none");
    expect(h.calls).toEqual([]);
  });

  it("is read from the account at sign-in, and opens only once the server has saved the yes", async () => {
    signIn("ada");
    await mount();
    expect(seen!.state).toBe("required");
    await act(async () => seen!.accept());
    await settle();
    expect(seen!.state).toBe("accepted");
    expect(h.server.get("ada")).toBe(true);
    expect(h.calls).toEqual(["GET /me/consent ada", "POST /me/consent ada"]);
  });

  it("opens straight away for an account that said yes on another device, and after a restart", async () => {
    h.server.set("ada", true);
    signIn("ada");
    await mount();
    expect(seen!.state).toBe("accepted");
    act(() => root!.unmount());
    root = null;
    await mount();
    expect(seen!.state).toBe("accepted");
  });

  it("ignores this device's old local yes (the #254 card): the account is asked for its own", async () => {
    h.local.set("dandelist.ai-consent", "1");
    signIn("ada");
    await mount();
    expect(seen!.state).toBe("required");
  });

  it("stays closed when the save fails, says why, and opens on a try that works", async () => {
    signIn("ada");
    await mount();
    h.nextSave = { status: 500, body: { error: "Something went wrong." } };
    await act(async () => seen!.accept());
    expect(seen!.state).toBe("required");
    expect(seen!.error).toBe("Something went wrong.");
    expect(seen!.saving).toBe(false);
    h.nextSave = "offline";
    await act(async () => seen!.accept());
    expect(seen!.state).toBe("required");
    expect(seen!.error).toMatch(/Couldn't reach Dandelist/);
    await act(async () => seen!.accept());
    expect(seen!.state).toBe("accepted");
    expect(seen!.error).toBeNull();
  });

  it("sends one save for any number of taps while it is slow, and opens when it lands", async () => {
    signIn("ada");
    await mount();
    let release!: () => void;
    h.hold = { release: () => release(), wait: new Promise<void>((r) => (release = r)) };
    let first!: Promise<void>;
    await act(async () => {
      first = seen!.accept();
      void seen!.accept();
      void seen!.accept();
    });
    expect(seen!.saving).toBe(true);
    expect(seen!.state).toBe("required");
    expect(h.calls.filter((c) => c.startsWith("POST"))).toHaveLength(1);
    h.hold = null;
    await act(async () => {
      release();
      await first;
    });
    expect(seen!.state).toBe("accepted");
    expect(seen!.saving).toBe(false);
  });

  it("keeps a yes saving for one account from opening the app for the next one signed in meanwhile", async () => {
    signIn("ada");
    await mount();
    let release!: () => void;
    h.hold = { release: () => release(), wait: new Promise<void>((r) => (release = r)) };
    let saving!: Promise<void>;
    await act(async () => {
      saving = seen!.accept();
    });
    // Ada signs out and Bob signs in on the same device while her yes is still on its way.
    signIn("bob");
    await rerender();
    expect(seen!.state).toBe("required");
    expect(seen!.saving).toBe(false);
    h.hold = null;
    await act(async () => {
      release();
      await saving;
    });
    await settle();
    expect(seen!.state).toBe("required");
    expect(h.server.get("bob")).toBeUndefined();
  });

  it("drops an answer read for an account that has since signed out", async () => {
    signIn("ada");
    h.server.set("ada", true);
    await act(async () => {
      root = create(createElement(AccountConsentProvider, null, createElement(Probe)));
    });
    // Signed out before the read came back.
    h.status = "signedOut";
    h.user = null;
    h.at++;
    await rerender();
    expect(seen!.state).toBe("none");
  });

  it("stays closed when the answer can't be read, and reads again on Try again", async () => {
    signIn("ada");
    h.nextRead = "offline";
    await mount();
    expect(seen!.state).toBe("failed");
    h.nextRead = { status: 503, body: { error: "The server is busy." } };
    await act(async () => seen!.retry());
    await settle();
    expect(seen!.state).toBe("failed");
    expect(seen!.error).toBe("The server is busy.");
    await act(async () => seen!.retry());
    await settle();
    expect(seen!.state).toBe("required");
  });

  it("closes again when the server turns a request down for new words, for this sign-in only", async () => {
    h.server.set("ada", true);
    signIn("ada");
    await mount();
    expect(seen!.state).toBe("accepted");
    await act(async () => h.refusal.forEach((l) => l(h.at - 1)));
    expect(seen!.state).toBe("accepted");
    await act(async () => h.refusal.forEach((l) => l(h.at)));
    expect(seen!.state).toBe("required");
  });
});
