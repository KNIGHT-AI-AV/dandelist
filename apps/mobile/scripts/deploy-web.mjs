/**
 * Builds the web app against the live API and publishes it to Cloudflare Pages (project "dandelist",
 * served at https://dandelist.knightaiav.com). Needs a wrangler login with Pages access.
 */
import { execSync } from "node:child_process";
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const env = { ...process.env, EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL ?? "https://api.dandelist.knightaiav.com" };
const run = (cmd) => execSync(cmd, { stdio: "inherit", env, cwd: new URL("..", import.meta.url) });
run("npx expo export --platform web --clear");

// Paint the page in the person's theme before any script loads, so the first frame is never a white flash.
const BG = { emerald: "#03140D", bordeaux: "#14060A", noir: "#0A0A0B", ivory: "#F5F0E6", delina: "#F6E3E7", sapphire: "#050A18" };
const first = `<meta name="theme-color" content="${BG.emerald}"><style>html,body{background:${BG.emerald}}</style><script>try{var b=${JSON.stringify(BG)}[localStorage.getItem("dandelist.theme")];if(b){document.documentElement.style.background=b;document.querySelector('meta[name=theme-color]').content=b}}catch(e){}</script>`;
// The app icon for "Add to Home Screen" on iPhone.
copyFileSync(new URL("../assets/apple-touch-icon.png", import.meta.url), new URL("../dist/apple-touch-icon.png", import.meta.url));
const touch = `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`;
// What search results and link previews show (passed aitextclean.com, 2026-10-29).
const description = `<meta name="description" content="List the things you want. An AI agent looks up their real prices, and Dandelist shows what they cost and what it takes to keep them.">`;
// Open the API's connections while the bundle loads (Lighthouse: about 410 ms on a phone). Fetches use the anonymous
// CORS pool and photos the plain one, so both get a preconnect.
const api = env.EXPO_PUBLIC_API_URL;
const preconnect = `<link rel="preconnect" href="${api}" crossorigin><link rel="preconnect" href="${api}">`;
const index = new URL("../dist/index.html", import.meta.url);
writeFileSync(index, readFileSync(index, "utf8").replace("<head>", `<head>${first}${touch}${description}${preconnect}`));
// A real robots file: without one, /robots.txt answered with the app's page.
writeFileSync(new URL("../dist/robots.txt", import.meta.url), "User-agent: *\nAllow: /\n");
// Files under these paths are named by their content hash, so browsers may keep them for a year. Any file without a
// hash there would be cached stale for that long, so stop instead.
const HASHED = /[.-][0-9a-f]{32}(@\dx)?\.[A-Za-z0-9]+$/;
const IMMUTABLE = ["assets", "_expo/static"];
for (const dir of IMMUTABLE) {
  const loose = readdirSync(new URL(`../dist/${dir}`, import.meta.url), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && !HASHED.test(e.name))
    .map((e) => e.name);
  if (loose.length) throw new Error(`dist/${dir} has files without a content hash: ${loose.slice(0, 5).join(", ")}`);
}
writeFileSync(
  new URL("../dist/_headers", import.meta.url),
  IMMUTABLE.map((dir) => `/${dir}/*\n  Cache-Control: public, max-age=31536000, immutable\n`).join(""),
);
run("npx -y wrangler@4.149.0 pages deploy dist --project-name dandelist --branch main --commit-dirty=true");
