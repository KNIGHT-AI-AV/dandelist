/**
 * iPhone builds on AWS instead of Expo's build service, so there is no monthly build limit (owner, 2026-10-29: "we
 * don't want to live a life where we hit limits"). CodeBuild reserves an Apple M2 Mac (fleet dandelist-mac, macOS 15
 * with Xcode 26), builds GitHub main with infra/aws/iphone/build.sh and uploads to TestFlight.
 *
 *   pnpm --filter @dandelist/infra-aws run ios:secrets      once: the signing files from this PC go to Secrets Manager
 *   pnpm --filter @dandelist/infra-aws run ios:build        reserves the Mac if none is held; once it is ready, starts a build
 *   pnpm --filter @dandelist/infra-aws run ios:status <id>  that build's progress, then the end of its log
 *   pnpm --filter @dandelist/infra-aws run ios:release      gives the Mac back
 *
 * Every call returns in seconds and nothing waits on this PC: run ios:build again while the Mac is still starting
 * (about ten minutes the first time), then ios:status until the build is done (about half an hour).
 *
 * The Mac costs $0.02 a minute ($28.80 a day) from the moment it is reserved, and AWS bills every reservation for at
 * least 24 hours, so keep it for a day of builds and release it after. Push before building: CodeBuild clones GitHub.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CloudWatchLogsClient, GetLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import {
  BatchGetBuildsCommand,
  BatchGetFleetsCommand,
  BatchGetProjectsCommand,
  CodeBuildClient,
  CreateFleetCommand,
  CreateProjectCommand,
  DeleteFleetCommand,
  ListFleetsCommand,
  StartBuildCommand,
  UpdateProjectCommand,
  type CreateProjectCommandInput,
} from "@aws-sdk/client-codebuild";
import { CreateSecretCommand, DescribeSecretCommand, PutSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { credentials, region } from "./creds";

const FLEET = "dandelist-mac";
const PROJECT = "dandelist-ios";
// Outside dandelist/*, which the live API's role may read: only the iPhone build role reads this one.
const SECRET = "dandelist-ios/signing";
const SOURCE = "https://github.com/KNIGHT-AI-AV/dandelist.git";
const IMAGE = "aws/codebuild/macos-arm-base:15";
const TAGS = [{ key: "project", value: "dandelist" }];

const cb = new CodeBuildClient({ region, credentials });
const sm = new SecretsManagerClient({ region, credentials });
const mode = process.argv[2] ?? "build";

/** The signing files on this PC (gitignored) and the App Store Connect key, as one JSON secret. Never printed. */
async function putSecrets() {
  const mobile = join(import.meta.dirname, "../../apps/mobile");
  const creds = JSON.parse(readFileSync(join(mobile, "credentials.json"), "utf8")).ios;
  const env = Object.fromEntries(
    readFileSync(join(homedir(), ".secrets/apple/asc-drec.env"), "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
  );
  const value = JSON.stringify({
    p12: readFileSync(join(mobile, creds.distributionCertificate.path)).toString("base64"),
    p12Password: creds.distributionCertificate.password,
    profile: readFileSync(join(mobile, creds.provisioningProfilePath)).toString("base64"),
    ascKeyId: env.ASC_KEY_ID,
    ascIssuerId: env.ASC_ISSUER_ID,
    ascKeyP8: readFileSync(env.ASC_KEY_PATH.replace(/^~/, homedir()), "utf8"),
  });
  try {
    await sm.send(new DescribeSecretCommand({ SecretId: SECRET }));
    await sm.send(new PutSecretValueCommand({ SecretId: SECRET, SecretString: value }));
    console.log(`updated ${SECRET}`);
  } catch (e) {
    if ((e as { name?: string }).name !== "ResourceNotFoundException") throw e;
    await sm.send(new CreateSecretCommand({ Name: SECRET, SecretString: value, Tags: [{ Key: "project", Value: "dandelist" }] }));
    console.log(`created ${SECRET}`);
  }
}

async function heldFleet() {
  const arns = (await cb.send(new ListFleetsCommand({}))).fleets ?? [];
  const fleets = arns.length ? ((await cb.send(new BatchGetFleetsCommand({ names: arns }))).fleets ?? []) : [];
  return fleets.find((f) => f.name === FLEET);
}

/** The Mac fleet: the one held, else one reserved now. */
async function mac() {
  const held = await heldFleet();
  if (held) return held;
  const f = (
    await cb.send(new CreateFleetCommand({ name: FLEET, baseCapacity: 1, environmentType: "MAC_ARM", computeType: "BUILD_GENERAL1_MEDIUM", overflowBehavior: "QUEUE", tags: TAGS }))
  ).fleet!;
  console.log(`reserved the Mac at ${new Date().toISOString()} (billed for at least 24 hours from now)`);
  return f;
}

/** Starts a build of main once the Mac can take it; while the Mac is still starting, says so and returns. */
async function build() {
  const f = await mac();
  const status = f.status?.statusCode;
  if (status === "CREATE_FAILED" || status === "UPDATE_ROLLBACK_FAILED") throw new Error(`the Mac fleet is ${status}: ${f.status?.message ?? ""}`);
  if (status !== "ACTIVE") return console.log(`the Mac is ${status?.toLowerCase() ?? "starting"}: run ios:build again in a few minutes`);
  const account = (await new STSClient({ region, credentials }).send(new GetCallerIdentityCommand({}))).Account!;
  const fleetArn = f.arn!;
  const project: CreateProjectCommandInput = {
    name: PROJECT,
    source: { type: "GITHUB", location: SOURCE, buildspec: "infra/aws/iphone/buildspec.yml", gitCloneDepth: 1 },
    artifacts: { type: "NO_ARTIFACTS" },
    environment: { type: "MAC_ARM", image: IMAGE, computeType: "BUILD_GENERAL1_MEDIUM", fleet: { fleetArn } },
    serviceRole: `arn:aws:iam::${account}:role/dandelist-ios-build`,
    timeoutInMinutes: 120,
    tags: TAGS,
  };
  const exists = (await cb.send(new BatchGetProjectsCommand({ names: [PROJECT] }))).projects?.length;
  await cb.send(exists ? new UpdateProjectCommand(project) : new CreateProjectCommand(project));

  // Only main, never another branch or a pull request: the build reads the signing secret, and the repo is public.
  const id = (await cb.send(new StartBuildCommand({ projectName: PROJECT, sourceVersion: "main" }))).build!.id!;
  console.log(`building main on the Mac: ios:status ${id.split(":")[1]}`);
}

/** One build's progress, and the end of its log once it is done. */
async function status(build: string | undefined) {
  if (!build) throw new Error("ios:status needs the build id that ios:build printed");
  const id = build.includes(":") ? build : `${PROJECT}:${build}`;
  const b = (await cb.send(new BatchGetBuildsCommand({ ids: [id] }))).builds?.[0];
  if (!b) throw new Error(`no build ${id}`);
  if (b.buildStatus === "IN_PROGRESS") return console.log(`${b.currentPhase?.toLowerCase()} (started ${b.startTime?.toISOString()})`);
  const { groupName, streamName } = b.logs ?? {};
  const lines = groupName && streamName ? ((await new CloudWatchLogsClient({ region, credentials }).send(new GetLogEventsCommand({ logGroupName: groupName, logStreamName: streamName, startFromHead: false, limit: 60 }))).events ?? []) : [];
  console.log(lines.map((e) => e.message?.trimEnd()).join("\n"));
  if (b.buildStatus !== "SUCCEEDED") throw new Error(`iPhone build ${b.buildStatus}`);
  console.log("done: the build is on its way to TestFlight");
}

async function release() {
  const f = await heldFleet();
  if (!f) return console.log("no Mac is held");
  await cb.send(new DeleteFleetCommand({ arn: f.arn! }));
  console.log(`released the Mac (held since ${f.created?.toISOString()})`);
}

if (mode === "secrets") await putSecrets();
else if (mode === "release") await release();
else if (mode === "status") await status(process.argv[3]);
else await build();
