import { describe, expect, it } from "vitest";
import { deckWidget } from "../src/dream/agent";
import { count } from "../src/dream/context";
import { listingPhoto, pagePhotos, photoAddress } from "../src/dream/pages";

// The owner's phone, 2026-11-05 ("No pictures"): every mobile.de card was a blank panel, and Sotheby's France cards
// showed the site's theme world map as a photo.
const MOBILE_DE = "https://m.mobile.de/yams-proxy/img.classistatic.de/api/v1/mo-prod/images/fe/fe7f6628-e28b-4304-a921-f83c16574965";
const WORLD = "https://www.sothebysrealty-france.com/theme/_siteSIR2021.sirfrance/images/world.png";

describe("listing photos the app can show (owner, 2026-11-05)", () => {
  it("gives mobile.de's photos an address that loads, with a size", () => {
    expect(photoAddress(MOBILE_DE)).toBe("https://img.classistatic.de/api/v1/mo-prod/images/fe/fe7f6628-e28b-4304-a921-f83c16574965?rule=mo-1024.jpg");
    expect(photoAddress("https://img.classistatic.de/api/v1/mo-prod/images/fe/x?rule=mo-640.jpg")).toBe("https://img.classistatic.de/api/v1/mo-prod/images/fe/x?rule=mo-640.jpg");
    expect(photoAddress("https://img4.idealista.fr/blur/WEB_DETAIL_TOP-XL-P/0/a.jpg")).toBe("https://img4.idealista.fr/blur/WEB_DETAIL_TOP-XL-P/0/a.jpg");
  });

  it("leaves a site's theme artwork out of a listing's photos", () => {
    expect(listingPhoto(WORLD)).toBe(false);
    expect(listingPhoto("https://www.sothebysrealty-france.com/datas/biens/images/50758/50758_00.jpg")).toBe(true);
    const html = `<meta property="og:image" content="https://www.sothebysrealty-france.com/datas/biens/images/1/1_00.jpg"><img src="${WORLD}" width="1200">`;
    expect(pagePhotos(html, "https://www.sothebysrealty-france.com/en/1", [])).toEqual(["https://www.sothebysrealty-france.com/datas/biens/images/1/1_00.jpg"]);
  });

  it("serves decks saved before the fix with photos that load", () => {
    const card = { id: "c1", title: "Cadillac Escalade", url: "https://suchen.mobile.de/x", source: "mobile.de", priceCents: 21_199_200, currency: "EUR", images: [{ url: MOBILE_DE, source: "mobile.de" }, { url: WORLD, source: "x" }] };
    const w = deckWidget({ id: "d1", round: 1, criteria: { kind: "car", make: "Cadillac", model: "Escalade" }, cards: [card] } as never);
    expect(w.cards[0]!.images.map((i) => i.url)).toEqual([photoAddress(MOBILE_DE)]);
  });

  it("says one listing and many listings", () => {
    expect(count(1, "listing")).toBe("1 listing");
    expect(count(22, "page")).toBe("22 pages");
    expect(count(2, "reference photo")).toBe("2 reference photos");
  });
});
