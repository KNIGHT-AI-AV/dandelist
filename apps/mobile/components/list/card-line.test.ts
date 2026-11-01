import { act, createElement } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Wish } from "../../lib/wishes";

/**
 * The line under a card's name (owner's screenshot, 2026-11-01: the list cut "+ $1,105/mo" to "+ $1,10…"): where the
 * price came from gives way, the monthly figure stays whole, in the person's currency.
 */
const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
g.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ symbol: "$" }));
vi.mock("react-native", () => ({ Text: "Text", View: "View" }));
vi.mock("../../lib/currency", () => ({ useMoney: () => ({ format: (c: number) => `${h.symbol}${Math.round(c / 100).toLocaleString("en-US")}` }) }));
vi.mock("../../lib/theme", () => ({ space: { 8: 8 }, type: { footnote: {} }, usePalette: () => ({ ink2: "#ccc" }) }));
vi.mock("../lux", () => ({ AgentDot: "AgentDot" }));

const { CardLine } = await import("./card-line");

const r8 = {
  id: "w1",
  name: "Audi R8",
  details: { agent: { url: "https://suchen.mobile.de/fahrzeuge/details.html?id=1", status: "verified", checkedAt: new Date().toISOString() } },
} as unknown as Wish;

let root: ReactTestRenderer | null = null;
async function line(w: Wish, monthlyCents: number) {
  await act(async () => {
    root = create(createElement(CardLine, { w, monthlyCents }));
  });
  return root!.root.findAll((n: ReactTestInstance) => (n.type as unknown) === "Text");
}
const shrink = (t: ReactTestInstance) => (t.props.style as object[]).reduce((s: { flexShrink?: number }, x) => ({ ...s, ...x }), {}).flexShrink;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  h.symbol = "$";
});

describe("the line under a card's name", () => {
  it("keeps the monthly figure whole: its own text that never shrinks, after the part that gives way", async () => {
    const [source, monthly] = await line(r8, 110_500);
    expect(source!.props.children).toBe("Checked today on suchen.mobile.de");
    expect(source!.props.numberOfLines).toBe(1);
    expect(shrink(source!)).toBe(1);
    expect(monthly!.props.children).toBe(" · + $1,105/mo");
    expect(shrink(monthly!)).toBe(0);
  });

  it("is the source alone when the wish costs nothing a month", async () => {
    const texts = await line(r8, 0);
    expect(texts.map((t) => t.props.children)).toEqual(["Checked today on suchen.mobile.de"]);
  });

  it("shows the monthly figure in the person's currency", async () => {
    h.symbol = "€";
    const [, monthly] = await line(r8, 110_500);
    expect(monthly!.props.children).toBe(" · + €1,105/mo");
  });
});
