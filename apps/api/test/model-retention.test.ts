import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { beforeAll,beforeEach,afterAll,expect,it } from "vitest";
import type { ResponsesResult } from "@dandelist/meta";
import { migrate,type Db } from "../src/db";
import { MODEL_HISTORY_TTL_MS,modelRouter,postgresHistory,purgeExpiredModelHistory,type Envelope } from "../src/model-adapter";
import { modelFor } from "../src/under";
import { runTurn } from "../src/dream/agent";
import { emptyState,type TranscriptEntry } from "../src/dream/types";
import type { DreamCtx } from "../src/dream/context";

let lite:PGlite,db:Db,user:string,other:string,session:string;
const id=()=>"app_"+randomUUID();
const envelope:Envelope={input:[{role:"user",content:"synthetic saved conversation"}]};
const result=(text="fixture answer"):ResponsesResult=>({id:"resp_fixture",text,functionCalls:[],citations:[],searchQueries:[],usage:{model:"fixture",inputTokens:0,cachedInputTokens:0,outputTokens:0,searches:0},costUsd:0,raw:null});
beforeAll(async()=>{
  lite=new PGlite();db={query:(s,p)=>lite.query(s,p) as never,exec:s=>lite.exec(s)};await migrate(db);
  user=(await db.query<{id:string}>("insert into users(email)values('retention-a@example.invalid')returning id")).rows[0]!.id;
  other=(await db.query<{id:string}>("insert into users(email)values('retention-b@example.invalid')returning id")).rows[0]!.id;
});
beforeEach(async()=>{await db.exec("truncate model_turns,dream_sessions cascade");session=(await db.query<{id:string}>("insert into dream_sessions(user_id)values($1)returning id",[user])).rows[0]!.id;});
afterAll(async()=>{await lite.close();});
it("sets a 30-day deadline from the database clock, independent of the client clock",async()=>{
  const before=(await db.query<{t:Date}>("select clock_timestamp() as t")).rows[0]!.t.getTime();
  await postgresHistory(db,user,session).save(id(),envelope);
  const row=(await db.query<{expires_at:Date}>("select expires_at from model_turns")).rows[0]!;
  const after=(await db.query<{t:Date}>("select clock_timestamp() as t")).rows[0]!.t.getTime();
  expect(MODEL_HISTORY_TTL_MS).toBe(30*86400000);expect(row.expires_at.getTime()).toBeGreaterThanOrEqual(before+MODEL_HISTORY_TTL_MS);expect(row.expires_at.getTime()).toBeLessThanOrEqual(after+MODEL_HISTORY_TTL_MS);
});
it("continues a 29-day-old context beyond the old one-hour deadline",async()=>{
  const store=postgresHistory(db,user,session),previous=id();await store.save(previous,envelope);
  await db.exec("update model_turns set created_at=clock_timestamp()-interval '29 days',expires_at=clock_timestamp()+interval '1 day'");
  let sent="";const run=modelRouter({id:"meta",respond:async b=>{sent=JSON.stringify(b);return result();}},undefined,store,()=>false);
  await run({previous_response_id:previous,input:"continue"});expect(sent).toContain("synthetic saved conversation");expect(sent).toContain("continue");expect(sent).not.toContain("previous_response_id");
});
it("expired context is inaccessible and automatic cleanup removes it without a new model call",async()=>{
  const store=postgresHistory(db,user,session),previous=id();await store.save(previous,envelope);
  await db.exec("update model_turns set expires_at=clock_timestamp()-interval '1 millisecond'");
  await expect(store.load(previous)).rejects.toThrow("Unknown");await purgeExpiredModelHistory(db);
  expect((await db.query("select * from model_turns")).rows).toHaveLength(0);
});
it("isolates conversation context and cascades only the deleted conversation's copies",async()=>{
  const a=id(),b=id();await postgresHistory(db,user,session).save(a,envelope);await postgresHistory(db,user).save(b,envelope);
  await expect(postgresHistory(db,user).load(a)).rejects.toThrow("Unknown");
  await expect(postgresHistory(db,other,session).save(id(),envelope)).rejects.toThrow();
  await db.query("delete from dream_sessions where id=$1",[session]);
  expect((await db.query<{id:string}>("select id from model_turns")).rows.map(r=>r.id)).toEqual([b.slice(4)]);
  await expect(postgresHistory(db,user,session).save(id(),envelope)).rejects.toThrow();
});
it("keeps the 400-item and two-megabyte caps at the persistence boundary",async()=>{
  const store=postgresHistory(db,user);
  await expect(store.save(id(),{input:Array(401).fill({role:"user",content:"fixture"})})).rejects.toThrow("limit");
  await expect(store.save(id(),{input:["x".repeat(2_000_001)]})).rejects.toThrow("limit");
  expect((await db.query("select * from model_turns")).rows).toHaveLength(0);
});
it("reopening an old dream rebuilds from saved text after temporary context has expired",async()=>{
  await postgresHistory(db,user,session).save(id(),envelope);await db.exec("update model_turns set expires_at=clock_timestamp()-interval '1 day'");
  const transcript:TranscriptEntry[]=[{role:"user",text:"A quiet reading room",at:"2025-01-01T00:00:00Z"},{role:"agent",text:"Somewhere peaceful.",at:"2025-01-01T00:00:01Z"}];
  const requests:Record<string,unknown>[]=[];
  const responses=modelFor({db,now:()=>new Date(),modelHistory:true},user,async b=>{requests.push(b);return result((b.text as {format?:{name?:string}}|undefined)?.format?.name==="wants"?'{"wants":[]}':"Welcome back.");},undefined,session);
  const ctx={db,userId:user,sessionId:session,meta:{responses},life:{home:null,currency:"USD"},list:[],now:()=>new Date(),emit:async()=>{},budget:{meta(){},tool(){}}} as unknown as DreamCtx;
  await runTurn(ctx,transcript,emptyState(),{type:"message",text:"Let's continue."});
  expect(requests.some(b=>JSON.stringify(b.input).includes("A quiet reading room"))).toBe(true);
  expect(requests.every(b=>b.previous_response_id===undefined)).toBe(true);
  expect(transcript.at(-1)?.text).toBe("Welcome back.");
  expect((await db.query("select * from model_turns where session_id=$1",[session])).rows.length).toBeGreaterThan(0);
});
it("account deletion still cascades linked and unlinked temporary context",async()=>{
  const person=(await db.query<{id:string}>("insert into users(email)values('retention-delete@example.invalid')returning id")).rows[0]!.id;
  await postgresHistory(db,person).save(id(),envelope);await db.query("delete from users where id=$1",[person]);
  expect((await db.query("select * from model_turns where user_id=$1",[person])).rows).toHaveLength(0);
});
