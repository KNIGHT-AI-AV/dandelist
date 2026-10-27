import { decodeMaskToRaster, parseImageStream, recordsOfKind, type ResponsesEvent } from "@meta-sam/parser";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import type { MediaStore } from "../media-store";
import { imageInfo, type Cutout } from "./media";
import { readCapped, safeGet, type Fetcher } from "./tools";

/**
 * Product cutouts with Meta's SAM 3.1: SAM finds the product in the best real photo and returns its mask, and our
 * code lifts those pixels onto a transparent PNG so the app can float the product on its dark stage.
 */

export const SAM_MODEL = "sam-3.1";
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
/** jpeg-js decodes in plain JavaScript; past about 16 MP it needs more memory than our 0.5 GB instance should spend. */
const MAX_SOURCE_MP = 16;
const MAX_EDGE = 2048;
/** Smaller photos give cutouts too small to float as a hero. */
const MIN_SOURCE_EDGE = 1000;
const MIN_CUTOUT_EDGE = 600;

export interface SamMask {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  raster: Uint8Array;
  confidence?: number;
}

/** Reads SAM's output text (one line of box and mask records for an image) into decoded masks. */
export async function parseSam(text: string): Promise<SamMask[]> {
  if (!text.trim()) return [];
  const lane = { item_id: "sam", output_index: 0, content_index: 0 };
  async function* events(): AsyncIterable<ResponsesEvent> {
    yield { type: "response.output_text.delta", delta: text, ...lane };
    yield { type: "response.output_text.done", text, ...lane };
    yield { type: "response.completed" };
  }
  const result = await parseImageStream(events()).finalResult;
  // A mask's raster is checked against the same pixel ceiling before it is expanded.
  return recordsOfKind(result.records, "mask").filter((r) => decodable(r.mask.width, r.mask.height)).map((r) => ({
    left: r.bounds.left,
    top: r.bounds.top,
    right: r.bounds.right,
    bottom: r.bounds.bottom,
    width: r.mask.width,
    height: r.mask.height,
    raster: decodeMaskToRaster(r.mask),
    ...(r.confidence === undefined ? {} : { confidence: r.confidence }),
  }));
}

const area = (m: SamMask) => m.raster.reduce((n, v) => n + v, 0) * ((m.right - m.left) / m.width) * ((m.bottom - m.top) / m.height);

/** The most confident mask that covers a sensible share of the photo; ties go to the larger. */
export function pickMask(masks: SamMask[], imageWidth: number, imageHeight: number): SamMask | undefined {
  const total = imageWidth * imageHeight;
  return masks
    .filter((m) => (m.confidence ?? 1) >= 0.5 && area(m) >= total * 0.03)
    .sort((a, b) => (b.confidence ?? 1) - (a.confidence ?? 1) || area(b) - area(a))[0];
}

export interface Rgba {
  width: number;
  height: number;
  data: Uint8Array;
}

/** True when an image of this size is safe to hold decoded: positive, and at most MAX_SOURCE_MP megapixels. */
export const decodable = (width: number, height: number) =>
  Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 && width * height <= MAX_SOURCE_MP * 1_000_000;

/**
 * JPEG and PNG only: both have small pure-JS decoders. WebP and others return null and the cutout is skipped.
 * The size comes from the file's header first, and anything over MAX_SOURCE_MP is refused before a byte is decoded,
 * so a small file that claims to be enormous (a decompression bomb) can't exhaust memory. The decoded image must
 * then be exactly the size the header said.
 */
export function decodeImage(bytes: Uint8Array): Rgba | null {
  const info = imageInfo(bytes);
  if (!info || (info.type !== "jpeg" && info.type !== "png") || !decodable(info.width, info.height)) return null;
  try {
    const img =
      info.type === "jpeg"
        ? jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: MAX_SOURCE_MP, maxMemoryUsageInMB: 320 })
        : PNG.sync.read(Buffer.from(bytes));
    if (img.width !== info.width || img.height !== info.height || img.data.length !== info.width * info.height * 4) return null;
    return { width: img.width, height: img.height, data: img.data };
  } catch {
    return null;
  }
}

/**
 * The masked product on transparency: cropped to the mask's box plus a little air, its edge feathered by one pixel,
 * and scaled down (area-averaged, alpha-weighted) so the long edge is at most 2048 px.
 */
export function composeCutout(img: Rgba, mask: SamMask, maxEdge = MAX_EDGE, pad = 0.04): { width: number; height: number; png: Buffer } {
  if (!decodable(img.width, img.height) || img.data.length !== img.width * img.height * 4) throw new Error("Image too large or malformed");
  if (!decodable(mask.width, mask.height) || mask.raster.length !== mask.width * mask.height) throw new Error("Mask too large or malformed");
  const bw = mask.right - mask.left;
  const bh = mask.bottom - mask.top;
  if (!(bw > 0 && bh > 0 && mask.left < img.width && mask.top < img.height && mask.right > 0 && mask.bottom > 0)) throw new Error("Mask outside the image");
  const air = Math.round(Math.max(bw, bh) * pad);
  const x0 = Math.max(0, mask.left - air);
  const y0 = Math.max(0, mask.top - air);
  const x1 = Math.min(img.width, mask.right + air);
  const y1 = Math.min(img.height, mask.bottom + air);
  const cw = x1 - x0;
  const ch = y1 - y0;
  const sx = mask.width / bw;
  const sy = mask.height / bh;
  const inMask = (x: number, y: number) => {
    if (x < mask.left || y < mask.top || x >= mask.right || y >= mask.bottom) return 0;
    const mx = Math.min(mask.width - 1, Math.floor((x - mask.left) * sx));
    const my = Math.min(mask.height - 1, Math.floor((y - mask.top) * sy));
    return mask.raster[my * mask.width + mx]!;
  };
  // Alpha at full resolution with a 3x3 feather, so edges aren't stair-stepped.
  const alpha = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += inMask(x0 + x + dx, y0 + y + dy);
      alpha[y * cw + x] = sum / 9;
    }
  }
  const scale = Math.min(1, maxEdge / Math.max(cw, ch));
  const ow = Math.max(1, Math.round(cw * scale));
  const oh = Math.max(1, Math.round(ch * scale));
  const out = new PNG({ width: ow, height: oh });
  for (let oy = 0; oy < oh; oy++) {
    const ya = Math.floor((oy * ch) / oh);
    const yb = Math.max(ya + 1, Math.floor(((oy + 1) * ch) / oh));
    for (let ox = 0; ox < ow; ox++) {
      const xa = Math.floor((ox * cw) / ow);
      const xb = Math.max(xa + 1, Math.floor(((ox + 1) * cw) / ow));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = ya; y < yb; y++) {
        for (let x = xa; x < xb; x++) {
          const w = alpha[y * cw + x]!;
          const i = ((y0 + y) * img.width + (x0 + x)) * 4;
          r += img.data[i]! * w;
          g += img.data[i + 1]! * w;
          b += img.data[i + 2]! * w;
          a += w;
          n++;
        }
      }
      const o = (oy * ow + ox) * 4;
      if (a > 0) {
        out.data[o] = Math.round(r / a);
        out.data[o + 1] = Math.round(g / a);
        out.data[o + 2] = Math.round(b / a);
      }
      out.data[o + 3] = Math.round((a / n) * 255);
    }
  }
  return { width: ow, height: oh, png: PNG.sync.write(out) };
}

/** Sends one image and a noun phrase to SAM 3.1 and returns its output text. */
export type Segmenter = (imageDataUrl: string, noun: string) => Promise<string>;

export interface CutoutSource {
  url: string;
  width: number;
  height: number;
  type: string;
}

/**
 * Picks the real photo to cut out: JPEG or PNG, small enough to decode. The cutout is at most 2048 px, so the
 * smallest photo that still reaches that wins (less to download, decode and send); failing that, the largest.
 */
export function cutoutSource<T extends CutoutSource>(images: T[]): T | undefined {
  const edge = (i: T) => Math.max(i.width, i.height);
  const ok = images.filter((i) => (i.type === "jpeg" || i.type === "png") && i.width * i.height <= MAX_SOURCE_MP * 1_000_000 && edge(i) >= MIN_SOURCE_EDGE);
  const big = ok.filter((i) => edge(i) >= MAX_EDGE).sort((a, b) => edge(a) - edge(b));
  return big[0] ?? ok.sort((a, b) => edge(b) - edge(a))[0];
}

export async function makeCutout(segment: Segmenter, src: CutoutSource, noun: string, fetcher: Fetcher, store: MediaStore): Promise<Cutout | null> {
  const { res } = await safeGet(src.url, fetcher, { Accept: "image/jpeg,image/png" }, 12000);
  if (!res.ok) return null;
  const { bytes, truncated } = await readCapped(res, MAX_SOURCE_BYTES);
  if (truncated) return null;
  const img = decodeImage(bytes);
  if (!img) return null;
  // SAM gets the very bytes we decode, so its mask lines up with our pixels.
  const mime = bytes[0] === 0x89 ? "image/png" : "image/jpeg";
  const text = await segment(`data:${mime};base64,${bytes.toString("base64")}`, noun);
  const mask = pickMask(await parseSam(text), img.width, img.height);
  if (!mask) return null;
  const cut = composeCutout(img, mask);
  if (Math.max(cut.width, cut.height) < MIN_CUTOUT_EDGE) return null;
  const url = await store.put(cut.png, "image/png");
  return { url, width: cut.width, height: cut.height, from: src.url, model: SAM_MODEL };
}
