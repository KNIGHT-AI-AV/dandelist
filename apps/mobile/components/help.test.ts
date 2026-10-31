import { act, createElement, Fragment, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The help sheet as the app mounts it (review of #140): the real HelpHost, HelpButton and Settings entry over the real
 * sheet store, with React Native's views stood in by plain host elements and the auth session changed the way signing
 * in and out changes it. The phone's replay mask is stood in by a host element too, so the test can see what it wraps.
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;
// The renderer React Native's own test setup uses; this flag is how that setup says so.
g.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;

type Session = { status: "signedIn" | "signedOut"; user: { id: string } | null };
const auth = vi.hoisted(() => {
  let session: Session = { status: "signedIn", user: { id: "ada" } };
  const listeners = new Set<() => void>();
  return {
    get: () => session,
    set(next: Session) {
      session = next;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
});
const spies = vi.hoisted(() => ({ screenShot: vi.fn(), sendHelp: vi.fn(), api: async () => new Response("{}"), modal: [] as boolean[] }));

vi.mock("../lib/auth", async () => {
  const { useSyncExternalStore } = await import("react");
  // The request's binding to its sign-in has its own test against the real AuthProvider (help-signin.test.ts).
  return { useAuth: () => ({ ...useSyncExternalStore(auth.subscribe, auth.get), api: spies.api }), currentSignIn: () => 1, bindToSignIn: <T>(api: T) => api };
});
vi.mock("../lib/help", () => ({ helpState: (route: string) => ({ route }), sendHelp: spies.sendHelp }));
vi.mock("../lib/screen-shot", () => ({ screenShot: spies.screenShot }));
vi.mock("./replay-mask", () => ({ ReplayMask: "ReplayMask" }));
vi.mock("expo-image", () => ({ Image: "Image" }));
vi.mock("expo-router", () => ({ usePathname: () => "/list" }));
vi.mock("react-native", async () => {
  const { createElement: h } = await import("react");
  class Value {
    interpolate() {
      return 1;
    }
  }
  return {
    Animated: { View: "AnimatedView", Value, timing: () => ({ start: (done?: () => void) => done?.() }) },
    // Every render of the sheet's modal, shown or not: what each commit would put on screen.
    Modal: ({ visible, children }: { visible: boolean; children: ReactNode }) => (spies.modal.push(visible), visible ? h("Modal", null, children) : null),
    Pressable: "Pressable",
    StyleSheet: { absoluteFill: {} },
    Text: "Text",
    View: "View",
  };
});
vi.mock("../lib/motion", () => ({ haptic: { select() {}, success() {}, error() {} }, ease: { out: 0, inOut: 0 }, useReducedMotion: () => true }));
vi.mock("../lib/theme", () => ({
  layout: { control: { icon: 44 } },
  radius: { lg: 16, sm: 8 },
  space: { 12: 12, 16: 16, 24: 24 },
  type: { title3: {}, callout: {}, footnote: {} },
  usePalette: () => ({ ink: "#000", ink2: "#111", accentText: "#222", surface: "#333", danger: "#f00" }),
}));
vi.mock("./lux", () => ({ Eyebrow: "Eyebrow", Glass: "Glass", Icon: "Icon", PrimaryButton: "PrimaryButton", QuietButton: "QuietButton" }));

const { HelpButton, HelpHost, reportProblem } = await import("./help");
const { currentSheet, setHelpOwner } = await import("../lib/help-sheet");

const gate = <T>() => {
  let open!: (v: T) => void;
  const shut = new Promise<T>((r) => (open = r));
  return { shut, open };
};
const tick = () => new Promise((r) => setTimeout(r, 0));
let root: ReactTestRenderer;
const all = (pick: (n: ReactTestInstance) => boolean) => root.root.findAll(pick);
/** Whether `n` is the stand-in host element named `type` (the mocks render plain host elements). */
const is = (n: ReactTestInstance, type: string) => (n.type as unknown) === type;
const modal = () => all((n) => is(n, "Modal")).length > 0;
const texts = () => all((n) => is(n, "Text")).map((n) => [n.props.children].flat().join(""));
const pressWhere = (pick: (n: ReactTestInstance) => boolean) =>
  act(async () => {
    all(pick)[0]!.props.onPress();
    await tick();
  });
const pressButton = (label: string) => pressWhere((n) => (is(n, "PrimaryButton") || is(n, "QuietButton")) && n.props.label === label);
const pressHelp = () => pressWhere((n) => is(n, "Pressable") && n.props.accessibilityLabel === "Help");
const ancestors = (n: ReactTestInstance) => {
  const out: unknown[] = [];
  for (let p = n.parent; p; p = p.parent) out.push(p.type);
  return out;
};

describe("the help sheet, mounted (review of #140)", () => {
  beforeEach(async () => {
    spies.screenShot.mockReset().mockResolvedValue("SHOT");
    spies.sendHelp.mockReset().mockResolvedValue({ id: "6f1c2d3e-0000-4000-8000-000000000000", code: "6F1C2D" });
    auth.set({ status: "signedIn", user: { id: "ada" } });
    setHelpOwner(null);
    await act(async () => {
      // A concurrent root, as React Native's new architecture runs; the types don't list the option.
      root = create(createElement(Fragment, null, createElement(HelpHost), createElement(HelpButton)), { unstable_isConcurrent: true } as unknown as Parameters<typeof create>[1]);
    });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
  });

  it("shows the person the screen it took, inside the replay mask, with its label (H3)", async () => {
    await pressHelp();
    const image = root.root.findByType("Image" as never);
    expect(image.props.source.uri).toBe("data:image/jpeg;base64,SHOT");
    expect(image.props.accessibilityLabel).toBe("The screen that will be sent");
    expect(ancestors(image)).toContain("ReplayMask");
  });

  it("takes the picture from Settings too, the way in on narrow phones, before the sheet opens (H6)", async () => {
    await act(async () => {
      reportProblem();
      await tick();
    });
    expect(spies.screenShot).toHaveBeenCalledTimes(1);
    expect(ancestors(root.root.findByType("Image" as never))).toContain("ReplayMask");
    expect(texts().join("\n")).toContain("This screen, your latest conversation");
  });

  it("says only what goes when no picture could be taken, and claims no screen (H6)", async () => {
    spies.screenShot.mockRejectedValueOnce(new Error("capture failed"));
    await act(async () => {
      reportProblem();
      await tick();
    });
    expect(all((n) => is(n, "Image"))).toEqual([]);
    expect(texts().join("\n")).not.toContain("This screen");
    expect(texts().join("\n")).toContain("Your latest conversation");
  });

  it("sends that picture under the sheet's own key on Send, and nothing on Cancel", async () => {
    await pressHelp();
    await pressButton("Cancel");
    expect(modal()).toBe(false);
    expect(spies.sendHelp).not.toHaveBeenCalled();
    await pressHelp();
    const key = currentSheet()!.id;
    await pressButton("Send");
    expect(spies.sendHelp).toHaveBeenCalledWith(spies.api, { route: "/list" }, "SHOT", key);
    expect(texts()).toContain("Sent. Your report is 6F1C2D.");
  });

  it("never labels a new sheet sent with an older sheet's late answer (H2)", async () => {
    const reply = gate<{ id: string; code: string }>();
    spies.sendHelp.mockReturnValueOnce(reply.shut);
    await pressHelp();
    await pressButton("Send");
    await pressButton("Cancel");
    await pressHelp();
    await act(async () => {
      reply.open({ id: "old", code: "OLD123" });
      await tick();
    });
    expect(texts().join("\n")).not.toContain("OLD123");
    expect(texts()).toContain("Send what you're seeing?");
  });

  it("never opens a picture taken before someone else signed in, nor keeps a sheet across a sign-out (H2)", async () => {
    const shot = gate<string | null>();
    spies.screenShot.mockReturnValueOnce(shot.shut);
    await pressHelp();
    await act(async () => auth.set({ status: "signedOut", user: null }));
    await act(async () => auth.set({ status: "signedIn", user: { id: "bob" } }));
    await act(async () => {
      shot.open("ADA-SCREEN");
      await tick();
    });
    expect(modal()).toBe(false);
    expect(currentSheet()).toBeNull();
    // Bob's own sheet opens (current-session control), and goes when he signs out and back in.
    await pressHelp();
    expect(modal()).toBe(true);
    const from = spies.modal.length;
    await act(async () => auth.set({ status: "signedOut", user: null }));
    // Not shown from the very first render after the sign-out, before any effect has run.
    expect(spies.modal.length).toBeGreaterThan(from);
    expect(spies.modal.slice(from)).not.toContain(true);
    expect(modal()).toBe(false);
    await act(async () => auth.set({ status: "signedIn", user: { id: "bob" } }));
    expect(modal()).toBe(false);
    expect(currentSheet()).toBeNull();
  });
});
