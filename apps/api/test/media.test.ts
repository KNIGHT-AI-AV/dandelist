import { readFileSync } from "node:fs";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { describe, expect, it, vi } from "vitest";
import { composeCutout, cutoutSource, decodeImage, makeCutout, parseSam, pickMask } from "../src/agent/cutout";
import {
  allowsCutout,
  commonsPhotos,
  embedUrlFor,
  huntImages,
  imageInfo,
  mediaSchema,
  premiumPrompt,
  probeImage,
  rankImages,
  sketchfabSearch,
  upsizedVariants,
  type FoundImage,
} from "../src/agent/media";
import { conditionOf, matchOffer, parsePrice, shoppingSearch, toOffers } from "../src/agent/shopping";
import { largestFromSrcset, pageImages } from "../src/agent/tools";
import { memoryMediaStore } from "../src/media-store";
import { imageResponse, jpegHeader, pngHeader, productJpeg, webpHeader } from "./images";

const SAM_TEXT = readFileSync(new URL("./fixtures/sam-camera.txt", import.meta.url), "utf8");

describe("image sizes from headers", () => {
  it("reads PNG, JPEG, WebP and GIF without decoding", () => {
    expect(imageInfo(pngHeader(3840, 2560, 6))).toEqual({ type: "png", width: 3840, height: 2560, alpha: true });
    expect(imageInfo(pngHeader(1200, 800, 2))).toEqual({ type: "png", width: 1200, height: 800, alpha: false });
    expect(imageInfo(pngHeader(1200, 800, 3, "tRNS"))?.alpha).toBe(true);
    expect(imageInfo(jpegHeader(2048, 1365))).toEqual({ type: "jpeg", width: 2048, height: 1365, alpha: false });
    expect(imageInfo(webpHeader("VP8X", 4000, 3000, true))).toEqual({ type: "webp", width: 4000, height: 3000, alpha: true });
    expect(imageInfo(webpHeader("VP8L", 1600, 900, true))).toEqual({ type: "webp", width: 1600, height: 900, alpha: true });
    expect(imageInfo(webpHeader("VP8 ", 1024, 768))).toEqual({ type: "webp", width: 1024, height: 768, alpha: false });
    expect(imageInfo(Buffer.from("GIF89a\x40\x01\xf0\x00", "latin1"))).toEqual({ type: "gif", width: 320, height: 240, alpha: false });
    expect(imageInfo(Buffer.from("<html>not an image</html>"))).toBeNull();
  });

  it("probes only the first bytes of a public image and refuses pages and private hosts", async () => {
    const asked: Record<string, string>[] = [];
    const web = (async (url: string | URL, init: RequestInit) => {
      asked.push(init.headers as Record<string, string>);
      if (String(url).endsWith("/page")) return new Response("<html></html>", { headers: { "content-type": "text/html" } });
      return new Response(jpegHeader(3000, 2000), { status: 206, headers: { "content-type": "image/jpeg" } });
    }) as unknown as typeof fetch;
    expect(await probeImage("https://93.184.215.14/hero.jpg", web)).toMatchObject({ type: "jpeg", width: 3000, height: 2000, url: "https://93.184.215.14/hero.jpg" });
    expect(asked[0]!.Range).toBe("bytes=0-131071");
    expect(await probeImage("https://93.184.215.14/page", web)).toBeNull();
    expect(await probeImage("http://127.0.0.1/hero.jpg", web)).toBeNull();
    expect(asked).toHaveLength(2);
  });
});

describe("finding product images on a page", () => {
  const html = `<html><head><title>Leica Q3 | Leica Camera US</title>
    <meta property="og:image" content="/files/q3-share.jpg">
    <meta name="twitter:image" content="https://cdn.example.com/q3-twitter.jpg">
    <script type="application/ld+json">{"@type":"Product","name":"Leica Q3","image":["https://cdn.example.com/q3-front.png",{"@type":"ImageObject","contentUrl":"https://cdn.example.com/q3-back.png"}],"brand":{"@type":"Brand","logo":"https://cdn.example.com/logo.png"}}</script>
    </head><body>
    <img src="/q3-small.jpg" data-zoom-image="/q3-zoom.jpg" alt="product">
    <img srcset="/q3-top-400.webp 400w, /q3-top-1600.webp 1600w" alt="Leica Q3 from the top">
    <img srcset="/party-400.webp 400w, /party-1600.webp 1600w" alt="A party in Munich">
    <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Leica Q3 pixel">
    </body></html>`;

  it("collects JSON-LD arrays, share images, zoom variants and named gallery images, most trusted first", () => {
    const found = pageImages(html, "https://shop.example.com/q3");
    expect(found).toEqual([
      "https://cdn.example.com/q3-front.png",
      "https://cdn.example.com/q3-back.png",
      "https://shop.example.com/files/q3-share.jpg",
      "https://cdn.example.com/q3-twitter.jpg",
      "https://shop.example.com/q3-zoom.jpg",
      "https://shop.example.com/q3-top-1600.webp",
    ]);
    expect(largestFromSrcset("a.jpg 1x, b.jpg 2x")).toBe("b.jpg");
  });

  it("tries the originals behind CDN resize parameters and size suffixes", () => {
    expect(upsizedVariants("https://cdn.shopify.com/s/files/1/q3_600x600.jpg?v=12")).toEqual(["https://cdn.shopify.com/s/files/1/q3.jpg?v=12"]);
    expect(upsizedVariants("https://blog.example.com/wp-content/uploads/q3-1024x768.jpg")).toEqual(["https://blog.example.com/wp-content/uploads/q3.jpg"]);
    expect(upsizedVariants("https://m.media-amazon.com/images/I/71abc._AC_SX679_.jpg")).toEqual(["https://m.media-amazon.com/images/I/71abc.jpg"]);
    expect(upsizedVariants("https://res.cloudinary.com/x/image/upload/w_500,h_500,c_fill/q3.jpg")).toEqual(["https://res.cloudinary.com/x/image/upload/q3.jpg"]);
    expect(upsizedVariants("https://img.example.com/q3.jpg?w=400&h=400&v=2")).toEqual(["https://img.example.com/q3.jpg?v=2"]);
    expect(upsizedVariants("https://leica-camera.com/sites/default/files/styles/large_2x/public/2026-05/q3_top.png.webp?itok=abc")[0]).toBe("https://leica-camera.com/sites/default/files/2026-05/q3_top.png");
    expect(upsizedVariants("https://encrypted-tbn1.gstatic.com/shopping?q=tbn:abc")).toEqual([]);
    expect(upsizedVariants("https://img.example.com/q3.jpg")).toEqual([]);
  });

  it("ranks by resolution up to 4K, then clean backgrounds, and drops icons, banners and repeats", () => {
    const img = (url: string, width: number, height: number, alpha = false): FoundImage => ({ url, width, height, alpha, type: "png", source: "x" });
    const ranked = rankImages([
      img("https://a/icon.png", 64, 64),
      img("https://a/banner.jpg", 3000, 400),
      img("https://a/mid.jpg", 1600, 1200),
      img("https://a/huge.jpg", 8000, 6000),
      img("https://a/clean.png", 4200, 2800, true),
      img("https://a/mid.jpg?again=1", 1600, 1200),
    ]);
    expect(ranked.map((i) => i.url)).toEqual(["https://a/clean.png", "https://a/huge.jpg", "https://a/mid.jpg"]);
  });

  it("probes candidates and their larger variants, keeping what really loads", async () => {
    const sizes: Record<string, [number, number]> = { "https://cdn.example.com/q3.jpg": [3000, 2000], "https://cdn.example.com/q3.jpg?w=500": [500, 333] };
    const probe = async (url: string) => (sizes[url] ? { url, type: "jpeg" as const, width: sizes[url]![0], height: sizes[url]![1], alpha: false } : null);
    const found = await huntImages([{ url: "https://cdn.example.com/q3.jpg?w=500", source: "example.com", credit: "Example" }, { url: "https://cdn.example.com/missing.jpg", source: "example.com" }], probe);
    // The resized copy is the same picture, so only the original stays.
    expect(found.map((f) => [f.url, f.width, f.source, f.credit])).toEqual([["https://cdn.example.com/q3.jpg", 3000, "example.com", "Example"]]);
  });
});

describe("Wikimedia Commons and Sketchfab", () => {
  it("returns landscape Featured and Quality photos with author and license, at most 3840 wide", async () => {
    const seen: { url: string; ua?: string }[] = [];
    const page = (id: number, title: string, w: number, h: number, cats: string[], extra: Record<string, unknown> = {}) => ({
      pageid: id,
      title: `File:${title}.jpg`,
      index: id,
      categories: cats.map((c) => ({ title: c })),
      imageinfo: [
        {
          width: w,
          height: h,
          mime: "image/jpeg",
          url: `https://upload.wikimedia.org/${title}.jpg?utm_source=commons`,
          thumburl: `https://upload.wikimedia.org/thumb/${title}/3840px.jpg?utm_source=commons`,
          extmetadata: { Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Ana">Ana Lima</a>' }, LicenseShortName: { value: "CC BY-SA 4.0" }, ImageDescription: { value: "<p>View of Alfama</p>" } },
          ...extra,
        },
      ],
    });
    const web = (async (url: string | URL, init: RequestInit) => {
      seen.push({ url: String(url), ua: (init.headers as Record<string, string>)["User-Agent"] });
      const pages = seen.length === 1
        ? { 1: page(1, "Alfama at dusk", 6000, 4000, ["Category:Quality images"]), 2: page(2, "Belem tower portrait", 3000, 4500, ["Category:Featured pictures on Wikimedia Commons"]), 3: page(3, "Tiny Lisbon", 1200, 800, []), 4: page(4, "Lisbon from Graca", 2400, 1600, ["Category:Featured pictures on Wikimedia Commons"]) }
        : {};
      return new Response(JSON.stringify({ query: { pages } }), { headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const photos = await commonsPhotos("Lisbon", web);
    expect(photos.map((p) => [p.title, p.width, p.height, p.featured])).toEqual([
      ["Lisbon from Graca", 2400, 1600, true],
      ["Alfama at dusk", 3840, 2560, false],
    ]);
    expect(photos[1]).toMatchObject({ url: "https://upload.wikimedia.org/thumb/Alfama%20at%20dusk/3840px.jpg", credit: "Ana Lima", license: "CC BY-SA 4.0", description: "View of Alfama", quality: true });
    expect(photos[0]!.url).toBe("https://upload.wikimedia.org/Lisbon%20from%20Graca.jpg");
    expect(seen[0]!.ua).toMatch(/^Dandelist\//);
    expect(new URL(seen[0]!.url).searchParams.get("gsrsearch")).toBe('intitle:"Lisbon" incategory:Featured_pictures_on_Wikimedia_Commons|Quality_images filetype:bitmap');
  });

  it("finds 3D models, drops age-restricted ones and builds the dark, hint-free embed", async () => {
    const web = (async () =>
      new Response(
        JSON.stringify({
          results: [
            { uid: "d01b254483794de3819786d93e0e1ebf", name: "Porsche 911 Carrera 4S", user: { displayName: "Lionsharp Studios" }, license: { label: "CC Attribution-ShareAlike" }, likeCount: 3580, viewCount: 689929, isAgeRestricted: false, thumbnails: { images: [{ url: "https://media.sketchfab.com/t/64.jpg", width: 64 }, { url: "https://media.sketchfab.com/t/1024.jpg", width: 1024 }, { url: "https://media.sketchfab.com/t/1920.jpg", width: 1920 }] } },
            { uid: "2bfff9d0d0b44a52a0635a51cfb69bab", name: "Hidden", user: { username: "x" }, isAgeRestricted: true },
            { uid: "not-a-uid", name: "Broken" },
            { uid: "5454444654c84c87bf84d1d9b1fc24eb", name: "911 SC engine", user: { username: "prokop" }, license: null, likeCount: 278, viewCount: 32399 },
          ],
        }),
      )) as unknown as typeof fetch;
    const found = await sketchfabSearch("porsche 911 carrera", web);
    expect(found.map((m) => m.uid)).toEqual(["d01b254483794de3819786d93e0e1ebf", "5454444654c84c87bf84d1d9b1fc24eb"]);
    expect(found[0]).toMatchObject({ author: "Lionsharp Studios", license: "CC Attribution-ShareAlike", likes: 3580, viewCount: 689929, thumbnail: "https://media.sketchfab.com/t/1920.jpg", isAgeRestricted: false });
    expect(found[1]!.license).toBe("Not specified");
    expect(embedUrlFor("d01b254483794de3819786d93e0e1ebf")).toBe("https://sketchfab.com/models/d01b254483794de3819786d93e0e1ebf/embed?autostart=1&ui_theme=dark&transparent=1&ui_hint=0");
  });

  it("only cuts out Commons photos whose license allows a derivative without share-alike", () => {
    expect(["CC0", "Public domain", "CC BY 4.0", "CC BY 2.0 de"].map(allowsCutout)).toEqual([true, true, true, true]);
    expect(["CC BY-SA 4.0", "CC BY-ND 4.0", "CC BY-SA 2.0 de", "See Wikimedia Commons", ""].map(allowsCutout)).toEqual([false, false, false, false, false]);
  });

  it("asks for campaign-grade, text-free, people-free pictures", () => {
    const p = premiumPrompt("place", "Lisbon");
    expect(p).toContain("Lisbon");
    expect(p).toMatch(/No text, no logos, no watermarks, no people/);
    expect(p).toMatch(/Ritz-Carlton/);
  });

  it("accepts saved media from the agent and refuses scripts and foreign embeds", () => {
    const good = {
      kind: "vehicle",
      images: [{ url: "https://upload.wikimedia.org/a.jpg", width: 3840, height: 2560, source: "commons.wikimedia.org", credit: "Ana", license: "CC BY-SA 4.0" }],
      model3d: { provider: "sketchfab", uid: "d01b254483794de3819786d93e0e1ebf", name: "911", author: "L", license: "CC", embedUrl: embedUrlFor("d01b254483794de3819786d93e0e1ebf"), thumbnail: "https://media.sketchfab.com/t.jpg" },
    };
    expect(mediaSchema.safeParse(good).success).toBe(true);
    expect(mediaSchema.safeParse({ ...good, images: [{ url: "javascript:alert(1)", source: "x" }] }).success).toBe(false);
    expect(mediaSchema.safeParse({ ...good, model3d: { ...good.model3d, embedUrl: "https://evil.example.com/models/d01b254483794de3819786d93e0e1ebf/embed?x=1" } }).success).toBe(false);
  });
});

describe("shopping search", () => {
  it("reads listed prices in any common format", () => {
    expect(parsePrice("$7,350.00", "USD")).toEqual({ amount: 7350, currency: "USD" });
    expect(parsePrice("7.350,00 €", "USD")).toEqual({ amount: 7350, currency: "EUR" });
    expect(parsePrice("£1,299", "USD")).toEqual({ amount: 1299, currency: "GBP" });
    expect(parsePrice("1.299 €", "EUR")).toEqual({ amount: 1299, currency: "EUR" });
    expect(parsePrice("$24.99", "CAD")).toEqual({ amount: 24.99, currency: "CAD" });
    expect(parsePrice("Free", "USD")).toBeNull();
    expect(conditionOf("USED Leica Q3 (#0572)")).toBe("used");
    expect(conditionOf("Leica Q3 - Renewed")).toBe("refurbished");
    expect(conditionOf("Leica Q3 Digital Camera")).toBeUndefined();
  });

  it("turns actor items into offers and drops prices far below the rest", () => {
    const offers = toOffers(
      [
        { title: "Leica Q3 Digital Camera", source: "leicacamerausa.com", price: "$7,350.00", imageUrl: "https://encrypted-tbn2.gstatic.com/shopping?q=1", link: "https://www.google.com/search?ibp=oshop&q=x", rating: 4.8, ratingCount: 229 },
        { title: "Leica Q3 43", source: "Adorama", price: "$6,221.00" },
        { title: "USED Leica Q3", source: "CameraMall", price: "$6,333.99" },
        { title: "Leica Q3", source: "Uncrate", price: "$6.00" },
        { title: "No price", source: "Shop", price: "" },
      ],
      "USD",
    );
    expect(offers.map((o) => [o.merchant, o.price, o.condition])).toEqual([
      ["leicacamerausa.com", 7350, undefined],
      ["Adorama", 6221, undefined],
      ["CameraMall", 6333.99, "used"],
    ]);
    expect(offers[0]).toMatchObject({ image: "https://encrypted-tbn2.gstatic.com/shopping?q=1", rating: 4.8, reviews: 229 });
  });

  it("runs the actor with the token in a header, a hard charge cap and a timeout, and prices the run", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const apify = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify([{ title: "Leica Q3", source: "Adorama", price: "$6,221.00" }, { title: "Leica Q3", source: "B&H Photo-Video-Audio", price: "$6,295.00" }]), { status: 201 });
    }) as unknown as typeof fetch;
    const r = await shoppingSearch("Leica Q3", "US", "USD", { token: "apify-secret", fetcher: apify });
    expect(seen!.url).toBe("https://api.apify.com/v2/acts/damilo~google-shopping-apify/run-sync-get-dataset-items?timeout=40&maxTotalChargeUsd=0.0210&clean=true&format=json");
    expect(seen!.url).not.toContain("apify-secret");
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe("Bearer apify-secret");
    expect(JSON.parse(String(seen!.init.body))).toEqual({ query: "Leica Q3", country: "us", language: "en", num: "10", max_pages: 1 });
    expect(r.offers).toHaveLength(2);
    expect(r.costUsd).toBeCloseTo(0.007, 10);
    expect(matchOffer(r.offers, { seller: "B&H Photo Video", url: "https://www.bhphotovideo.com/c/product/1.html", currency: "usd", price: 6295 })?.merchant).toBe("B&H Photo-Video-Audio");
    expect(matchOffer(r.offers, { seller: "Adorama", url: "https://www.google.com/search?q=x", currency: "USD", price: 6300 })).toBeUndefined();
  });
});

describe("SAM 3.1 cutouts", () => {
  const box = { left: 145, top: 116, right: 1072, bottom: 805 };

  it("reads SAM's mask records", async () => {
    const masks = await parseSam(SAM_TEXT);
    expect(masks).toHaveLength(1);
    expect(masks[0]).toMatchObject({ ...box, width: 927, height: 689 });
    expect(masks[0]!.confidence).toBeGreaterThan(0.9);
    expect(masks[0]!.raster.length).toBe(927 * 689);
    expect(await parseSam("")).toEqual([]);
  });

  it("lifts the masked product onto transparency, cropped with a little air", async () => {
    const img = decodeImage(productJpeg(1280, 960, box))!;
    const mask = pickMask(await parseSam(SAM_TEXT), img.width, img.height)!;
    const cut = composeCutout(img, mask);
    expect([cut.width, cut.height]).toEqual([1001, 763]);
    expect(imageInfo(cut.png)).toEqual({ type: "png", width: 1001, height: 763, alpha: true });
    const out = decodeImage(cut.png)!;
    const alphaAt = (x: number, y: number) => out.data[(y * out.width + x) * 4 + 3];
    expect(alphaAt(2, 2)).toBe(0);
    expect(alphaAt(500, 400)).toBe(255);
    const small = composeCutout(img, mask, 500);
    expect(Math.max(small.width, small.height)).toBe(500);
  });

  it("refuses a decompression bomb from its header, before decoding a byte", async () => {
    const pngRead = vi.spyOn(PNG.sync, "read");
    const jpegDecode = vi.spyOn(jpeg, "decode");
    try {
      // A few dozen bytes that claim 30000 x 30000 pixels: 3.6 GB once decoded.
      expect(decodeImage(pngHeader(30000, 30000, 6))).toBeNull();
      expect(decodeImage(jpegHeader(30000, 30000))).toBeNull();
      expect(decodeImage(pngHeader(0, 100, 6))).toBeNull();
      expect(pngRead).not.toHaveBeenCalled();
      expect(jpegDecode).not.toHaveBeenCalled();
      // A real image within the limit still decodes.
      expect(decodeImage(productJpeg(64, 48, { left: 8, top: 8, right: 40, bottom: 40 }))).toMatchObject({ width: 64, height: 48 });
      expect(jpegDecode).toHaveBeenCalledTimes(1);
      expect(decodeImage(PNG.sync.write(new PNG({ width: 4, height: 3 })))).toMatchObject({ width: 4, height: 3 });
      expect(pngRead).toHaveBeenCalledTimes(1);
    } finally {
      pngRead.mockRestore();
      jpegDecode.mockRestore();
    }
    // The same ceiling guards the compositor and SAM's own mask sizes.
    const mask = (await parseSam(SAM_TEXT))[0]!;
    expect(() => composeCutout({ width: 30000, height: 30000, data: new Uint8Array(16) }, mask)).toThrow(/too large/);
    expect(await parseSam("<0f>0<|box;x1=0;y1=0;x2=1;y2=1;w=2;h=2|><|mask;x=0;y=0;data=30000,30000,!!!!!!|>\n")).toEqual([]);
  });

  it("cuts out the best decodable photo and stores the PNG", async () => {
    const jpg = productJpeg(1280, 960, box);
    const web = (async () => imageResponse(jpg, "image/jpeg")) as unknown as typeof fetch;
    const store = memoryMediaStore("https://api.dandelist.test");
    let sentImage = "";
    const segment = async (image: string, noun: string) => {
      sentImage = image;
      expect(noun).toBe("camera");
      return SAM_TEXT;
    };
    const src = cutoutSource([
      { url: "https://93.184.215.14/a.webp", width: 3000, height: 2000, type: "webp" },
      { url: "https://93.184.215.14/q3.jpg", width: 1280, height: 960, type: "jpeg" },
      { url: "https://93.184.215.14/huge.jpg", width: 9000, height: 6000, type: "jpeg" },
    ])!;
    expect(src.url).toBe("https://93.184.215.14/q3.jpg");
    // The smallest photo that still fills a 2048 px cutout beats a bigger download.
    const pick = cutoutSource([
      { url: "https://a/12mp.jpg", width: 4000, height: 3000, type: "jpeg" },
      { url: "https://a/2400.png", width: 2400, height: 1600, type: "png" },
      { url: "https://a/1280.jpg", width: 1280, height: 960, type: "jpeg" },
    ]);
    expect(pick!.url).toBe("https://a/2400.png");
    const cut = await makeCutout(segment, src, "camera", web, store);
    expect(sentImage.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(cut).toMatchObject({ width: 1001, height: 763, from: "https://93.184.215.14/q3.jpg", model: "sam-3.1" });
    expect(cut!.url).toMatch(/^https:\/\/api\.dandelist\.test\/media\/[a-f0-9]{64}\.png$/);
    expect(store.objects.size).toBe(1);
    expect(await makeCutout(async () => "", src, "camera", web, store)).toBeNull();
  });
});
