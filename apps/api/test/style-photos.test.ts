import { describe, expect, it } from "vitest";
import { commonsPhoto, homeBuilder, homeTitle } from "../src/dream/builders";
import type { DreamCtx } from "../src/dream/context";

/** A Commons page as the API returns it, landscape and large enough to show. */
const page = (title: string, index: number, artist = "") => ({
  title,
  index,
  imageinfo: [{ width: 4000, height: 3000, url: `https://upload.wikimedia.org/${encodeURIComponent(title)}`, thumburl: `https://upload.wikimedia.org/thumb/${encodeURIComponent(title)}`, extmetadata: { Artist: { value: artist }, LicenseShortName: { value: "CC BY-SA 4.0" } } }],
});

/** Answers Commons: a named file by its title, a search with these pages. */
function commons(search: Record<string, ReturnType<typeof page>[]>) {
  const asked: string[] = [];
  const api = async (url: string) => {
    const q = new URL(url).searchParams;
    asked.push(q.get("titles") ?? q.get("gsrsearch") ?? "");
    const pages = q.get("titles") ? [page(q.get("titles")!, 0, "<a href=\"//commons.wikimedia.org/wiki/User:A\">A Photographer</a>")] : (Object.entries(search).find(([k]) => q.get("gsrsearch")!.startsWith(k))?.[1] ?? []);
    return new Response(JSON.stringify({ query: { pages: Object.fromEntries(pages.map((p, i) => [String(i), p])) } }));
  };
  return { api, asked };
}

// What Commons search gave the home builder on 2026-11-05 (owner's screenshot): Russian peasant girls for
// "Traditional France", an office block for glass and concrete.
const KIRILLOV = "File:Russian peasant girls in front of a traditional wooden house in Kirillov.jpg";
const OFFICE = "File:Cloudflare and EY Office Complex - Modern Architecture in Alcantara, Lisbon.jpg";

describe("the home builder's style photos (owner, 2026-11-05)", () => {
  it("reads a file name as a home only when it names one and nothing else", () => {
    expect(homeTitle(KIRILLOV)).toBe(false);
    expect(homeTitle(OFFICE)).toBe(false);
    expect(homeTitle("File:Palacio de Aldama Havana Autocad Floor Plan First Floor.jpg")).toBe(false);
    expect(homeTitle("File:Traditional house in Rouen, France.jpg")).toBe(true);
    expect(homeTitle("File:Finca-Raixa.Mallorca.jpg")).toBe(true);
  });

  it("skips search results the check turns down, and names no author it doesn't know", async () => {
    const { api } = commons({ "glass villa test": [page(OFFICE, 1), page("File:Glass villa on a hill.jpg", 2)] });
    expect(await commonsPhoto({ api } as never, "glass villa test", homeTitle)).toEqual({ url: expect.stringContaining("Glass%20villa"), credit: "CC BY-SA 4.0, Wikimedia Commons" });
  });

  it("shows each fixed style's chosen photo, and the region's own tradition or none", async () => {
    const { api, asked } = commons({
      "traditional house France": [page(KIRILLOV, 1), page("File:Traditional Houses, Brasov.jpg", 2), page("File:Traditional house in Rouen, France.jpg", 3)],
      "traditional house Atlantis": [page("File:Traditional Houses, Brasov.jpg", 1)],
    });
    const ctx = { api, step: async () => undefined } as unknown as DreamCtx;
    const criteria = { styles: [], features: [], bedrooms: null, maxPrice: null, currency: "EUR" } as never;
    const france = await homeBuilder(ctx, "w1", criteria, "France");
    const modern = france.styles.find((s) => s.id === "modern")!;
    expect(asked).toContain("File:Private Villa Ibiza.jpg");
    expect(modern.credit).toBe("A Photographer, CC BY-SA 4.0, Wikimedia Commons");
    expect(france.styles.find((s) => s.id === "traditional")!.imageUrl).toContain(encodeURIComponent("Rouen"));
    const nowhere = await homeBuilder(ctx, "w2", criteria, "Atlantis");
    expect(nowhere.styles.find((s) => s.id === "traditional")!.imageUrl).toBeUndefined();
  });
});
