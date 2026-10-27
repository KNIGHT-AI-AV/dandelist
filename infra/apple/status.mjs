import { asc, teamId } from "./asc.mjs";
console.log("team", teamId);
const ids = await asc("GET", "/v1/bundleIds?filter[identifier]=com.knightaiav.dandelist&limit=5");
console.log("bundle id:", ids.data.map((b) => `${b.id} ${b.attributes.identifier} ${b.attributes.platform}`));
const apps = await asc("GET", "/v1/apps?filter[bundleId]=com.knightaiav.dandelist&limit=5");
console.log("app record:", apps.data.map((a) => `${a.id} ${a.attributes.name}`));
const certs = await asc("GET", "/v1/certificates?limit=50");
console.log("certificates:", certs.data.map((c) => `${c.attributes.certificateType} ${c.attributes.name} exp ${c.attributes.expirationDate?.slice(0, 10)}`));
