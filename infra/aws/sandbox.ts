/** Isolated sandbox operations. Never imports deploy.ts/up.ts or writes the production release journal. */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { AppRunnerClient, CreateAutoScalingConfigurationCommand, CreateServiceCommand, DescribeServiceCommand, ListServicesCommand, PauseServiceCommand } from "@aws-sdk/client-apprunner";
import { BatchGetBuildsCommand, CodeBuildClient, StartBuildCommand } from "@aws-sdk/client-codebuild";
import { DescribeImagesCommand, ECRClient } from "@aws-sdk/client-ecr";
import { DescribeDBInstancesCommand, RDSClient } from "@aws-sdk/client-rds";
import { CreateSecretCommand, DescribeSecretCommand, GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { pgDb, migrate } from "../../apps/api/src/db";
import { ACCOUNT, REGION, SANDBOX, requireMoneyGate, sandboxArn, sandboxDatabaseUrl, sandboxSource } from "./sandbox-config";

const usage = "sandbox.ts <data|build|create|status|pause> --receipt <output.json> [--gate <verified-receipt.json> (required for data/build/create)] [--image <pinned-image-digest>]";
const args = process.argv.slice(2), command = args.shift();
const options: Record<string,string> = {};
while(args.length) {
  const key=args.shift()!, value=args.shift();
  if(!["--gate","--receipt","--image"].includes(key)||!value||options[key]) throw new Error(usage);
  options[key]=value;
}
if(!command||!["data","build","create","status","pause"].includes(command)||!options["--receipt"]) throw new Error(usage);
if(command!=="status"&&command!=="pause") {
  if(!options["--gate"])throw new Error(usage);
  requireMoneyGate(JSON.parse(readFileSync(options["--gate"],"utf8")));
}
const receiptPath=options["--receipt"]!;
let stage="identity";
const receipt: Record<string,unknown>={command,startedAt:new Date().toISOString(),account:ACCOUNT,region:REGION,productionChanged:false};
const save=()=>writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+"\n");
const wait=()=>new Promise(resolve=>setTimeout(resolve,15_000));
const repo=`${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/dandelist-api`;
const tags=[{Key:"project",Value:"dandelist"},{Key:"environment",Value:"sandbox"}];

async function run() {
  const {credentials,region}=await import("./creds");
  if(!/^\d{12}$/.test(ACCOUNT))throw new Error("Explicit sandbox AWS account selection required");
  if(region!==REGION)throw new Error("Wrong region");
  if((await new STSClient({credentials,region}).send(new GetCallerIdentityCommand({}))).Account!==ACCOUNT)throw new Error("Wrong account");
  const sm=new SecretsManagerClient({credentials,region}),ar=new AppRunnerClient({credentials,region});
  async function secretArn(name:string):Promise<string|undefined>{
    try { const s=await sm.send(new DescribeSecretCommand({SecretId:name})); if(s.DeletedDate)throw new Error("Sandbox secret scheduled for deletion"); return s.ARN; }
    catch(e){if((e as {name?:string}).name==="ResourceNotFoundException")return undefined;throw e;}
  }
  async function ensureSecret(name:string,value:()=>Promise<string>):Promise<string>{
    const found=await secretArn(name); if(found)return found;
    return (await sm.send(new CreateSecretCommand({Name:name,SecretString:await value(),Tags:tags}))).ARN!;
  }
  async function ownService(){
    let NextToken:string|undefined;
    do { const page=await ar.send(new ListServicesCommand({NextToken}));
      const found=page.ServiceSummaryList?.find(s=>s.ServiceName===SANDBOX.service);
      if(found)return (await ar.send(new DescribeServiceCommand({ServiceArn:sandboxArn(found.ServiceArn!)}))).Service!;
      NextToken=page.NextToken;
    }while(NextToken);
    return undefined;
  }
  async function pause(arn:string){
    for(let i=0;i<60;i++){
      const s=(await ar.send(new DescribeServiceCommand({ServiceArn:sandboxArn(arn)}))).Service!;
      receipt.status=s.Status;save();
      if(s.Status==="PAUSED")return;
      if(s.Status==="RUNNING"){await ar.send(new PauseServiceCommand({ServiceArn:sandboxArn(arn)}));}
      else if(s.Status!=="OPERATION_IN_PROGRESS")throw new Error("Sandbox cannot be paused in current state");
      await wait();
    }
    throw new Error("Sandbox pause did not complete");
  }
  if(command==="data"){
    stage="sandbox data";
    const rds=(await new RDSClient({credentials,region}).send(new DescribeDBInstancesCommand({DBInstanceIdentifier:"dandelist-db"}))).DBInstances?.[0];
    if(rds?.DBInstanceStatus!=="available"||!rds.Endpoint?.Address)throw new Error("Existing RDS unavailable");
    const host=rds.Endpoint.Address,port=rds.Endpoint.Port??5432;
    const url=(user:string,password:string,database:string)=>`postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
    // The existing admin credential is consumed internally exactly as in migrate.ts; never emitted.
    const admin=JSON.parse((await sm.send(new GetSecretValueCommand({SecretId:"dandelist/db"}))).SecretString!);
    if(typeof admin.username!=="string"||typeof admin.password!=="string")throw new Error("Admin identity unavailable");
    let dbUrl:string;
    if(await secretArn(SANDBOX.secrets.DATABASE_URL))dbUrl=(await sm.send(new GetSecretValueCommand({SecretId:SANDBOX.secrets.DATABASE_URL}))).SecretString!;
    else dbUrl=url(SANDBOX.user,randomBytes(32).toString("hex"),SANDBOX.database);
    const ownUrl=sandboxDatabaseUrl(dbUrl,host,port);
    const password=decodeURIComponent(ownUrl.password);
    // Persist recovery before any DDL so an interrupted first run never strands a generated login.
    await ensureSecret(SANDBOX.secrets.DATABASE_URL,async()=>dbUrl);
    const control=pgDb(url(admin.username,admin.password,"postgres"));
    try {
      stage="sandbox role metadata";
      const role=(await control.query<{rolsuper:boolean;rolcreatedb:boolean;rolcreaterole:boolean;rolreplication:boolean;rolinherit:boolean}>("select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolinherit from pg_roles where rolname=$1",[SANDBOX.user])).rows[0];
      if(role&&(role.rolsuper||role.rolcreatedb||role.rolcreaterole||role.rolreplication||role.rolinherit))throw new Error("Existing sandbox role is privileged");
      const memberships=(await control.query("select 1 from pg_auth_members m join pg_roles r on m.member=r.oid where r.rolname=$1",[SANDBOX.user])).rows;
      if(memberships.length)throw new Error("Sandbox role has inherited memberships");
      stage="sandbox role creation";
      if(!role)await control.exec(`create role ${SANDBOX.user} login password '${password}' nosuperuser nocreatedb nocreaterole noreplication noinherit connection limit 10`);
      stage="sandbox database creation";
      const marker="dandelist-billing-sandbox-v1";
      const existing=(await control.query<{owner:string;marker:string|null}>("select pg_get_userbyid(datdba) as owner,shobj_description(oid,'pg_database') as marker from pg_database where datname=$1",[SANDBOX.database])).rows[0];
      if(existing&&(existing.owner!==admin.username||existing.marker!==marker))throw new Error("Refusing unmarked database or another owner");
      // RDS's admin cannot SET ROLE to the new restricted login without changing role memberships.
      // Keep administrative ownership, grant the distinct runtime login rights only on the NEW database/schema.
      if(!existing){await control.exec(`create database ${SANDBOX.database}`);await control.exec(`comment on database ${SANDBOX.database} is '${marker}'`);}
      await control.exec(`revoke all on database ${SANDBOX.database} from public`);
      await control.exec(`grant connect,create,temporary on database ${SANDBOX.database} to ${SANDBOX.user}`);
      receipt.databaseOwner=admin.username;
    } finally {await control.end();}
    const schemaAdmin=pgDb(url(admin.username,admin.password,SANDBOX.database));
    try {await schemaAdmin.exec(`revoke create on schema public from public; grant usage,create on schema public to ${SANDBOX.user}`);}
    finally {await schemaAdmin.end();}
    // Persist recovery before migrations. Re-runs use the same dedicated login, never rotate production.
    await ensureSecret(SANDBOX.secrets.JWT_SECRET,async()=>randomBytes(48).toString("hex"));
    await ensureSecret(SANDBOX.secrets.CODE_PEPPER,async()=>randomBytes(32).toString("hex"));
    const isolated=pgDb(dbUrl);
    try {
      stage="sandbox database identity";
      const identity=(await isolated.query<{database:string;user:string}>("select current_database() as database,current_user as user")).rows[0];
      if(identity?.database!==SANDBOX.database||identity.user!==SANDBOX.user)throw new Error("Wrong database identity");
      receipt.database=identity.database;receipt.databaseRole=identity.user;
      stage="sandbox migrations";
      receipt.migrations=await migrate(isolated);
    } finally {await isolated.end();}
    // Metadata only: do not select production rows. PUBLIC CONNECT may exist, but no data/schema/definer privileges are allowed.
    const probe=new URL(dbUrl);probe.pathname="/dandelist";
    const productionProbe=pgDb(probe.toString());
    let productionConnected=false;
    try {
      stage="sandbox production privilege check";
      await productionProbe.query("select current_database()");productionConnected=true;
      const checks=(await productionProbe.query<{table_rights:boolean;schema_create:boolean;definer_execute:boolean}>(`select
        exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','S') and case when c.relkind='S' then has_sequence_privilege(current_user,c.oid,'USAGE,SELECT,UPDATE') else has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') end) as table_rights,
        has_schema_privilege(current_user,'public','CREATE') as schema_create,
        exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and has_function_privilege(current_user,p.oid,'EXECUTE')) as definer_execute`)).rows[0]!;
      receipt.productionPublicConnect=true;receipt.productionDataPrivileges=checks;
      if(checks.table_rights||checks.schema_create||checks.definer_execute)throw new Error("Sandbox role inherits production data privileges");
    } catch(e) {
      if(!productionConnected&&(e as {code?:string}).code==="42501")receipt.productionPublicConnect=false;
      else throw e;
    } finally {await productionProbe.end();}
    receipt.secretNames=Object.values(SANDBOX.secrets).slice(0,3);
  } else if(command==="build"){
    stage="reviewed main image build";
    const tag=`sandbox-${SANDBOX.source.slice(0,12)}`;
    const cb=new CodeBuildClient({credentials,region});
    const buildspec=`version: 0.2\nenv:\n  shell: bash\nphases:\n  pre_build:\n    commands:\n      - aws ecr get-login-password --region "$AWS_DEFAULT_REGION" | docker login --username AWS --password-stdin "${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"\n  build:\n    commands:\n      - docker build -f apps/api/Dockerfile -t "${repo}:${tag}" .\n  post_build:\n    commands:\n      - docker push "${repo}:${tag}"\n`;
    const buildId=(await cb.send(new StartBuildCommand({projectName:"dandelist-api-image",sourceVersion:SANDBOX.source,buildspecOverride:buildspec}))).build!.id!;
    receipt.buildId=buildId;receipt.source=SANDBOX.source;receipt.imageTag=tag;save();
    for(let i=0;i<100;i++){
      const b=(await cb.send(new BatchGetBuildsCommand({ids:[buildId]}))).builds![0]!;
      if(b.buildStatus==="SUCCEEDED"){
        if(b.resolvedSourceVersion!==SANDBOX.source)throw new Error("Build source mismatch");
        const image=(await new ECRClient({credentials,region}).send(new DescribeImagesCommand({repositoryName:"dandelist-api",imageIds:[{imageTag:tag}]}))).imageDetails?.[0]?.imageDigest;
        if(!image)throw new Error("Image digest missing");
        receipt.image=`${repo}@${image}`;receipt.buildStatus=b.buildStatus;break;
      }
      if(b.buildStatus!=="IN_PROGRESS")throw new Error("Sandbox image build failed");
      if(i===99)throw new Error("Sandbox image build timed out");
      await wait();
    }
  } else if(command==="status"||command==="pause"){
    stage=command;
    const s=await ownService();
    if(!s){receipt.status="ABSENT";return;}
    receipt.serviceArn=sandboxArn(s.ServiceArn!);receipt.url=`https://${s.ServiceUrl}`;receipt.status=s.Status;
    if(command==="pause")await pause(s.ServiceArn!);
  } else {
    stage="sandbox create";
    if(await ownService())throw new Error("Sandbox exists; use status/pause instead of replacing it");
    const refs:Record<string,string>={};
    for(const [key,name] of Object.entries(SANDBOX.secrets)){const arn=await secretArn(name);if(arn)refs[key]=arn;}
    const source=sandboxSource(options["--image"]??"",refs);
    const autoscale=(await ar.send(new CreateAutoScalingConfigurationCommand({AutoScalingConfigurationName:"dandelist-sandbox-one",MinSize:1,MaxSize:1,MaxConcurrency:10,Tags:tags}))).AutoScalingConfiguration!.AutoScalingConfigurationArn!;
    const s=(await ar.send(new CreateServiceCommand({ServiceName:SANDBOX.service,SourceConfiguration:source,InstanceConfiguration:{Cpu:"0.25 vCPU",Memory:"0.5 GB",InstanceRoleArn:SANDBOX.instanceRole},AutoScalingConfigurationArn:autoscale,HealthCheckConfiguration:{Protocol:"HTTP",Path:"/healthz",Interval:10,Timeout:5,HealthyThreshold:1,UnhealthyThreshold:5},Tags:tags}))).Service!;
    const arn=sandboxArn(s.ServiceArn!);receipt.serviceArn=arn;receipt.url=`https://${s.ServiceUrl}`;receipt.image=options["--image"];save();
    try {
      let running=false;
      for(let i=0;i<80;i++){
        const current=(await ar.send(new DescribeServiceCommand({ServiceArn:arn}))).Service!;
        if(current.Status==="RUNNING"){running=true;break;}
        if(current.Status!=="OPERATION_IN_PROGRESS")throw new Error("Sandbox startup failed");
        await wait();
      }
      if(!running)throw new Error("Sandbox startup timed out");
      const base=String(receipt.url);
      for(const [path,expected] of [["/healthz",200],["/config/features",200],["/me/billing",401]] as const){
        const response=await fetch(base+path,{redirect:"error",signal:AbortSignal.timeout(15_000)});
        if(response.status!==expected)throw new Error("Sandbox HTTP gate failed");
        if(path==="/config/features"&&(await response.json() as {chatContinuity?:boolean}).chatContinuity!==false)throw new Error("Sandbox feature default changed");
      }
      receipt.health="PASS; healthz200, features continuity=false, unauthenticated billing401";
    } finally {await pause(arn);}
  }
}
run().then(()=>{receipt.completedAt=new Date().toISOString();save();console.log(JSON.stringify(receipt));}).catch((e:unknown)=>{
  receipt.failedStage=stage;receipt.errorName=(e as {name?:string}).name??"Error";save();
  receipt.errorCode=String((e as {code?:string}).code??"none").slice(0,64);save();
  console.error(`Sandbox stopped during ${stage} (${receipt.errorName}); no secret-bearing error body emitted. Receipt: ${options["--receipt"]}`);process.exitCode=1;
});
