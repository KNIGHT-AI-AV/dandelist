/**
 * Spacing guard (owner, 2026-11-02: "Make sure spacing is smart and million dollar ready!"): every padding, margin and
 * gap written as a number is a step of the scale in lib/palette.ts (`space`): 0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64
 * or 80. Fails on any other literal, so an off-scale 10 or 14 can't creep back in. A value computed from a token, a
 * prop or a measurement is fine; so is lib/palette.ts itself, and the development bench (app/lab.tsx).
 */
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const SCALE = new Set([0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80]);
const root = fileURLToPath(new URL("..", import.meta.url));
const allowed = new Set(["lib/palette.ts", "app/lab.tsx"]);
const NAME = "(?:padding|margin|gap|rowGap|columnGap)(?:Horizontal|Vertical|Top|Bottom|Left|Right|Start|End|Block(?:Start|End)?|Inline(?:Start|End)?)?";
/**
 * A spacing key and what assigns it: a style's `gap:`, a prop's `gap={`, or a parameter's default `{ gap = 4 }`. A
 * plain variable that shares the name (`const margin = 0.05`, a ternary's `? padding : 10`) is not one.
 */
const KEY = new RegExp(`(?<=[{,(]\\s*)${NAME}\\s*=(?![=>])|\\b${NAME}(?::|=\\{)`, "g");
const NUMBER = /\d+(?:\.\d+)?/g;

/** The value a key is given: up to the comma, brace, bracket, semicolon or parenthesis that closes it. */
function valueAt(line, from) {
  let depth = 0;
  for (let i = from; i < line.length; i++) {
    const c = line[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) {
      if (depth === 0) return line.slice(from, i);
      depth--;
    } else if ((c === "," || c === ";") && depth === 0) return line.slice(from, i);
  }
  return line.slice(from);
}

/**
 * The numbers in a value that are the spacing itself: on their own, or a branch of a choice (`compact ? 12 : 16`) or a
 * fallback (`x ?? 16`). A number with arithmetic beside it is a computation, one after a comparison is what a choice
 * tests, and one in a call or an index is an argument, so none of those is read.
 */
function spacingNumbers(raw) {
  // Brackets around the whole value only group it: `(compact ? 12 : 16)` is still the spacing.
  let value = raw.trim();
  if (value.startsWith("(") && closingOf(value, 0) === value.length - 1) value = value.slice(1, -1);
  const depth = depths(value);
  const found = [];
  for (const m of value.matchAll(NUMBER)) {
    if (depth[m.index] > 0 || /[\w.$]/.test(value[m.index - 1] ?? "")) continue;
    let j = m.index - 1;
    while (value[j] === " ") j--;
    if (value[j] === "-") for (j--; value[j] === " "; j--);
    let k = m.index + m[0].length;
    while (value[k] === " ") k++;
    const before = value[j] ?? "", after = value[k] ?? "";
    if (["", "?", ":"].includes(before) && ["", ":"].includes(after)) found.push(Number(m[0]));
  }
  return found;
}

/** How deep in brackets each character of a value sits; a call's arguments and an index sit deeper than the value. */
function depths(value) {
  let d = 0;
  return [...value].map((c) => {
    if ("([{".includes(c)) return d++;
    if (")]}".includes(c)) return --d;
    return d;
  });
}

/** Where the bracket opened at `at` closes, or -1. */
function closingOf(value, at) {
  let d = 0;
  for (let i = at; i < value.length; i++) {
    if ("([{".includes(value[i])) d++;
    else if (")]}".includes(value[i]) && --d === 0) return i;
  }
  return -1;
}

/** The off-scale spacing values in one file's text, as "line: text". */
export function offScale(text) {
  const bad = [];
  text.split("\n").forEach((line, i) => {
    if (/^\s*(\*|\/\*|\/\/)/.test(line)) return;
    const code = line.replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/, "");
    const values = [...code.matchAll(KEY)].flatMap((m) => spacingNumbers(valueAt(code, m.index + m[0].length)));
    if (values.some((n) => !SCALE.has(n))) bad.push(`${i + 1}: ${line.trim().slice(0, 120)}`);
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

/** Run as a script (not imported by a test): compared through the real path, so a linked folder still counts. */
function runAsScript() {
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (process.argv[1] && runAsScript()) {
  const bad = [];
  for (const dir of ["app", "components", "lib"]) walk(join(root, dir), bad);
  if (bad.length) {
    console.error(`Spacing off the scale in lib/palette.ts (use 0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 or 80, or a token):\n${bad.join("\n")}`);
    process.exit(1);
  }
  console.log("spacing scale: every padding, margin and gap literal is a step of the scale");
}
