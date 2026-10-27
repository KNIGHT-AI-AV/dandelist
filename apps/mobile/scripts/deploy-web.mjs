/**
 * Builds the web app against the live API and publishes it to Cloudflare Pages (project "dandelist",
 * served at https://dandelist.knightaiav.com). Needs a wrangler login with Pages access.
 */
import { execSync } from "node:child_process";

const env = { ...process.env, EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL ?? "https://api.dandelist.knightaiav.com" };
const run = (cmd) => execSync(cmd, { stdio: "inherit", env, cwd: new URL("..", import.meta.url) });
run("npx expo export --platform web --clear");
run("npx -y wrangler@4.149.0 pages deploy dist --project-name dandelist --branch main --commit-dirty=true");
