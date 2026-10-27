/** Lists a page's images, probed for real size, largest first. Usage: tsx scripts/page-images.ts <url> */
import { probeImage, upsizedVariants } from "../src/agent/media";
import { getPage, publicFetch } from "../src/agent/tools";

const page = await getPage(process.argv[2]!, publicFetch);
console.error(`page ${page.status} ${page.images.length} images`);
const seen = new Set<string>();
const out: { url: string; w: number; h: number }[] = [];
for (const raw of page.images.slice(0, 14)) {
  for (const u of [...upsizedVariants(raw), raw].slice(0, 3)) {
    if (seen.has(u)) continue;
    seen.add(u);
    const p = await probeImage(u, publicFetch).catch(() => null);
    if (p) out.push({ url: u, w: p.width, h: p.height });
  }
}
for (const r of out.sort((a, b) => b.w - a.w)) console.log(`${r.w}x${r.h}\t\t\t${r.url}`);
