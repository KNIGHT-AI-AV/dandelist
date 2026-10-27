/**
 * Links api.dandelist.knightaiav.com to the App Runner service and prints the DNS records it needs.
 * Safe to re-run: an existing link is only described. The records go into the knightaiav.com zone by hand.
 */
import { AppRunnerClient, AssociateCustomDomainCommand, DescribeCustomDomainsCommand, ListServicesCommand } from "@aws-sdk/client-apprunner";
import { credentials, region } from "./creds";

const DOMAIN = process.env.API_DOMAIN ?? "api.dandelist.knightaiav.com";
const ar = new AppRunnerClient({ region, credentials });
const service = (await ar.send(new ListServicesCommand({}))).ServiceSummaryList?.find((s) => s.ServiceName === "dandelist-api");
if (!service) throw new Error("Service dandelist-api not found; run deploy first");

let described = await ar.send(new DescribeCustomDomainsCommand({ ServiceArn: service.ServiceArn }));
if (!described.CustomDomains?.some((d) => d.DomainName === DOMAIN)) {
  await ar.send(new AssociateCustomDomainCommand({ ServiceArn: service.ServiceArn, DomainName: DOMAIN, EnableWWWSubdomain: false }));
  console.log(`linked ${DOMAIN}`);
}
// Validation records appear a few seconds after the link is made.
for (let i = 0; i < 12; i++) {
  described = await ar.send(new DescribeCustomDomainsCommand({ ServiceArn: service.ServiceArn }));
  const d = described.CustomDomains?.find((x) => x.DomainName === DOMAIN);
  if (d?.CertificateValidationRecords?.length) break;
  await new Promise((r) => setTimeout(r, 5000));
}
const d = described.CustomDomains!.find((x) => x.DomainName === DOMAIN)!;
console.log(`status: ${d.Status}`);
console.log(`CNAME ${DOMAIN} -> ${described.DNSTarget}`);
for (const r of d.CertificateValidationRecords ?? []) console.log(`${r.Type} ${r.Name} -> ${r.Value} (${r.Status})`);
