import type { SourceConfiguration } from "@aws-sdk/client-apprunner";
// Account selection stays in the operator's private environment, not the public repository.
export const ACCOUNT = process.env.DANDELIST_SANDBOX_AWS_ACCOUNT_ID ?? "";
export const REGION = "us-east-1";
export const SANDBOX = {
  service: "dandelist-api-sandbox", database: "dandelist_sandbox", user: "dandelist_sandbox_app",
  instanceRole: `arn:aws:iam::${ACCOUNT}:role/dandelist-apprunner-sandbox`,
  source: "bfbd681444a83f8aeb1102e9e06fbf1a3564b375",
  secrets: { DATABASE_URL: "dandelist/sandbox/database-url", JWT_SECRET: "dandelist/sandbox/jwt-secret", CODE_PEPPER: "dandelist/sandbox/code-pepper", PLAY_SERVICE_ACCOUNT_JSON: "dandelist/sandbox/play-key" },
} as const;

/** Require the observed funding/notification receipt before any resource mutation. */
export function requireMoneyGate(receipt: any, now = Date.now(), operation: "data" | "build" | "create" | "status" | "pause" = "create"): void {
  // Never prevent shutdown or observation because credits expired or the funding receipt is stale.
  if (operation === "pause" || operation === "status") return;
  const expiry = Date.parse(`${receipt?.activate?.expires}T23:59:59Z`);
  const captured = Date.parse(receipt?.verifiedAt ?? "");
  if (!/^\d{12}$/.test(ACCOUNT) || receipt?.account !== ACCOUNT || receipt?.step0Complete !== true || receipt?.budget?.recipientVerification !== "Verified" ||
      !Number.isFinite(captured) || now - captured > 24 * 3600_000 || captured > now + 60_000 ||
      !Number.isFinite(expiry) || expiry <= now || Number(receipt?.activate?.remainingUsd) < 25 || !Number.isFinite(Number(receipt?.activate?.remainingUsd))) throw new Error("Sandbox funding gate required");
  for (const service of ["AWS App Runner", "Amazon Relational Database Service", "AWS Secrets Manager", "CodeBuild"]) {
    if (!receipt?.activate?.eligibleServices?.includes(service)) throw new Error("Sandbox credit coverage incomplete");
  }
  for (const [type, thresholdUsd] of [["ACTUAL", "1.00"], ["FORECASTED", "5.00"]]) {
    if (!receipt?.budget?.alerts?.some((a: any) => a.type === type && a.thresholdUsd === thresholdUsd)) throw new Error("Sandbox net-cost alerts required");
  }
}

export function sandboxArn(arn: string): string {
  if (!new RegExp(`^arn:aws:apprunner:${REGION}:${ACCOUNT}:service/${SANDBOX.service}/[a-f0-9]{32}$`).test(arn)) throw new Error("Refusing non-sandbox service");
  return arn;
}

export function sandboxDatabaseUrl(value: string, host: string, port: number): URL {
  const url = new URL(value);
  if (url.protocol !== "postgres:" || url.hostname !== host || url.port !== String(port) ||
      decodeURIComponent(url.username) !== SANDBOX.user || url.pathname !== `/${SANDBOX.database}` ||
      url.search || url.hash || !/^[a-f0-9]{64}$/.test(decodeURIComponent(url.password))) throw new Error("Refusing foreign sandbox database URL");
  return url;
}

export function sandboxSource(image: string, refs: Record<string, string>): SourceConfiguration {
  if (!new RegExp(`^${ACCOUNT}\\.dkr\\.ecr\\.${REGION}\\.amazonaws\\.com/dandelist-api@sha256:[a-f0-9]{64}$`).test(image)) throw new Error("Pinned account-local image digest required");
  for (const [key, arn] of Object.entries(refs)) {
    const name = SANDBOX.secrets[key as keyof typeof SANDBOX.secrets];
    if (!name || !new RegExp(`^arn:aws:secretsmanager:${REGION}:${ACCOUNT}:secret:${name}-[A-Za-z0-9]{6}$`).test(arn)) throw new Error("Refusing non-sandbox secret");
  }
  if (!["DATABASE_URL", "JWT_SECRET", "CODE_PEPPER"].every(key => refs[key])) throw new Error("Sandbox secrets incomplete");
  return {
    AutoDeploymentsEnabled: false,
    AuthenticationConfiguration: { AccessRoleArn: `arn:aws:iam::${ACCOUNT}:role/dandelist-apprunner-ecr` },
    ImageRepository: {
      ImageIdentifier: image, ImageRepositoryType: "ECR",
      ImageConfiguration: {
        Port: "8080", RuntimeEnvironmentSecrets: refs,
        RuntimeEnvironmentVariables: { NODE_ENV: "staging", BILLING_SANDBOX_ENABLED: "1", APPLE_BUNDLE_ID: "com.knightaiav.dandelist", WEB_ORIGINS: "http://localhost:8081" },
      },
    },
  };
}
