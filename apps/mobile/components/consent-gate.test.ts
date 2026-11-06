import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { act, createElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The gate above the app (consent-gate.tsx): signed in, nothing of the app mounts until the account's yes is saved;
 * the closed app is a navigator of its own with only the consent and legal pages; every route in app/ is placed on one
 * side; and a deep link is not lost to the consent page. expo-router, auth and the consent state stand in.
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  status: "signedOut" as "loading" | "signedOut" | "signedIn",
  consent: "none" as "none" | "checking" | "required" | "accepted" | "failed",
  path: "/",
  segments: [] as string[],
  params: {} as Record<string, string>,
}));
const passThrough = (name: string) => ({ children, ...rest }: { children?: ReactNode }) => createElement(name, rest, children);
vi.mock("expo-router", () => {
  const Stack = Object.assign(passThrough("Stack"), { Screen: passThrough("Screen"), Protected: passThrough("Protected") });
  return { Stack, usePathname: () => h.path, useSegments: () => h.segments, useGlobalSearchParams: () => h.params };
});
vi.mock("../lib/auth", () => ({ useAuth: () => ({ status: h.status }) }));
vi.mock("../lib/theme", () => ({ usePalette: () => ({ bg: "#000" }) }));
vi.mock("../lib/account-consent", async () => {
  const real = await vi.importActual<typeof import("../lib/account-consent")>("../lib/account-consent");
  return { appOpen: real.appOpen, useAccountConsent: () => ({ state: h.consent }) };
});

const { APP_ROUTES, ConsentGate, OPEN_ROUTES, takeReturn } = await import("./consent-gate");

/** Something of the app that would start work the moment it mounts (a list's fetch, today's pick). */
const mounted: string[] = [];
function Product() {
  mounted.push("product");
  return createElement("Product");
}

let root: ReactTestRenderer | null = null;
const render = async () => {
  await act(async () => {
    if (root) root.update(createElement(ConsentGate, null, createElement(Product)));
    else root = create(createElement(ConsentGate, null, createElement(Product)));
  });
};
const shows = (type: string) => root!.root.findAll((n) => (n.type as unknown) === type).length > 0;
const screens = (within: string) => root!.root.findAll((n) => (n.type as unknown) === within).flatMap((p) => p.findAll((n) => (n.type as unknown) === "Screen").map((s) => s.props.name as string));

beforeEach(() => {
  Object.assign(h, { status: "signedOut", consent: "none", path: "/", segments: [], params: {} });
  takeReturn();
  mounted.length = 0;
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("the gate above the app", () => {
  it("shows the app signed out (the welcome and sign-in) and while the session is being restored", async () => {
    await render();
    expect(shows("Product")).toBe(true);
    h.status = "loading";
    await render();
    expect(shows("Product")).toBe(true);
  });

  it("mounts nothing of the app for a signed-in account that is checking, refused, unread or declined", async () => {
    h.status = "signedIn";
    for (const state of ["none", "checking", "required", "failed"] as const) {
      h.consent = state;
      mounted.length = 0;
      await render();
      expect([state, shows("Product"), mounted.length]).toEqual([state, false, 0]);
      expect(shows("Stack")).toBe(true);
    }
  });

  it("closes to a navigator with the consent and legal pages open and every other route guarded", async () => {
    h.status = "signedIn";
    h.consent = "required";
    await render();
    expect(root!.root.findByType("Protected" as never).props.guard).toBe(false);
    const guarded = screens("Protected");
    expect([...guarded].sort()).toEqual([...APP_ROUTES].sort());
    const all = root!.root.findAll((n) => (n.type as unknown) === "Screen").map((s) => s.props.name as string);
    expect(all.filter((n) => !guarded.includes(n)).sort()).toEqual([...OPEN_ROUTES].sort());
  });

  it("opens the app once the yes is saved, and keeps a deep link the consent page interrupted for it to send them on to", async () => {
    h.status = "loading";
    h.path = "/wishes/abc";
    h.segments = ["wishes", "[id]"];
    h.params = { id: "abc", amend: "1" };
    await render();
    h.status = "signedIn";
    h.consent = "checking";
    h.path = "/consent";
    h.segments = ["consent"];
    h.params = {};
    await render();
    expect(shows("Product")).toBe(false);
    h.consent = "accepted";
    await render();
    expect(shows("Product")).toBe(true);
    // The route's own id stays in the path; the rest of the query comes along (the chat is /wishes?page=chat).
    expect(takeReturn()).toBe("/wishes/abc?amend=1");
    // Taken once: a later visit to the consent page goes to the start.
    expect(takeReturn()).toBeNull();
  });

  it("keeps nothing to return to after a plain sign-in", async () => {
    h.path = "/sign-in";
    await render();
    h.status = "signedIn";
    h.consent = "required";
    h.path = "/consent";
    await render();
    h.consent = "accepted";
    await render();
    expect(takeReturn()).toBeNull();
  });
});

describe("every route in app/", () => {
  it("is placed on one side of the gate, exactly once", () => {
    const dir = join(__dirname, "..", "app");
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith(".tsx") && !f.startsWith("_") && !f.endsWith(".test.tsx") ? [relative(dir, join(d, f)).replace(/\\/g, "/").replace(/\.tsx$/, "")] : []));
    const routes = walk(dir).sort();
    const placed = [...OPEN_ROUTES, ...APP_ROUTES];
    expect(new Set(placed).size).toBe(placed.length);
    expect([...placed].sort()).toEqual(routes);
  });
});
