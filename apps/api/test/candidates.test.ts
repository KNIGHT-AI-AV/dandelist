import { describe, expect, it } from "vitest";
import { candidatesOf, readingOf } from "../src/agent/agent";
import { candidatePhotos, photoTitles } from "../src/agent/candidates";
import type { Archive, ArchiveHit } from "../src/archive/archive";

const porsche = (model: string, variant = "") => ({ name: `Porsche ${model}${variant ? ` ${variant}` : ""}`, make: "Porsche", model, variant });

describe("a vague wish's candidates (owner, 2026-10-30: pick which one they meant, by photo)", () => {
  it("keeps only candidates that make a choice: named, with a model, never twice, five at most, two or more", () => {
    expect(candidatesOf([porsche("911", "Carrera"), porsche("Cayenne"), porsche("Taycan"), porsche("Macan"), porsche("Panamera"), porsche("718", "Cayman")])).toHaveLength(5);
    expect(candidatesOf([porsche("911", "Carrera"), { ...porsche("911", "Carrera"), name: " porsche 911  carrera " }, { name: "Porsche", make: "Porsche", model: "" }, null, "Porsche", porsche("Cayenne")]).map((c) => c.name)).toEqual(["Porsche 911 Carrera", "Porsche Cayenne"]);
    expect(candidatesOf([porsche("911", "Carrera")])).toEqual([]);
    expect(candidatesOf("Porsche 911")).toEqual([]);
    expect(candidatesOf([{ name: "  Rolex   Submariner ", make: "Rolex", model: "Submariner", variant: 41 }, porsche("911")])[0]).toEqual({ name: "Rolex Submariner", make: "Rolex", model: "Submariner", variant: "" });
  });

  it("are read only for priced wishes: money and priceless have nothing to pick", () => {
    const two = [porsche("911"), porsche("Cayenne")];
    expect((readingOf({ title: "Porsche 911", worth: "priced", candidates: two }) as { candidates: unknown[] }).candidates).toHaveLength(2);
    expect((readingOf({ title: "Money", worth: "money", candidates: two }) as { candidates: unknown[] }).candidates).toEqual([]);
    expect((readingOf({ title: "Love", worth: "priceless", candidates: two }) as { candidates: unknown[] }).candidates).toEqual([]);
  });

  it("look a photo up by make and model, then the model alone for a kind with no maker", () => {
    expect(photoTitles({ make: "Porsche", model: "911" })).toEqual(["Porsche 911", "911"]);
    expect(photoTitles({ make: "Cat", model: "Maine Coon" })).toEqual(["Cat Maine Coon", "Maine Coon"]);
    expect(photoTitles({ make: "Rolex", model: "Rolex Submariner" })).toEqual(["Rolex Submariner"]);
    expect(photoTitles({ make: "", model: "Bonsai" })).toEqual(["Bonsai"]);
  });
});

/** A Wikipedia that knows a few articles and their lead photos, answering the two calls wikiPhotos makes. */
const LEADS: Record<string, { article: string; file?: string; disambiguation?: boolean }> = {
  "Porsche 911": { article: "Porsche 911", file: "Porsche_911_(992).jpg" },
  "Porsche Taycan": { article: "Porsche" , file: "Porsche_logo.jpg" },
  "Maine Coon": { article: "Maine Coon", file: "Maine_Coon_cat.jpg" },
  "Porsche Cayenne": { article: "Porsche Cayenne (disambiguation)", disambiguation: true },
};
const wiki = (async (input: string | URL) => {
  const u = new URL(String(input));
  const p = u.searchParams;
  if (p.get("prop") === "imageinfo") {
    const pages = (p.get("titles") ?? "").split("|").map((t) => ({
      title: t,
      imagerepository: "shared",
      imageinfo: [{ url: `https://upload.wikimedia.org/${encodeURIComponent(t.slice(5))}`, width: 3000, height: 2000, mime: "image/jpeg", extmetadata: { Artist: { value: "<a>A. Photographer</a>" }, LicenseShortName: { value: "CC BY-SA 4.0" } } }],
    }));
    return Response.json({ query: { pages } });
  }
  const asked = (p.get("titles") ?? "").split("|");
  const redirects = asked.filter((t) => LEADS[t] && LEADS[t]!.article !== t).map((t) => ({ from: t, to: LEADS[t]!.article }));
  const pages = asked.map((t) => {
    const lead = LEADS[t];
    if (!lead) return { title: t, missing: true };
    return { title: lead.article, ...(lead.file ? { pageimage: lead.file } : {}), pageprops: lead.disambiguation ? { disambiguation: "" } : { wikibase_item: "Q1" } };
  });
  return Response.json({ query: { redirects, pages } });
}) as never;

const archive: Archive = {
  lookup: async (subject) =>
    subject === "Porsche 911 GT3"
      ? ({ entity: { id: "e1", name: "Porsche 911 GT3", aliases: [], kind: "vehicle", tier: 1, subcategory: "car" }, photos: [{ url: "https://images.example/gt3.jpg", width: 2400, height: 1600, source: "commons", sourcePage: "https://commons.wikimedia.org/wiki/File:GT3.jpg", photographer: "B. Shooter", license: "CC BY 2.0", hero: true }] } as ArchiveHit)
      : null,
  contribute: async () => 0,
};

describe("a photo for each candidate", () => {
  it("takes the archive's photo first, else the lead photo of the model's own article, and never a brand's or a disambiguation's", async () => {
    const out = await candidatePhotos(
      [porsche("911", "GT3"), porsche("911", "Carrera S"), porsche("Taycan"), porsche("Cayenne"), { name: "Maine Coon kitten", make: "Cat", model: "Maine Coon", variant: "" }],
      { archive, api: wiki, kind: "vehicle", by: Date.now() + 5_000 },
    );
    expect(out[0]!.image).toMatchObject({ url: "https://images.example/gt3.jpg", credit: "B. Shooter", license: "CC BY 2.0" });
    expect(out[1]!.image).toMatchObject({ url: expect.stringContaining("Porsche_911_(992).jpg"), credit: "A. Photographer", license: "CC BY-SA 4.0" });
    // "Porsche Taycan" lands on the "Porsche" article: the brand's photo is not the Taycan's.
    expect(out[2]!.image).toBeUndefined();
    expect(out[3]!.image).toBeUndefined();
    expect(out[4]!.image).toMatchObject({ url: expect.stringContaining("Maine_Coon_cat.jpg") });
    expect(out.map((c) => c.name)).toEqual(["Porsche 911 GT3", "Porsche 911 Carrera S", "Porsche Taycan", "Porsche Cayenne", "Maine Coon kitten"]);
  });

  it("keeps the names when the lookups fail or run out of time", async () => {
    const down = (async () => new Response("down", { status: 503 })) as never;
    const out = await candidatePhotos([porsche("911"), porsche("Taycan")], { api: down, kind: "vehicle", by: Date.now() + 1_000 });
    expect(out).toEqual([porsche("911"), porsche("Taycan")]);
  });
});
