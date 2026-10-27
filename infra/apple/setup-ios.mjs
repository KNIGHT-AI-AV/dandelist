/**
 * Registers Dandelist's iOS bundle ID (with Sign in with Apple) and makes an App Store provisioning profile
 * signed by the team's existing Apple Distribution certificate. Safe to re-run. The profile is written to
 * ~/.secrets/apple/dandelist/, never into the repo.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { asc } from "./asc.mjs";

const IDENTIFIER = "com.knightaiav.dandelist";
const CERT_B64 = process.env.DIST_CERT_B64_PATH ?? join(homedir(), ".secrets/apple/omni/omni-dist.cer.b64");
const OUT = join(homedir(), ".secrets/apple/dandelist");

let bundle = (await asc("GET", `/v1/bundleIds?filter[identifier]=${IDENTIFIER}`)).data.find((b) => b.attributes.identifier === IDENTIFIER);
if (!bundle) {
  bundle = (await asc("POST", "/v1/bundleIds", { data: { type: "bundleIds", attributes: { identifier: IDENTIFIER, name: "Dandelist", platform: "IOS" } } })).data;
  console.log("created bundle id", bundle.id);
}
const caps = (await asc("GET", `/v1/bundleIds/${bundle.id}/bundleIdCapabilities`)).data.map((c) => c.attributes.capabilityType);
if (!caps.includes("APPLE_ID_AUTH")) {
  await asc("POST", "/v1/bundleIdCapabilities", {
    data: {
      type: "bundleIdCapabilities",
      attributes: { capabilityType: "APPLE_ID_AUTH", settings: [{ key: "APPLE_ID_AUTH_APP_CONSENT", options: [{ key: "PRIMARY_APP_CONSENT" }] }] },
      relationships: { bundleId: { data: { type: "bundleIds", id: bundle.id } } },
    },
  });
  console.log("enabled Sign in with Apple");
}

const wanted = readFileSync(CERT_B64, "utf8").replace(/\s+/g, "");
const certs = (await asc("GET", "/v1/certificates?filter[certificateType]=DISTRIBUTION,IOS_DISTRIBUTION&limit=50")).data;
const cert = certs.find((c) => c.attributes.certificateContent.replace(/\s+/g, "") === wanted);
if (!cert) throw new Error("The local distribution certificate is not on the team any more");
console.log("using certificate", cert.attributes.name, "expires", cert.attributes.expirationDate.slice(0, 10));

const NAME = "Dandelist App Store";
const existing = (await asc("GET", `/v1/profiles?filter[name]=${encodeURIComponent(NAME)}`)).data.filter((p) => p.attributes.profileState === "ACTIVE");
const profile =
  existing[0] ??
  (
    await asc("POST", "/v1/profiles", {
      data: {
        type: "profiles",
        attributes: { name: NAME, profileType: "IOS_APP_STORE" },
        relationships: { bundleId: { data: { type: "bundleIds", id: bundle.id } }, certificates: { data: [{ type: "certificates", id: cert.id }] } },
      },
    })
  ).data;
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "dandelist.mobileprovision"), Buffer.from(profile.attributes.profileContent, "base64"));
console.log("profile", profile.attributes.name, profile.attributes.profileState, "expires", profile.attributes.expirationDate.slice(0, 10), "->", join(OUT, "dandelist.mobileprovision"));
