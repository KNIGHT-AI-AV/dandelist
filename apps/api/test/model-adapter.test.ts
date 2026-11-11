import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
import { MetaApiError, type ResponsesResult } from "@dandelist/meta";
import { migrate, type Db } from "../src/db";
import { modelRouter, postgresHistory } from "../src/model-adapter";
import { modelFor } from "../src/under";
import { readEnv } from "../src/env";
let lite:PGlite,db:Db,user:string,other:string;
const result=(text="hello",calls:ResponsesResult["functionCalls"]=[]):ResponsesResult=>({id:"resp_provider",text,functionCalls:calls,citations:[],searchQueries:[],usage:{model:"fixture",inputTokens:0,cachedInputTokens:0,outputTokens:0,searches:0},costUsd:0,raw:null});
beforeAll(async()=>{lite=new PGlite();db={query:(s,p)=>lite.query(s,p) as never,exec:s=>lite.exec(s)};await migrate(db);user=(await db.query<{id:string}>("insert into users(email)values('model-a@example.invalid')returning id")).rows[0]!.id;other=(await db.query<{id:string}>("insert into users(email)values('model-b@example.invalid')returning id")).rows[0]!.id;});
beforeEach(async()=>{await db.exec("truncate model_turns");});afterAll(async()=>{await lite.close();});
it("flag off preserves identical Meta request object, fields and provider response ID",async()=>{
  const body={input:[{type:"function_call_output",call_id:"abc",output:"fixture"}],previous_response_id:"resp_original",instructions:"same",text:{format:{type:"json_schema",schema:{type:"object"}}}};
  let seen:unknown;const run=modelFor({db,now:()=>new Date()},user,async r=>{seen=r;return result();},undefined);
  expect((await run(body)).id).toBe("resp_provider");expect(seen).toBe(body);expect((await db.query("select * from model_turns")).rows).toHaveLength(0);
  expect(readEnv({DATABASE_URL:"pglite:",JWT_SECRET:"fixture-only-secret-more-than-32-characters",CODE_PEPPER:"fixture-only-pepper-32-characters"}).MODEL_HISTORY_ENABLED).toBe(false);
});
it("a new instance can fall back mid-conversation and return to Meta without provider IDs",async()=>{
  const store=postgresHistory(db,user);const root=modelRouter({id:"meta",respond:async()=>result("first answer")},undefined,store,()=>false);
  const first=await root({input:"first wish",instructions:"rule"});expect(first.id).toMatch(/^app_/);
  let seen:Record<string,unknown>|undefined;const next=modelRouter({id:"meta",respond:async()=>{throw new MetaApiError(402,"fixture");}},
    {id:"aws-fixture",needsSchemaPrompt:true,respond:async r=>{seen=r;return result("fallback answer");}},postgresHistory(db,user),()=>true);
  const second=await next({input:"continue",previous_response_id:first.id,text:{format:{schema:{type:"object",description:"keep this field meaning"}}}});
  expect(seen?.previous_response_id).toBeUndefined();expect(JSON.stringify(seen?.input)).toContain("first answer");expect(seen?.instructions).toContain("keep this field meaning");
  let third:unknown;await modelRouter({id:"meta",respond:async r=>{third=r;return result();}},undefined,store,()=>false)({input:"again",previous_response_id:second.id});
  expect(JSON.stringify(third)).toContain("fallback answer");expect(JSON.stringify(third)).not.toContain("resp_provider");
});
it("tool calls/results survive normalization, and no tools are executed by the router",async()=>{
  const store=postgresHistory(db,user);let requests:Record<string,unknown>[]=[];
  const run=modelRouter({id:"meta",respond:async r=>{requests.push(r);return result("",[{callId:"tool-a",name:"read_page",arguments:'{"url":"https://fixture.example"}'}]);}},undefined,store,()=>false);
  const first=await run({input:"research",tools:[{type:"function",name:"read_page",parameters:{type:"object"}}]});
  await run({input:[{type:"function_call_output",call_id:"tool-a",output:'{"price":100}'}],previous_response_id:first.id});
  expect(JSON.stringify(requests[1]?.input)).toContain('function_call_output');expect(requests[1]?.tool_choice).toBe("none");
  await expect(run({input:[{type:"function_call_output",call_id:"wrong",output:"x"}],previous_response_id:first.id})).rejects.toThrow("tool output");
});
it("missing, expired and other-account history fail before any provider call",async()=>{
  let calls=0;const respond=async()=>{calls++;return result();};const a=modelRouter({id:"meta",respond},undefined,postgresHistory(db,user),()=>false);
  const first=await a({input:"private fixture"});const b=modelRouter({id:"meta",respond},undefined,postgresHistory(db,other),()=>false);
  await expect(b({input:"read",previous_response_id:first.id})).rejects.toThrow("Unknown");
  await db.exec("update model_turns set expires_at=clock_timestamp()-interval '1 second'");await expect(a({input:"continue",previous_response_id:first.id})).rejects.toThrow("Unknown");
  await expect(a({input:"continue",previous_response_id:"resp_unknown"})).rejects.toThrow("Unknown");expect(calls).toBe(1);
});
it("failures/cancellation never save a successful turn or invoke an unauthorized fallback",async()=>{
  let fallback=0;const error=new DOMException("fixture","AbortError");
  const run=modelRouter({id:"meta",respond:async()=>{throw error;}},{id:"fallback",respond:async()=>{fallback++;return result();}},postgresHistory(db,user),()=>false);
  await expect(run({input:"hello"})).rejects.toBe(error);expect(fallback).toBe(0);expect((await db.query("select * from model_turns")).rows).toHaveLength(0);
});
it("bounded history rejects oversized input before dispatch and deletion cascades",async()=>{
  let calls=0;const run=modelRouter({id:"meta",respond:async()=>{calls++;return result();}},undefined,postgresHistory(db,other),()=>false);
  await expect(run({input:"x".repeat(2_000_001)})).rejects.toThrow("limit");expect(calls).toBe(0);
  await run({input:"fixture"});await db.query("delete from users where id=$1",[other]);expect((await db.query("select * from model_turns")).rows).toHaveLength(0);
});
