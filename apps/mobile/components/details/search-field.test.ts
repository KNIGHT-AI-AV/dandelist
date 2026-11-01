import { act, createElement } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The Details page's search field is a search field to every screen reader, by each platform's own word (review of
 * #195, 2026-11-01): a searchbox on the web, where "search" is a landmark a field can't have; "search" on the phones,
 * since on iOS a role wins over accessibilityRole and "searchbox" has no trait there (VoiceOver said "text field").
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ os: "web" }));
vi.mock("react-native", () => ({
  Animated: { View: "AnimatedView" },
  Platform: {
    get OS() {
      return h.os;
    },
  },
  Pressable: "Pressable",
  TextInput: "TextInput",
  View: "View",
}));
vi.mock("../../lib/motion", () => ({ usePress: () => ({ style: {}, onPressIn() {}, onPressOut() {} }) }));
vi.mock("../../lib/theme", () => ({ layout: { stack: { base: 16 }, control: { field: 48 } }, radius: { control: 12 }, space: { 12: 12 }, type: { body: {} }, usePalette: () => ({ ink: "#fff", ink2: "#ccc", ink3: "#999", line: "#333" }) }));
vi.mock("../lux", () => ({ Glass: "Glass", Icon: "Icon" }));

const { SearchField } = await import("./search-field");
let root: ReactTestRenderer | null = null;
async function field(os: string) {
  h.os = os;
  await act(async () => {
    root = create(createElement(SearchField, { value: "", onChangeText() {}, placeholder: "Search your wishes" }));
  });
  return root!.root.find((n: ReactTestInstance) => (n.type as unknown) === "TextInput").props;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
});

describe("the search field's role", () => {
  it("is a searchbox on the web", async () => {
    const p = await field("web");
    expect(p.role).toBe("searchbox");
    expect(p.accessibilityRole).toBeUndefined();
  });

  it("is a search field on iOS and Android, with no role to override it", async () => {
    for (const os of ["ios", "android"]) {
      const p = await field(os);
      expect([os, p.accessibilityRole, p.role]).toEqual([os, "search", undefined]);
      await act(async () => root!.unmount());
      root = null;
    }
  });
});
