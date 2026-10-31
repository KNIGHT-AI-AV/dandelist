import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageId } from "../../lib/pager";

/**
 * The free window after a confirmed removal, mounted (Codex, round 44: the theme screen and back kept it open). The
 * real hook; the screen focus and the app state stand in, so a test can take the home screen away and bring it back.
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ effect: null as null | (() => (() => void) | void), cleanup: null as null | (() => void) | void, app: null as null | ((s: string) => void) }));
vi.mock("expo-router", async () => {
  const { useEffect } = await import("react");
  return {
    useFocusEffect: (effect: () => (() => void) | void) => {
      useEffect(() => {
        nav.effect = effect;
        nav.cleanup = effect();
      }, [effect]);
    },
  };
});
vi.mock("react-native", () => ({
  AppState: {
    addEventListener: (_type: string, handler: (s: string) => void) => {
      nav.app = handler;
      return { remove() {} };
    },
  },
}));

const { useRemoveGrace } = await import("./remove-grace");
let grace: ReturnType<typeof useRemoveGrace> | null = null;
function Probe({ page }: { page: PageId }) {
  grace = useRemoveGrace(page);
  return null;
}
let root: ReactTestRenderer | null = null;
const show = (page: PageId) =>
  act(async () => {
    if (root) root.update(createElement(Probe, { page }));
    else root = create(createElement(Probe, { page }));
  });
/** The home screen gives way to another screen, then comes back to the front. */
const away = () =>
  act(async () => {
    if (typeof nav.cleanup === "function") nav.cleanup();
    nav.cleanup = nav.effect?.();
  });

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
});

describe("the free window after a confirmed removal (round 44)", () => {
  it("asks first, then lets removals through after a yes (control)", async () => {
    await show("list");
    expect(grace!.needs()).toBe(true);
    grace!.granted();
    expect(grace!.needs()).toBe(false);
  });

  it("asks again once the home screen gave way to another screen, even straight back", async () => {
    await show("list");
    grace!.granted();
    await away();
    expect(grace!.needs()).toBe(true);
  });

  it("keeps the window between the list and Details, and closes it on another page", async () => {
    await show("list");
    grace!.granted();
    await show("details");
    expect(grace!.needs()).toBe(false);
    await show("chat");
    expect(grace!.needs()).toBe(true);
  });

  it("closes the window when the app goes to the background", async () => {
    await show("list");
    grace!.granted();
    nav.app!("background");
    expect(grace!.needs()).toBe(true);
  });
});
