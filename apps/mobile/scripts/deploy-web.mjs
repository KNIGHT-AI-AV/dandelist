/**
 * Builds the web app against the live API and publishes it to Cloudflare Pages (project "dandelist",
 * served at https://dandelist.knightaiav.com). Needs a wrangler login with Pages access.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const env = { ...process.env, EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL ?? "https://api.dandelist.knightaiav.com" };
const run = (cmd) => execSync(cmd, { stdio: "inherit", env, cwd: new URL("..", import.meta.url) });
run("npx expo export --platform web --clear");

// Paint the page in the person's theme before any script loads, so the first frame is never a white flash.
const BG = { emerald: "#03140D", bordeaux: "#14060A", noir: "#0A0A0B", ivory: "#F5F0E6", delina: "#F6E3E7", sapphire: "#050A18" };
const first = `<meta name="theme-color" content="${BG.emerald}"><style>html,body{background:${BG.emerald}}</style><script>try{var b=${JSON.stringify(BG)}[localStorage.getItem("dandelist.theme")];if(b){document.documentElement.style.background=b;document.querySelector('meta[name=theme-color]').content=b}}catch(e){}</script>`;
const index = new URL("../dist/index.html", import.meta.url);
writeFileSync(index, readFileSync(index, "utf8").replace("<head>", `<head>${first}`));
run("npx -y wrangler@4.149.0 pages deploy dist --project-name dandelist --branch main --commit-dirty=true");
