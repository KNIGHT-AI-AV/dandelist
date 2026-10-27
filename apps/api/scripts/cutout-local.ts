/** Cuts a product out of a photo with SAM 3.1, the same way the agent does, and writes the PNG. Usage: tsx scripts/cutout-local.ts <imageUrl> <noun> <out.png> */
import { writeFile } from "node:fs/promises";
import { MetaClient } from "@dandelist/meta";
import { makeCutout, SAM_MODEL, type Segmenter } from "../src/agent/cutout";
import { probeImage } from "../src/agent/media";
import { publicFetch } from "../src/agent/tools";
import { memoryMediaStore } from "../src/media-store";

const [url, noun, out] = process.argv.slice(2);
const meta = new MetaClient({ apiKey: process.env.MODEL_API_KEY! });
const segment: Segmenter = async (image, n) =>
  (await meta.responses({ model: SAM_MODEL, input: [{ type: "message", role: "user", content: [{ type: "input_text", text: n }, { type: "input_image", image_url: image }] }], metadata: { mask_encoding: "one_bit", include_confidence: "true" } })).text;
const probed = await probeImage(url!, publicFetch);
if (!probed) throw new Error("couldn't read the image");
const store = memoryMediaStore("https://local");
const cut = await makeCutout(segment, { url: url!, width: probed.width, height: probed.height, type: probed.type }, noun!, publicFetch, store);
if (!cut) throw new Error("no cutout");
await writeFile(out!, store.objects.values().next().value!);
console.log(`${cut.width}x${cut.height} -> ${out}`);
