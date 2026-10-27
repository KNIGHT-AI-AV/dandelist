/**
 * Type-scale guard (UI audit P1-11): screens use the eleven type roles from lib/palette.ts, never a raw font size.
 * Fails on any `fontSize: <number>` outside lib/palette.ts. A size computed from a role or a prop is fine.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const allowed = new Set(["lib/palette.ts"]);
const bad = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name)) {
      const rel = relative(root, path).replaceAll("\\", "/");
      if (allowed.has(rel)) continue;
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((line, i) => /fontSize:\s*-?\d/.test(line) && bad.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`));
    }
  }
}

for (const dir of ["app", "components", "lib"]) walk(join(root, dir));
if (bad.length) {
  console.error(`Raw font sizes outside lib/palette.ts (use a type role):\n${bad.join("\n")}`);
  process.exit(1);
}
console.log("type scale: no raw font sizes outside lib/palette.ts");
