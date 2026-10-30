import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * infra/mac/check-signed.py runs on the Mac between signing and the upload (build-ios.sh). These cases prove its STOP
 * fires on what the iPhone build must never ship, and that the build as shipped passes.
 */
const SCRIPT = resolve(__dirname, "../../../infra/mac/check-signed.py");
const PYTHON = process.platform === "win32" ? "python" : "python3";
const dir = mkdtempSync(join(tmpdir(), "mac-check-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Value = string | boolean | string[];
const xml = (v: Value): string =>
  typeof v === "boolean" ? `<${v}/>` : Array.isArray(v) ? `<array>${v.map((s) => `<string>${s}</string>`).join("")}</array>` : `<string>${v}</string>`;
const plist = (name: string, entries: Record<string, Value>) => {
  const path = join(dir, name);
  const body = Object.entries(entries).map(([k, v]) => `<key>${k}</key>${xml(v)}`).join("");
  writeFileSync(path, `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>${body}</dict></plist>`);
  return path;
};

const SHIPPED_ENT = {
  "application-identifier": "9NB97BZDR3.com.knightaiav.dandelist",
  "com.apple.developer.team-identifier": "9NB97BZDR3",
  "get-task-allow": false,
  "keychain-access-groups": ["9NB97BZDR3.com.knightaiav.dandelist"],
  "com.apple.developer.applesignin": ["Default"],
};
const SHIPPED_INFO = {
  CFBundleIdentifier: "com.knightaiav.dandelist",
  NSMicrophoneUsageDescription: "Dandelist listens only while you say a wish, to write it down.",
  NSPhotoLibraryUsageDescription: "Dandelist uses your photo library only when you choose a profile picture.",
};

function check(ent: Record<string, Value>, info: Record<string, Value>) {
  const run = spawnSync(PYTHON, [SCRIPT, plist(`ent-${Math.random()}.plist`, ent), plist(`info-${Math.random()}.plist`, info)], { encoding: "utf8" });
  return { status: run.status, out: run.stdout + run.stderr };
}

describe("the check between signing and the upload", () => {
  it("passes the app as it ships, and prints what it read", () => {
    const { status, out } = check(SHIPPED_ENT, SHIPPED_INFO);
    expect(status).toBe(0);
    expect(out).toContain("com.apple.developer.applesignin");
    expect(out).toContain("NSMicrophoneUsageDescription: Dandelist listens only while you say a wish, to write it down.");
    expect(out).toContain("UIBackgroundModes: none");
    expect(out).not.toContain("STOP");
  });

  it.each([
    ["a push entitlement", { ...SHIPPED_ENT, "aps-environment": "production" }, SHIPPED_INFO, "aps-environment"],
    ["another capability", { ...SHIPPED_ENT, "com.apple.developer.associated-domains": ["applinks:example.com"] }, SHIPPED_INFO, "associated-domains"],
    ["a debuggable build", { ...SHIPPED_ENT, "get-task-allow": true }, SHIPPED_INFO, "get-task-allow"],
    ["no microphone string", SHIPPED_ENT, { CFBundleIdentifier: "com.knightaiav.dandelist" }, "NSMicrophoneUsageDescription"],
    ["background modes", SHIPPED_ENT, { ...SHIPPED_INFO, UIBackgroundModes: ["audio"] }, "background modes"],
  ])("stops before upload on %s", (_name, ent, info, said) => {
    const { status, out } = check(ent, info);
    expect(status).toBe(1);
    expect(out).toMatch(new RegExp(`STOP: .*${said}`));
  });
});
