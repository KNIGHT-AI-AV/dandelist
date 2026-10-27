/** SAM 3.1 cutout of a local JPEG/PNG (for example a crop made by hand). Usage: tsx scripts/cutout-file.ts <in> <noun> <out.png> */
import { readFile, writeFile } from "node:fs/promises";
import { MetaClient } from "@dandelist/meta";
import { composeCutout, decodeImage, parseSam, pickMask, SAM_MODEL } from "../src/agent/cutout";

const [input, noun, out] = process.argv.slice(2);
const bytes = await readFile(input!);
const img = decodeImage(bytes);
if (!img) throw new Error("couldn't decode");
const meta = new MetaClient({ apiKey: process.env.MODEL_API_KEY! });
const mime = bytes[0] === 0x89 ? "image/png" : "image/jpeg";
const text = (await meta.responses({ model: SAM_MODEL, input: [{ type: "message", role: "user", content: [{ type: "input_text", text: noun! }, { type: "input_image", image_url: `data:${mime};base64,${bytes.toString("base64")}` }] }], metadata: { mask_encoding: "one_bit", include_confidence: "true" } })).text;
const masks = await parseSam(text);
console.log(`${masks.length} masks`);
const mask = pickMask(masks, img.width, img.height);
if (!mask) throw new Error("no mask");
const cut = composeCutout(img, mask);
await writeFile(out!, cut.png);
console.log(`${cut.width}x${cut.height} -> ${out}`);
