import { describe, expect, it } from "vitest";
import type { Fetcher } from "../src/agent/tools";
import { wikiPhotos } from "../src/wiki-photos";

const FILE = "Café_du_Monde.jpg";
const ORIGINAL = "https://upload.wikimedia.org/wikipedia/commons/a/ab/Caf%C3%A9_du_Monde.jpg";
const THUMB = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Caf%C3%A9_du_Monde.jpg/1920px-Caf%C3%A9_du_Monde.jpg";
const PAGE = "https://commons.wikimedia.org/wiki/File:Caf%C3%A9_du_Monde.jpg";
const IMAGE = { url: THUMB, width: 1920, height: 1280, source: "commons.wikimedia.org", credit: "A. Photographer", license: "CC BY-SA 4.0" };

/** The actual producer receives provider-shaped metadata; every request stays inside this fixture. */
function fixture(file: { repository?: string; descriptionUrl?: unknown }, fallback = false) {
  const calls: URL[] = [];
  const api = (async (input: Parameters<Fetcher>[0]) => {
    const u = new URL(String(input));
    calls.push(u);
    const q = u.searchParams;
    if (u.hostname === "en.wikipedia.org" && q.get("prop") === "pageimages|pageprops") {
      return Response.json({ query: { pages: [{ title: "Cafe", pageimage: fallback ? "Flag.svg" : FILE, pageprops: { wikibase_item: "Q42" } }] } });
    }
    if (u.hostname === "en.wikipedia.org" && q.get("prop") === "imageinfo") {
      if (q.get("titles") === "File:Flag.svg") {
        return Response.json({ query: { pages: [{ title: "File:Flag.svg", imagerepository: "shared", imageinfo: [{ url: "https://upload.wikimedia.org/flag.svg", width: 1200, height: 900, mime: "image/svg+xml" }] }] } });
      }
      if (q.get("titles") !== `File:${FILE}`) throw new Error("Unexpected file lookup");
      return Response.json({ query: { pages: [{
        title: `File:${FILE}`,
        ...(file.repository === undefined ? {} : { imagerepository: file.repository }),
        imageinfo: [{
          url: ORIGINAL,
          ...(file.descriptionUrl === undefined ? {} : { descriptionurl: file.descriptionUrl }),
          width: 3000,
          height: 2000,
          mime: "image/jpeg",
          thumburl: `${THUMB}?utm_source=en.wikipedia.org`,
          thumbwidth: 1920,
          thumbheight: 1280,
          extmetadata: { Artist: { value: "<a>A. Photographer</a>" }, LicenseShortName: { value: "CC BY-SA 4.0" } },
        }],
      }] } });
    }
    if (u.hostname === "www.wikidata.org" && q.get("action") === "wbgetclaims" && q.get("entity") === "Q42" && q.get("property") === "P18") {
      return Response.json({ claims: { P18: [{ rank: "preferred", mainsnak: { datavalue: { value: FILE } } }] } });
    }
    throw new Error("Unexpected provider request");
  }) as Fetcher;
  return { api, calls };
}

function expectLeadCalls(calls: URL[]) {
  expect(calls.map((u) => [u.hostname, u.searchParams.get("prop")])).toEqual([
    ["en.wikipedia.org", "pageimages|pageprops"],
    ["en.wikipedia.org", "imageinfo"],
  ]);
  expect(calls[1]!.searchParams.get("iiprop")).toBe("url|size|mime|extmetadata");
}

describe("Wikipedia photo File-page provenance", () => {
  it.each([PAGE, "https://commons.wikimedia.org:443/wiki/File%3ACaf%c3%a9_du_Monde.jpg"])("keeps the shared repository's actual description URL byte-for-byte: %s", async (sourcePage) => {
    const { api, calls } = fixture({ repository: "shared", descriptionUrl: sourcePage });
    const out = await wikiPhotos(["Cafe"], api);
    expect([...out]).toEqual([["Cafe", { article: "Cafe", image: { ...IMAGE, sourcePage } }]]);
    expectLeadCalls(calls);
  });

  it.each(["local", undefined, "unknown"])("keeps the photo but adds no Commons page for repository %s", async (repository) => {
    const { api, calls } = fixture({ repository, descriptionUrl: PAGE });
    const out = await wikiPhotos(["Cafe"], api);
    expect([...out]).toEqual([["Cafe", { article: "Cafe", image: { ...IMAGE, source: repository === "local" ? "wikipedia.org" : IMAGE.source } }]]);
    expectLeadCalls(calls);
  });

  it.each([
    undefined,
    42,
    "javascript:alert(1)",
    "https://en.wikipedia.org/wiki/File:Caf%C3%A9_du_Monde.jpg",
    "https://commons.wikimedia.org.evil.example/wiki/File:Cafe.jpg",
    "https://commons.wikimedia.org@evil.example/wiki/File:Cafe.jpg",
    "https://commons.wikimedia.org/wiki/User:Photographer",
    "https://commons.wikimedia.org/wiki/File:Cafe.jpg?redirect=evil",
    "https://commons.wikimedia.org/wiki/File:%ZZ.jpg",
  ])("keeps the same photo when a shared description URL is missing or invalid: %s", async (descriptionUrl) => {
    const { api, calls } = fixture({ repository: "shared", descriptionUrl });
    const out = await wikiPhotos(["Cafe"], api);
    expect([...out]).toEqual([["Cafe", { article: "Cafe", image: IMAGE }]]);
    expectLeadCalls(calls);
  });

  it("preserves the P18 fallback's own File page without changing selection or adding requests", async () => {
    const { api, calls } = fixture({ repository: "shared", descriptionUrl: PAGE }, true);
    const out = await wikiPhotos(["Cafe"], api);
    expect([...out]).toEqual([["Cafe", { article: "Cafe", image: { ...IMAGE, sourcePage: PAGE } }]]);
    expect(calls.map((u) => [u.hostname, u.searchParams.get("prop") ?? u.searchParams.get("action")])).toEqual([
      ["en.wikipedia.org", "pageimages|pageprops"],
      ["en.wikipedia.org", "imageinfo"],
      ["www.wikidata.org", "wbgetclaims"],
      ["en.wikipedia.org", "imageinfo"],
    ]);
  });
});
