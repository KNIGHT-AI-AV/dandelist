import { act, createElement, Fragment, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The list's screen under an open wish (axe and a Tab walk, 2026-11-01): wishes/[id] opens as a transparent modal and
 * leaves this screen mounted underneath, where Tab went through the bar's controls before the wish's own and, from its
 * Back button, into the list hidden beneath. On the web the screen is inert and hidden while it isn't the focused one.
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ os: "web", focused: true }));
const pass = ({ children }: { children?: ReactNode }) => createElement(Fragment, null, children);

vi.mock("expo-router", () => ({ Redirect: "Redirect", useIsFocused: () => h.focused, useLocalSearchParams: () => ({}) }));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return h.os;
    },
  },
  View: "View",
}));
vi.mock("../atmosphere", () => ({ Atmosphere: "Atmosphere" }));
vi.mock("./bridge", () => ({ HomeProvider: pass }));
vi.mock("./chat-page", () => ({ ChatPage: "ChatPage" }));
vi.mock("./chrome", () => ({ Dock: "Dock", TopBar: "TopBar" }));
vi.mock("./details-page", () => ({ DetailsPage: "DetailsPage" }));
vi.mock("./list-page", () => ({ ListPage: "ListPage" }));
vi.mock("./money-page", () => ({ MoneyPage: "MoneyPage" }));
vi.mock("./pager", () => ({ PagerProvider: pass, PagerView: "PagerView" }));
vi.mock("./removals", () => ({ RemovalsProvider: pass }));
vi.mock("./settings-page", () => ({ SettingsPage: "SettingsPage" }));
vi.mock("../lux", () => ({ Grain: "Grain" }));
vi.mock("../../lib/auth", () => ({ useAuth: () => ({ status: "signedIn" }) }));
vi.mock("../../lib/pager", () => ({ PAGES: ["list", "chat", "details", "money", "settings"] }));
vi.mock("../../lib/theme", () => ({ usePalette: () => ({ bg: "#000" }) }));

const { default: Home } = await import("../../app/wishes/index");
let root: ReactTestRenderer | null = null;
async function screen(os: string, focused: boolean) {
  h.os = os;
  h.focused = focused;
  await act(async () => {
    root = create(createElement(Home));
  });
  // The screen's own outermost view, around the pages, the bar and the composer.
  return root!.root.find((n: ReactTestInstance) => (n.type as unknown) === "View" && n.findAll((c) => (c.type as unknown) === "PagerView").length > 0 && (n.parent?.type as unknown) !== "View").props;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
});

describe("the list's screen with a wish open over it", () => {
  it("leaves the keyboard and screen readers to the wish on the web, and comes back once the wish closes", async () => {
    expect(await screen("web", false)).toMatchObject({ inert: true, "aria-hidden": true });
    await act(async () => root!.unmount());
    expect(await screen("web", true)).toMatchObject({ inert: false, "aria-hidden": false });
  });

  it("changes nothing on a phone", async () => {
    const p = await screen("ios", false);
    expect([p.inert, p["aria-hidden"]]).toEqual([undefined, undefined]);
  });
});
