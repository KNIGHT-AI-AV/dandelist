/**
 * Provisions Dandelist's AWS data layer, idempotently: a database password in Secrets Manager, a Postgres
 * instance, and a private S3 bucket for wish media. Safe to re-run; existing resources are left as they are.
 * Paid from the account's AWS Activate credits; sizes are the smallest that do the job.
 */
import {
  AuthorizeSecurityGroupIngressCommand,
  CreateSecurityGroupCommand,
  DescribeSecurityGroupsCommand,
  DescribeSubnetsCommand,
  DescribeVpcsCommand,
  EC2Client,
} from "@aws-sdk/client-ec2";
import { CreateDBInstanceCommand, CreateDBSubnetGroupCommand, DescribeDBInstancesCommand, RDSClient } from "@aws-sdk/client-rds";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketEncryptionCommand,
  PutPublicAccessBlockCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  CreateSecretCommand,
  DescribeSecretCommand,
  GetRandomPasswordCommand,
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { credentials, region } from "./creds";

const ACCOUNT = (await new STSClient({ region, credentials }).send(new GetCallerIdentityCommand({}))).Account!;
const DB_ID = "dandelist-db";
const DB_USER = "dandelist";
const SECRET_ID = "dandelist/db";
const BUCKET = `dandelist-media-${ACCOUNT}`;
const TAGS = [{ Key: "project", Value: "dandelist" }];

const ec2 = new EC2Client({ region, credentials });
const rds = new RDSClient({ region, credentials });
const s3 = new S3Client({ region, credentials });
const sm = new SecretsManagerClient({ region, credentials });

async function exists<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    const name = (e as { name?: string }).name ?? "";
    if (/NotFound|NoSuchBucket|ResourceNotFound|DBInstanceNotFound|NotFound$/.test(name) || (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
    throw e;
  }
}

async function password(): Promise<string> {
  const found = await exists(() => sm.send(new DescribeSecretCommand({ SecretId: SECRET_ID })));
  if (!found) {
    const { RandomPassword } = await sm.send(new GetRandomPasswordCommand({ PasswordLength: 40, ExcludePunctuation: true }));
    await sm.send(new CreateSecretCommand({ Name: SECRET_ID, SecretString: JSON.stringify({ username: DB_USER, password: RandomPassword }), Tags: TAGS }));
    console.log(`created secret ${SECRET_ID}`);
  }
  const { SecretString } = await sm.send(new GetSecretValueCommand({ SecretId: SECRET_ID }));
  return (JSON.parse(SecretString!) as { password: string }).password;
}

async function network(): Promise<{ sgId: string; subnetGroup: string }> {
  const vpc = (await ec2.send(new DescribeVpcsCommand({ Filters: [{ Name: "isDefault", Values: ["true"] }] }))).Vpcs?.[0];
  if (!vpc?.VpcId) throw new Error("No default VPC in us-east-1");
  let sg = (await ec2.send(new DescribeSecurityGroupsCommand({ Filters: [{ Name: "group-name", Values: ["dandelist-db"] }, { Name: "vpc-id", Values: [vpc.VpcId] }] }))).SecurityGroups?.[0];
  if (!sg) {
    const { GroupId } = await ec2.send(new CreateSecurityGroupCommand({ GroupName: "dandelist-db", Description: "Dandelist Postgres, TLS-only", VpcId: vpc.VpcId }));
    // App Runner has no fixed egress IPs without a NAT gateway, so Postgres is reachable publicly; RDS for
    // Postgres 15+ enforces TLS by default and the password is 40 random characters.
    await ec2.send(new AuthorizeSecurityGroupIngressCommand({ GroupId, IpPermissions: [{ IpProtocol: "tcp", FromPort: 5432, ToPort: 5432, IpRanges: [{ CidrIp: "0.0.0.0/0", Description: "Postgres over TLS" }] }] }));
    sg = { GroupId };
    console.log(`created security group ${GroupId}`);
  }
  const subnets = (await ec2.send(new DescribeSubnetsCommand({ Filters: [{ Name: "vpc-id", Values: [vpc.VpcId] }, { Name: "default-for-az", Values: ["true"] }] }))).Subnets ?? [];
  const subnetGroup = "dandelist-db-subnets";
  try {
    await rds.send(new CreateDBSubnetGroupCommand({ DBSubnetGroupName: subnetGroup, DBSubnetGroupDescription: "Dandelist default-VPC subnets", SubnetIds: subnets.map((s) => s.SubnetId!), Tags: TAGS }));
    console.log(`created subnet group across ${subnets.length} subnets`);
  } catch (e) {
    if ((e as { name?: string }).name !== "DBSubnetGroupAlreadyExistsFault") throw e;
  }
  return { sgId: sg.GroupId!, subnetGroup };
}

async function database(pw: string, net: { sgId: string; subnetGroup: string }) {
  const found = await exists(() => rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: DB_ID })));
  if (found?.DBInstances?.[0]) {
    const db = found.DBInstances[0];
    console.log(`database ${DB_ID}: ${db.DBInstanceStatus}${db.Endpoint?.Address ? ` at ${db.Endpoint.Address}` : ""}`);
    return;
  }
  await rds.send(new CreateDBInstanceCommand({
    DBInstanceIdentifier: DB_ID,
    Engine: "postgres",
    EngineVersion: "17",
    DBInstanceClass: "db.t4g.micro",
    AllocatedStorage: 20,
    StorageType: "gp3",
    StorageEncrypted: true,
    DBName: "dandelist",
    MasterUsername: DB_USER,
    MasterUserPassword: pw,
    PubliclyAccessible: true,
    VpcSecurityGroupIds: [net.sgId],
    DBSubnetGroupName: net.subnetGroup,
    BackupRetentionPeriod: 1,
    DeletionProtection: true,
    MultiAZ: false,
    AutoMinorVersionUpgrade: true,
    Tags: TAGS,
  }));
  console.log(`creating database ${DB_ID} (takes about 10 minutes)`);
}

async function bucket() {
  if (await exists(() => s3.send(new HeadBucketCommand({ Bucket: BUCKET })))) {
    console.log(`bucket ${BUCKET} exists`);
    return;
  }
  await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  await s3.send(new PutPublicAccessBlockCommand({ Bucket: BUCKET, PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } }));
  await s3.send(new PutBucketEncryptionCommand({ Bucket: BUCKET, ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }] } }));
  console.log(`created private bucket ${BUCKET}`);
}

const pw = await password();
const net = await network();
await database(pw, net);
await bucket();
