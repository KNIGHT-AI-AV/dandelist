/**
 * Spacing guard (owner, 2026-11-02: "Make sure spacing is smart and million dollar ready!"): every padding, margin and
 * gap written as a number is a step of the scale in lib/palette.ts (`space`): 0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64
 * or 80. Fails on any other literal, so an off-scale 10 or 14 can't creep back in. A value computed from a token, a
 * prop or a measurement is fine; so is lib/palette.ts itself, and the development bench (app/lab.tsx).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const SCALE = new Set([0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80]);
const root = fileURLToPath(new URL("..", import.meta.url));
const allowed = new Set(["lib/palette.ts", "app/lab.tsx"]);
const LITERAL = /\b(?:padding|margin|gap|rowGap|columnGap)(?:Horizontal|Vertical|Top|Bottom|Left|Right|Start|End)?:\s*(-?\d+(?:\.\d+)?)\b(?!\s*[*/+-])/g;

/** The off-scale spacing literals in one file's text, as "line: text". */
export function offScale(text) {
  const bad = [];
  text.split("\n").forEach((line, i) => {
    if ([...line.matchAll(LITERAL)].some((m) => !SCALE.has(Math.abs(Number(m[1]))))) bad.push(`${i + 1}: ${line.trim().slice(0, 120)}`);
  });
  return bad;
}

function walk(dir, bad) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, bad);
    else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name)) {
      const rel = relative(root, path).replaceAll("\\", "/");
      if (allowed.has(rel)) continue;
      for (const b of offScale(readFileSync(path, "utf8"))) bad.push(`${rel}:${b}`);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const bad = [];
  for (const dir of ["app", "components", "lib"]) walk(join(root, dir), bad);
  if (bad.length) {
    console.error(`Spacing off the scale in lib/palette.ts (use 0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 or 80, or a token):\n${bad.join("\n")}`);
    process.exit(1);
  }
  console.log("spacing scale: every padding, margin and gap literal is a step of the scale");
}
