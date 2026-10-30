import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fonts } from "./palette";
import faces from "./web-fonts.json";

const app = join(__dirname, "..");
const repo = join(app, "..", "..");

const ranges = (range: string): [number, number][] =>
  range.split(",").map((part) => {
    const [a, b] = part.trim().slice(2).split("-");
    return [parseInt(a!, 16), parseInt(b ?? a!, 16)];
  });
const within = (point: number, spans: [number, number][]) => spans.some(([a, b]) => point >= a && point <= b);

/** Every character past ASCII in the app's own text, with a file it is in: the places scripts/web-fonts.py reads. */
function textPoints(): Map<number, string> {
  const found = new Map<number, string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (/\.(tsx?|json)$/.test(e.name) && !e.name.includes(".test.") && e.name !== "web-fonts.json") {
        for (const c of readFileSync(path, "utf8")) if (c.codePointAt(0)! > 126 && !found.has(c.codePointAt(0)!)) found.set(c.codePointAt(0)!, path);
      }
    }
  };
  for (const dir of ["app", "components", "lib"]) walk(join(app, dir));
  for (const pkg of ["catalogue", "cost"]) walk(join(repo, "packages", pkg, "src"));
  return found;
}

describe("web fonts cut by script (Lighthouse, 2026-10-30: 724 KB of TTF held the first frame)", () => {
  it("has cuts for every face lib/palette.ts sets", () => {
    for (const family of new Set(Object.values(fonts))) expect(Object.keys(faces)).toContain(family);
  });

  it("serves each cut from public/ under a content-hash name, which deploy-web.mjs caches for a year", () => {
    for (const cuts of Object.values(faces)) {
      for (const cut of cuts) {
        expect(cut.url).toMatch(/^\/assets\/fonts\/[A-Za-z0-9_]+\.(latin|latin-ext|rest)\.[0-9a-f]{32}\.woff2$/);
        expect(existsSync(join(app, "public", cut.url))).toBe(true);
      }
    }
  });

  it("gives each character of a face to one cut only, the Latin one first", () => {
    for (const cuts of Object.values(faces)) {
      expect(cuts[0]!.url).toContain(".latin.");
      const spans = cuts.map((cut) => ranges(cut.range));
      for (let i = 0; i < spans.length; i++) {
        for (let j = i + 1; j < spans.length; j++) {
          for (const [a, b] of spans[i]!) expect(spans[j]!.some(([c, d]) => a <= d && c <= b)).toBe(false);
        }
      }
    }
  });

  it("needs only the Latin cuts for the app's own text (a new character: run scripts/web-fonts.py)", () => {
    const text = textPoints();
    for (const [family, cuts] of Object.entries(faces)) {
      const later = cuts.slice(1).flatMap((cut) => ranges(cut.range));
      for (const [point, file] of text) expect(within(point, later), `${family}: U+${point.toString(16)} (${file})`).toBe(false);
    }
  });
});
