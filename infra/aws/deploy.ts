/**
 * Builds the API image in CodeBuild from the public repo, then creates or updates the App Runner service that runs it.
 * Secrets go into Secrets Manager once (values come from the local vault or are generated there) and reach the
 * service as references, so no secret value is printed or stored in the repo. Safe to re-run; each run deploys
 * the current main branch. Needs the roles from admin-setup.sh.
 */
import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import {
  AppRunnerClient,
  CreateServiceCommand,
  DescribeServiceCommand,
  ListServicesCommand,
  StartDeploymentCommand,
  UpdateServiceCommand,
  type SourceConfiguration,
} from "@aws-sdk/client-apprunner";
import { BatchGetBuildsCommand, BatchGetProjectsCommand, CodeBuildClient, CreateProjectCommand, StartBuildCommand, UpdateProjectCommand, type CreateProjectCommandInput } from "@aws-sdk/client-codebuild";
import { GetLogEventsCommand, CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { CreateRepositoryCommand, DescribeRepositoriesCommand, ECRClient } from "@aws-sdk/client-ecr";
import { DescribeDBInstancesCommand, RDSClient } from "@aws-sdk/client-rds";
import { CreateSecretCommand, DescribeSecretCommand, GetRandomPasswordCommand, GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { credentials, region } from "./creds";

const REPO = "dandelist-api";
const PROJECT = "dandelist-api-image";
const SERVICE = "dandelist-api";
const SOURCE = "https://github.com/KNIGHT-AI-AV/dandelist.git";
const VAULT = "C:/Users/Copper Mile/KNIGHT AI+AV/knight-aiav-backend/tools/vault-get.mjs";
const TAGS = [{ Key: "project", Value: "dandelist" }];

const ACCOUNT = (await new STSClient({ region, credentials }).send(new GetCallerIdentityCommand({}))).Account!;
const role = (name: string) => `arn:aws:iam::${ACCOUNT}:role/${name}`;
const sm = new SecretsManagerClient({ region, credentials });
const ecr = new ECRClient({ region, credentials });
const cb = new CodeBuildClient({ region, credentials });
const ar = new AppRunnerClient({ region, credentials });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const vault = (entry: string) => execFileSync("node", [VAULT, entry], { encoding: "utf8" }).trim();

/** Returns the secret's ARN, creating it from `value()` only when it doesn't exist yet. */
async function secret(name: string, value: () => Promise<string>): Promise<string> {
  try {
    return (await sm.send(new DescribeSecretCommand({ SecretId: name }))).ARN!;
  } catch (e) {
    if ((e as { name?: string }).name !== "ResourceNotFoundException") throw e;
  }
  const arn = (await sm.send(new CreateSecretCommand({ Name: name, SecretString: await value(), Tags: TAGS }))).ARN!;
  console.log(`created secret ${name}`);
  return arn;
}

const random = async (length: number) =>
  (await sm.send(new GetRandomPasswordCommand({ PasswordLength: length, ExcludePunctuation: true }))).RandomPassword!;

async function databaseUrl(): Promise<string> {
  const db = (await new RDSClient({ region, credentials }).send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "dandelist-db" }))).DBInstances![0]!;
  const { username, password } = JSON.parse((await sm.send(new GetSecretValueCommand({ SecretId: "dandelist/db" }))).SecretString!) as { username: string; password: string };
  return `postgres://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${db.Endpoint!.Address}:${db.Endpoint!.Port ?? 5432}/dandelist`;
}

const secrets = {
  DATABASE_URL: await secret("dandelist/api/database-url", databaseUrl),
  JWT_SECRET: await secret("dandelist/api/jwt-secret", () => random(64)),
  CODE_PEPPER: await secret("dandelist/api/code-pepper", () => random(32)),
  JUDGE_CODE: await secret("dandelist/api/judge-code", async () => String(randomInt(100000, 1000000))),
  RESEND_API_KEY: await secret("dandelist/api/resend-key", async () => vault("accounting/resend-api-key")),
  MODEL_API_KEY: await secret("dandelist/api/model-key", async () => vault("accounting/meta-model-api")),
};

// Image repository
let repoUri: string;
try {
  repoUri = (await ecr.send(new DescribeRepositoriesCommand({ repositoryNames: [REPO] }))).repositories![0]!.repositoryUri!;
} catch (e) {
  if ((e as { name?: string }).name !== "RepositoryNotFoundException") throw e;
  repoUri = (await ecr.send(new CreateRepositoryCommand({ repositoryName: REPO, imageScanningConfiguration: { scanOnPush: true }, tags: TAGS }))).repository!.repositoryUri!;
  console.log(`created image repository ${REPO}`);
}

// Build project: public source, so CodeBuild needs no GitHub credentials.
const project: CreateProjectCommandInput = {
  name: PROJECT,
  source: { type: "GITHUB", location: SOURCE, buildspec: "infra/aws/buildspec.yml", gitCloneDepth: 1 },
  artifacts: { type: "NO_ARTIFACTS" },
  environment: {
    type: "LINUX_CONTAINER",
    image: "aws/codebuild/amazonlinux-x86_64-standard:5.0",
    computeType: "BUILD_GENERAL1_SMALL",
    privilegedMode: true,
    environmentVariables: [{ name: "REPO_URI", value: repoUri }],
  },
  serviceRole: role("dandelist-codebuild"),
  timeoutInMinutes: 20,
  tags: TAGS.map((t) => ({ key: t.Key, value: t.Value })),
};
const exists = (await cb.send(new BatchGetProjectsCommand({ names: [PROJECT] }))).projects?.length;
if (exists) await cb.send(new UpdateProjectCommand(project));
else await cb.send(new CreateProjectCommand(project));
if (!exists) console.log(`created build project ${PROJECT}`);

// SKIP_BUILD=1 redeploys the image already in ECR, for retries after a failure past this point.
if (!process.env.SKIP_BUILD) {
  const buildId = (await cb.send(new StartBuildCommand({ projectName: PROJECT, sourceVersion: "main" }))).build!.id!;
  console.log(`building image (${buildId.split(":")[1]})`);
  let build;
  for (;;) {
    await sleep(15_000);
    build = (await cb.send(new BatchGetBuildsCommand({ ids: [buildId] }))).builds![0]!;
    if (build.buildStatus !== "IN_PROGRESS") break;
    console.log(`  ${build.currentPhase?.toLowerCase()}`);
  }
  if (build.buildStatus !== "SUCCEEDED") {
    const { groupName, streamName } = build.logs ?? {};
    if (groupName && streamName) {
      const events = (await new CloudWatchLogsClient({ region, credentials }).send(new GetLogEventsCommand({ logGroupName: groupName, logStreamName: streamName, startFromHead: false, limit: 40 }))).events ?? [];
      console.log(events.map((e) => e.message?.trimEnd()).join("\n"));
    }
    throw new Error(`image build ${build.buildStatus}`);
  }
  console.log(`image pushed: ${repoUri}:latest`);
}

// Service
const source: SourceConfiguration = {
  ImageRepository: {
    ImageIdentifier: `${repoUri}:latest`,
    ImageRepositoryType: "ECR",
    ImageConfiguration: {
      Port: "8080",
      RuntimeEnvironmentVariables: {
        NODE_ENV: "production",
        JUDGE_EMAIL: "judge@dandelist.com",
        WEB_ORIGINS: "https://dandelist.com,https://www.dandelist.com,https://dandelist.pages.dev,http://localhost:8081",
        SPEND_DAILY_USD: "10",
        SPEND_TOTAL_USD: "120",
      },
      RuntimeEnvironmentSecrets: secrets,
    },
  },
  AuthenticationConfiguration: { AccessRoleArn: role("dandelist-apprunner-ecr") },
  AutoDeploymentsEnabled: false,
};
const instance = { Cpu: "0.25 vCPU", Memory: "0.5 GB", InstanceRoleArn: role("dandelist-apprunner-instance") };
const health = { Protocol: "HTTP" as const, Path: "/healthz", Interval: 10, Timeout: 5, HealthyThreshold: 1, UnhealthyThreshold: 5 };

const existing = (await ar.send(new ListServicesCommand({}))).ServiceSummaryList?.find((s) => s.ServiceName === SERVICE);
let arn: string;
if (!existing) {
  arn = (await ar.send(new CreateServiceCommand({ ServiceName: SERVICE, SourceConfiguration: source, InstanceConfiguration: instance, HealthCheckConfiguration: health, Tags: TAGS }))).Service!.ServiceArn!;
  console.log(`creating service ${SERVICE}`);
} else {
  arn = existing.ServiceArn!;
  await ar.send(new UpdateServiceCommand({ ServiceArn: arn, SourceConfiguration: source, InstanceConfiguration: instance, HealthCheckConfiguration: health }));
  console.log(`updating service ${SERVICE}`);
}

let redeployed = !existing;
for (;;) {
  await sleep(15_000);
  const s = (await ar.send(new DescribeServiceCommand({ ServiceArn: arn }))).Service!;
  if (s.Status === "OPERATION_IN_PROGRESS") continue;
  if (s.Status !== "RUNNING") throw new Error(`service is ${s.Status}; check its logs in the App Runner console`);
  if (!redeployed) {
    // UpdateService only restarts when the configuration changed; this makes sure the new :latest image is live.
    await ar.send(new StartDeploymentCommand({ ServiceArn: arn }));
    redeployed = true;
    console.log("deploying the new image");
    continue;
  }
  console.log(`live: https://${s.ServiceUrl}`);
  break;
}
