import { act, createElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The AI card (App Store 5.1.2(i), Meta's 18+): before sign-in nothing is sent until the yes, and signed in on a device
 * without one the card stands over the app. The real gate and card; storage, the router, auth and the views stand in.
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;
g.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  local: new Map<string, string>(),
  status: "signedOut" as "loading" | "signedOut" | "signedIn",
  path: "/welcome",
  pushed: [] as string[],
  signedOut: 0,
}));

const passThrough = (name: string) => ({ children }: { children?: ReactNode }) => createElement(name, null, children);
vi.mock("react-native", () => {
  class Value {
    constructor(public v: number) {}
    interpolate(config: unknown) {
      return config;
    }
  }
  const run = () => ({ start: (done?: (r: { finished: boolean }) => void) => done?.({ finished: true }) });
  return {
    Animated: { Value, timing: run, spring: run, parallel: run, View: passThrough("AnimatedView") },
    Modal: passThrough("Modal"),
    Pressable: passThrough("Pressable"),
    StyleSheet: { absoluteFill: {} },
    Text: "Text",
    View: passThrough("View"),
    useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1, scale: 3 }),
  };
});
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock("expo-router", () => ({ router: { push: (p: string) => void h.pushed.push(p) }, usePathname: () => h.path }));
vi.mock("../lib/storage", () => ({
  getSecret: async (key: string) => h.local.get(key) ?? null,
  setSecret: async (key: string, value: string | null) => { if (value === null) h.local.delete(key); else h.local.set(key, value); },
}));
vi.mock("../lib/auth", () => ({ useAuth: () => ({ status: h.status, signOut: async () => void h.signedOut++ }) }));
vi.mock("../lib/motion", () => ({ ease: { out: () => 0 }, native: true, spring: { snap: {} }, step: { inMs: 1, outMs: 1 }, useReducedMotion: () => false }));
vi.mock("../lib/theme", () => ({
  layout: { gutter: () => 20, stack: { tight: 8, base: 16 } },
  radius: { lg: 24 },
  shadow: { lift: "" },
  space: { 4: 4, 12: 12, 24: 24 },
  type: { title3: {}, callout: {} },
  usePalette: () => ({ ink: "#fff", ink2: "#ccc", ink3: "#999", sheet: "#111", bgRgb: "0,0,0" }),
}));
vi.mock("./list/metrics", () => ({ SCRIM: 0.5 }));
vi.mock("./lux", () => ({ Glass: passThrough("Glass"), PrimaryButton: "PrimaryButton", QuietButton: "QuietButton" }));

const { AiConsentGate, CONSENT, useConsentGate } = await import("./ai-consent");
const { resetAiConsentForTests } = await import("../lib/ai-consent");
const { PRIVACY, TERMS } = await import("../lib/legal");

let root: ReactTestRenderer | null = null;
let gate: ((go: () => void) => void) | null = null;
function Harness() {
  const consent = useConsentGate();
  gate = consent.gate;
  return createElement("View", null, consent.card);
}
const mount = async (el: ReturnType<typeof createElement>) => {
  await act(async () => {
    root = create(el);
  });
};
/** A view stand-in by its name (the mocks render strings as host types). */
const is = (n: { type: unknown }, ...names: string[]) => names.includes(n.type as string);
const button = (label: string) => root!.root.find((n) => is(n, "PrimaryButton", "QuietButton") && n.props.label === label);
const press = async (label: string) => {
  await act(async () => button(label).props.onPress());
};
const cardShown = () => root!.root.findAll((n) => is(n, "Modal")).length > 0;

beforeEach(() => {
  h.local.clear();
  h.status = "signedOut";
  h.path = "/welcome";
  h.pushed = [];
  h.signedOut = 0;
  resetAiConsentForTests();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("before sign-in, the first send waits for the yes", () => {
  it("shows the card instead of sending, and sends on the yes, remembered for next time", async () => {
    await mount(createElement(Harness));
    const sent: string[] = [];
    await act(async () => gate!(() => sent.push("wish")));
    expect(sent).toEqual([]);
    expect(cardShown()).toBe(true);
    await press(CONSENT.agree);
    expect(sent).toEqual(["wish"]);
    expect(cardShown()).toBe(false);
    expect(h.local.get("dandelist.ai-consent")).toBe("1");
    // A second send goes straight through.
    await act(async () => gate!(() => sent.push("again")));
    expect(sent).toEqual(["wish", "again"]);
    expect(cardShown()).toBe(false);
  });

  it("sends nothing on Not now, and asks again on the next send", async () => {
    await mount(createElement(Harness));
    const sent: string[] = [];
    await act(async () => gate!(() => sent.push("wish")));
    await press(CONSENT.later);
    expect(sent).toEqual([]);
    expect(cardShown()).toBe(false);
    expect(h.local.has("dandelist.ai-consent")).toBe(false);
    await act(async () => gate!(() => sent.push("wish")));
    expect(cardShown()).toBe(true);
  });

  it("closes for the privacy page without sending or saying yes", async () => {
    await mount(createElement(Harness));
    const sent: string[] = [];
    await act(async () => gate!(() => sent.push("wish")));
    await press(CONSENT.legal);
    expect(h.pushed).toEqual(["/legal"]);
    expect(sent).toEqual([]);
    expect(cardShown()).toBe(false);
  });
});

describe("signed in on a device without the yes", () => {
  it("stands over the app until the yes", async () => {
    h.status = "signedIn";
    await mount(createElement(AiConsentGate));
    expect(cardShown()).toBe(true);
    await press(CONSENT.agree);
    expect(cardShown()).toBe(false);
    expect(h.local.get("dandelist.ai-consent")).toBe("1");
  });

  it("offers signing out instead", async () => {
    h.status = "signedIn";
    await mount(createElement(AiConsentGate));
    await press(CONSENT.signOut);
    expect(h.signedOut).toBe(1);
  });

  it("stays away when the device has said yes, before sign-in, and on the privacy page", async () => {
    h.local.set("dandelist.ai-consent", "1");
    h.status = "signedIn";
    await mount(createElement(AiConsentGate));
    expect(cardShown()).toBe(false);
    act(() => root!.unmount());

    h.local.clear();
    resetAiConsentForTests();
    h.status = "signedOut";
    await mount(createElement(AiConsentGate));
    expect(cardShown()).toBe(false);
    act(() => root!.unmount());

    resetAiConsentForTests();
    h.status = "signedIn";
    h.path = "/legal";
    await mount(createElement(AiConsentGate));
    expect(cardShown()).toBe(false);
  });
});

describe("the card's words", () => {
  const all = (sections: { body?: string[]; paragraphs?: string[] }[]) => JSON.stringify(sections);
  it("name Meta and Anthropic and the age, as the privacy policy and terms do", () => {
    const card = [CONSENT.title, ...CONSENT.lines, CONSENT.age, CONSENT.agree].join(" ");
    expect(card).toMatch(/Meta/);
    expect(card).toMatch(/Anthropic/);
    expect(card).toMatch(/18 or older/);
    expect(all(PRIVACY as never)).toMatch(/Meta's Model API/);
    expect(all(PRIVACY as never)).toMatch(/Anthropic's Claude API/);
    expect(all(TERMS as never)).toMatch(/18 or older/);
  });
});
