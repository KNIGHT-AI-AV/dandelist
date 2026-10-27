/** Lists Wikimedia Commons photos for a subject, largest first, with author and licence. Usage: tsx scripts/commons-probe.ts "<subject>" [minWidth] */
import { commonsPhotos } from "../src/agent/media";

const [subject, min = "2400"] = process.argv.slice(2);
const photos = await commonsPhotos(subject!, fetch, { minWidth: Number(min), limit: 12 });
for (const p of photos) console.log(`${p.width}x${p.height}\t${p.license ?? ""}\t${(p.credit ?? "").slice(0, 40)}\t${p.url}`);
