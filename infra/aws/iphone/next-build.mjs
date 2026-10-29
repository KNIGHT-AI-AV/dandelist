// The next iPhone build number: one above the highest build App Store Connect has for the app, so a build from
// AWS never collides with an earlier one from anywhere. Needs ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_FILE.
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

const { ASC_KEY_ID: kid, ASC_ISSUER_ID: iss, ASC_KEY_FILE: file, ASC_APP_ID: app = "6827360772" } = process.env;
if (!kid || !iss || !file) throw new Error("ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_FILE are needed");

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const head = b64({ alg: "ES256", kid, typ: "JWT" });
const body = b64({ iss, iat: now, exp: now + 600, aud: "appstoreconnect-v1" });
const sig = createSign("SHA256").update(`${head}.${body}`).sign({ key: readFileSync(file), dsaEncoding: "ieee-p1363" }).toString("base64url");

const res = await fetch(`https://api.appstoreconnect.apple.com/v1/builds?filter[app]=${app}&sort=-uploadedDate&limit=50&fields[builds]=version`, {
  headers: { Authorization: `Bearer ${head}.${body}.${sig}` },
});
if (!res.ok) throw new Error(`App Store Connect answered ${res.status}`);
const versions = ((await res.json()).data ?? []).map((b) => Number(b.attributes?.version)).filter(Number.isFinite);
process.stdout.write(String(Math.max(0, ...versions) + 1));
