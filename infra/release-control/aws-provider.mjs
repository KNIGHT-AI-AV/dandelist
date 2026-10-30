import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const services = Object.freeze({
  sts: { client: "STSClient", operations: ["GetCallerIdentity"] },
  codebuild: { client: "CodeBuildClient", operations: ["BatchGetProjects", "BatchGetBuilds", "StartBuild"] },
  ecr: { client: "ECRClient", operations: ["DescribeRepositories", "DescribeImages"] },
  apprunner: { client: "AppRunnerClient", operations: ["DescribeService", "ListOperations", "UpdateService"] },
});
const knownErrors = new Set(["AccessDeniedException", "AccessDenied", "ThrottlingException", "ResourceNotFoundException", "InvalidRequestException", "InvalidInputException", "TimeoutError", "AbortError", "ExpiredTokenException", "UnrecognizedClientException"]);

/** No provisioning commands, logging middleware, retry loop or default credential fallback. */
export function createAwsProvider({ sdk, credentials, region }) {
  if (!credentials || typeof region !== "string" || !/^[a-z]{2}-[a-z]+-\d+$/.test(region)) throw new Error("Existing credentials and an explicit valid region are required");
  const clients = {};
  try {
    for (const [name, definition] of Object.entries(services)) {
      const Client = sdk[name]?.[definition.client];
      if (typeof Client !== "function" || definition.operations.some((op) => typeof sdk[name][`${op}Command`] !== "function")) throw new Error();
      clients[name] = new Client({ credentials, region, maxAttempts: 1 });
    }
  } catch {
    for (const client of Object.values(clients)) client.destroy?.();
    throw new Error("Existing SDK modules could not initialize; no installation or fallback was attempted");
  }
  return Object.freeze({
    async call(service, operation, input) {
      if (!Object.hasOwn(services, service) || !services[service].operations.includes(operation)) throw new Error("Provider operation is not allowed");
      try {
        const command = new sdk[service][`${operation}Command`](structuredClone(input));
        return await clients[service].send(command, { abortSignal: AbortSignal.timeout(60000) });
      } catch (error) {
        const name = knownErrors.has(error?.name) ? error.name : "ProviderError";
        throw new Error(`AWS ${operation} failed (${name}); raw provider details withheld`);
      }
    },
    destroy() { for (const client of Object.values(clients)) client.destroy?.(); },
  });
}

/** Run via an already-installed tsx loader; import only the existing vault-backed provider. */
export async function loadAwsProvider({ sdkRoot, region }) {
  try {
    const root = realpathSync(sdkRoot);
    const require = createRequire(join(root, "infra/aws/package.json"));
    const sdk = Object.fromEntries(Object.keys(services).map((name) => [name, require(`@aws-sdk/client-${name}`)]));
    const existing = await import(pathToFileURL(join(root, "infra/aws/creds.ts")).href);
    if (existing.region !== region || !existing.credentials) throw new Error();
    return createAwsProvider({ sdk, credentials: existing.credentials, region });
  } catch {
    throw new Error("Existing SDK/credential provider failed or region differed; no creation, installation or fallback is permitted");
  }
}
