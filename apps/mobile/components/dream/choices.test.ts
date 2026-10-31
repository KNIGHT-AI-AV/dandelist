import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The answers to Dandy's question, mounted: one tap answers, then they go quiet (owner, 2026-10-31). */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-native", () => ({ View: "View" }));
vi.mock("../../lib/theme", () => ({ space: { 8: 8 } }));
vi.mock("../lux", () => ({ Chip: "Chip" }));

const { Choices } = await import("./choices");
let root: ReactTestRenderer | null = null;
const chosen: string[] = [];
async function mount(live: boolean) {
  chosen.length = 0;
  await act(async () => {
    root = create(createElement(Choices, { options: ["New", "Used", "Either"], live, onChoose: (o: string) => void chosen.push(o) }));
  });
}
const chips = () => root!.root.findAll((n) => (n.type as unknown) === "Chip");
const tap = (label: string) => act(async () => chips().find((c) => c.props.label === label)!.props.onPress());

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
});

describe("tap an answer (owner, 2026-10-31)", () => {
  it("sends the tapped answer once, keeps it lit and quiets the rest", async () => {
    await mount(true);
    expect(chips().map((c) => c.props.label)).toEqual(["New", "Used", "Either"]);
    await tap("Used");
    expect(chosen).toEqual(["Used"]);
    expect(chips().find((c) => c.props.label === "Used")!.props.selected).toBe(true);
    expect(chips().every((c) => c.props.onPress === undefined)).toBe(true);
  });

  it("can't be answered once a newer turn has moved on", async () => {
    await mount(false);
    expect(chips().every((c) => c.props.onPress === undefined)).toBe(true);
  });
});
