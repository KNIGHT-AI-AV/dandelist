import assert from "node:assert/strict";
import { test } from "node:test";
process.env.DANDELIST_SANDBOX_AWS_ACCOUNT_ID="111111111111";
const { ACCOUNT, SANDBOX, requireMoneyGate, sandboxArn, sandboxDatabaseUrl, sandboxSource }=await import("./sandbox-config");
const now = Date.parse("2026-11-12T05:00:00Z");
const gate = () => ({ account: ACCOUNT, step0Complete: true, verifiedAt: new Date(now).toISOString(), activate: { remainingUsd: "2500", expires: "2099-01-01", eligibleServices: ["AWS App Runner", "Amazon Relational Database Service", "AWS Secrets Manager", "CodeBuild"] }, budget: { recipientVerification: "Verified", alerts: [{ type: "ACTUAL", thresholdUsd: "1.00" }, { type: "FORECASTED", thresholdUsd: "5.00" }] } });
test("requires fresh observed credit coverage and verified net-cost notifications", () => {
  assert.doesNotThrow(() => requireMoneyGate(gate(), now));
  for (const mutate of [(g:any)=>g.account="other",(g:any)=>g.step0Complete=false,(g:any)=>g.verifiedAt="invalid",(g:any)=>g.verifiedAt=new Date(now-25*3600_000).toISOString(),(g:any)=>g.budget.recipientVerification="Pending",(g:any)=>g.activate.remainingUsd="NaN",(g:any)=>g.activate.remainingUsd="0",(g:any)=>g.activate.expires="2026-11-01",(g:any)=>g.activate.eligibleServices.pop(),(g:any)=>g.budget.alerts.pop()]) {
    const fixture=gate(); mutate(fixture); assert.throws(()=>requireMoneyGate(fixture,now));
  }
});
test("expired funding must not prevent shutdown or status inspection",()=>{
  const expired=gate();expired.activate.expires="2020-01-01";expired.budget.recipientVerification="Pending";
  assert.doesNotThrow(()=>requireMoneyGate(expired,now,"pause"));
  assert.doesNotThrow(()=>requireMoneyGate(undefined,now,"status"));
  for(const operation of ["data","build","create"] as const)assert.throws(()=>requireMoneyGate(expired,now,operation));
});
test("never accepts production, another account, another region or arbitrary service for pause/status mutations", () => {
  const arn=`arn:aws:apprunner:us-east-1:${ACCOUNT}:service/${SANDBOX.service}/${"a".repeat(32)}`;
  assert.equal(sandboxArn(arn),arn);
  for(const bad of [arn.replace(SANDBOX.service,"dandelist-api"),arn.replace(ACCOUNT,"222222222222"),arn.replace("us-east-1","us-west-2"),arn+"/other"])assert.throws(()=>sandboxArn(bad));
});
const image=`${ACCOUNT}.dkr.ecr.us-east-1.amazonaws.com/dandelist-api@sha256:${"b".repeat(64)}`;
const refs=Object.fromEntries(Object.entries(SANDBOX.secrets).slice(0,3).map(([k,v])=>[k,`arn:aws:secretsmanager:us-east-1:${ACCOUNT}:secret:${v}-ABC123`]));
test("sandbox configuration has no AI/provider credentials, no automatic deployments and no production flags",()=>{
  const source=sandboxSource(image,refs);
  assert.equal(source.AutoDeploymentsEnabled,false);
  assert.deepEqual(source.ImageRepository?.ImageConfiguration?.RuntimeEnvironmentVariables,{NODE_ENV:"staging",BILLING_SANDBOX_ENABLED:"1",APPLE_BUNDLE_ID:"com.knightaiav.dandelist",WEB_ORIGINS:"http://localhost:8081"});
  assert.equal(SANDBOX.instanceRole.endsWith("/dandelist-apprunner-sandbox"),true);
});
test("rejects latest tags and production/foreign/arbitrary secret references before an AWS call",()=>{
  assert.throws(()=>sandboxSource(image.replace(/@sha256:.*/,":latest"),refs));
  const invalid:Record<string,string>[]=[{...refs,DATABASE_URL:refs.DATABASE_URL!.replace("/sandbox/","/api/")},{...refs,MODEL_API_KEY:refs.JWT_SECRET!},{JWT_SECRET:refs.JWT_SECRET!}];
  for(const bad of invalid)assert.throws(()=>sandboxSource(image,bad));
});
test("database initialization refuses production paths, shared users, foreign hosts and connection options",()=>{
  const url=`postgres://${SANDBOX.user}:${"a".repeat(64)}@fixture.rds.amazonaws.com:5432/${SANDBOX.database}`;
  assert.equal(sandboxDatabaseUrl(url,"fixture.rds.amazonaws.com",5432).pathname,`/${SANDBOX.database}`);
  for(const bad of [url.replace(`/${SANDBOX.database}`,"/dandelist"),url.replace(SANDBOX.user,"dandelist"),url.replace("fixture.rds.amazonaws.com","other.invalid"),url+"?options=-csearch_path=public",url.replace("postgres:","http:"),url.replace("a".repeat(64),"injected'password")])assert.throws(()=>sandboxDatabaseUrl(bad,"fixture.rds.amazonaws.com",5432));
});
