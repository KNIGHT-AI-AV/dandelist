import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Clocks that run with useNativeDriver: false, where interpolate() honours `easing`.
const JS_DRIVEN = new Set(["components/welcome/title.tsx"]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [relative(ROOT, path).replace(/\\/g, "/")] : [];
  });
}

describe("easing inside interpolate (iOS audit, 2026-10-29)", () => {
  it("appears only on JS-driven clocks, because the native driver drops it on a phone", () => {
    const files = ["components", "app", "lib"].flatMap((d) => sources(join(ROOT, d)));
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((f) => !JS_DRIVEN.has(f) && /\.interpolate\(\{[^}]*\beasing\b/.test(readFileSync(join(ROOT, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
