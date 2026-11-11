import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { migrate, type Db } from "../src/db";
import { SpendLimitError, assertBudget, assertClaudeBudget, assertScopeBudget, assertUserBudget, heldFor, heldForScope, heldInPool, hold, reserve, settle, recordSpend, withBudgetScope, withHold } from "../src/spend";

describe("shared atomic spend reservations",()=>{
  let lite:PGlite;let db:Db;
  const now=new Date("2026-10-27T18:00:00Z"),caps={dailyUsd:1,totalUsd:10};
  const usage={model:"muse-spark-1.3",inputTokens:10,cachedInputTokens:0,outputTokens:2,searches:0};
  beforeAll(async()=>{lite=new PGlite();db={query:(s,p)=>lite.query(s,p) as never,exec:s=>lite.exec(s)};await migrate(db);});
  beforeEach(async()=>{await db.exec("truncate spend_ledger,spend_reservations; delete from users");});
  afterAll(async()=>{await lite.close();});
  const spend=(usd:number)=>db.query("insert into spend_ledger(model,kind,cost_usd,created_at)values('muse-spark-1.3','test',$1,$2)",[usd,now.toISOString()]);
  const admitted=async(opts:Parameters<typeof reserve>[1]={})=>{const r=await reserve(db,opts);if(r==="slots")throw new Error("slots");return r;};
  const policy=(cap:number)=>({pool:"meta" as const,type:"global" as const,since:"2026-10-27T00:00:00Z",cap,total:10});
  it("40 parallel admissions through independent client wrappers admit only the cap",async()=>{
    const attempts=await Promise.allSettled(Array.from({length:40},()=>reserve({query:db.query,exec:db.exec},{usd:.1,policies:[policy(.5)]})));
    expect(attempts.filter(r=>r.status==="fulfilled")).toHaveLength(5);expect(await heldInPool(db,"meta")).toBe(.5);
    expect(attempts.filter(r=>r.status==="rejected").every(r=>(r as PromiseRejectedResult).reason instanceof SpendLimitError)).toBe(true);
  });
  it("checks both daily and lifetime ledger in admission",async()=>{
    await spend(.95);await expect(withHold(db,()=>assertBudget(db,caps,now),async()=>"bad")).rejects.toMatchObject({scope:"daily"});
    await db.exec("truncate spend_ledger");await spend(9.95);
    await expect(withHold(db,()=>assertBudget(db,{dailyUsd:100,totalUsd:10},now),async()=>"bad")).rejects.toMatchObject({scope:"total"});
  });
  it("bounds the daily window with older ledger rows while lifetime admissions stay atomic",async()=>{
    await db.query("insert into spend_ledger(model,kind,cost_usd,created_at) select 'muse-spark-1.3','old',.0095,'2025-01-01'::timestamptz from generate_series(1,1000)");
    await spend(.2);
    const attempts=await Promise.allSettled(Array.from({length:20},()=>reserve(db,{usd:.1,policies:[policy(1)]})));
    // 9.5 historical + .2 today + .3 held = 10 lifetime, despite .8 daily headroom.
    expect(attempts.filter(r=>r.status==="fulfilled")).toHaveLength(3);
    expect(attempts.filter(r=>r.status==="rejected").every(r=>(r as PromiseRejectedResult).reason.scope==="total")).toBe(true);
    expect(await heldInPool(db,"meta")).toBe(.3);
    await expect(assertBudget(db,{dailyUsd:.5,totalUsd:10},now)).resolves.toBeUndefined();
  });
  it("uses inclusive daily and exclusive rolling boundaries independently of old rows",async()=>{
    const id=(await db.query<{id:string}>("insert into users(email)values('boundary@example.invalid')returning id")).rows[0]!.id;
    await db.query("insert into spend_ledger(user_id,model,kind,cost_usd,created_at)values($1,'muse-spark-1.3','guest:test',.5,'2026-10-27T00:00:00Z'),($1,'muse-spark-1.3','guest:test',9,'2025-01-01')",[id]);
    const rolling={...policy(.1),type:"user" as const,userId:id,exclusive:true};
    const r=await admitted({userId:id,policies:[rolling]});await r.release();
    await expect(reserve(db,{usd:.1,policies:[policy(.5)]})).rejects.toMatchObject({scope:"daily"});
    await db.query("update spend_ledger set user_id=null");
    const scoped={...policy(.1),type:"scope" as const,scope:"guest",exclusive:true};
    const guest=await admitted({scope:"guest",policies:[scoped]});await guest.release();
    await expect(reserve(db,{scope:"guest",policies:[{...scoped,exclusive:false}]})).rejects.toMatchObject({scope:"daily"});
  });
  it("keeps running totals correct for ledger inserts, corrections, deletes and truncation",async()=>{
    const totals=async()=>Object.fromEntries((await db.query<{pool:string;usd:string}>("select pool,usd from spend_pool_totals")).rows.map(r=>[r.pool,Number(r.usd)]));
    await spend(.2);await db.exec("insert into spend_ledger(model,kind,cost_usd)values('claude-test','test',.3),('apify:test','test',100)");
    expect(await totals()).toEqual({meta:.2,claude:.3});
    await db.exec("update spend_ledger set model='claude-corrected',cost_usd=.4 where model='muse-spark-1.3'");
    expect(await totals()).toEqual({meta:0,claude:.7});
    await db.exec("delete from spend_ledger where model='claude-test'");expect(await totals()).toEqual({meta:0,claude:.4});
    await db.exec("truncate spend_ledger");expect(await totals()).toEqual({meta:0,claude:0});
  });
  it("settles atomically and idempotently under duplicate delivery",async()=>{
    const r=await admitted();const results=await Promise.all(Array.from({length:10},()=>settle(db,r.id,null,"test",usage,.04,now)));
    expect(results.filter(Boolean)).toHaveLength(1);expect(await heldInPool(db,"meta")).toBe(0);
    expect((await db.query<{n:number}>("select count(*)::int as n from spend_ledger")).rows[0]?.n).toBe(1);
    expect(Number((await db.query<{usd:string}>("select usd from spend_pool_totals where pool='meta'")).rows[0]?.usd)).toBe(.04);
    await expect(settle(db,r.id,null,"test",usage,.05,now)).rejects.toThrow("Conflicting");await r.release();await r.release();
  });
  it("never exposes a settlement-to-ledger gap",async()=>{
    const r=await admitted({usd:.1,policies:[policy(.1)]});const other=()=>reserve(db,{usd:.1,policies:[policy(.1)]});
    const all=await Promise.allSettled([settle(db,r.id,null,"test",usage,.1,now),other(),other()]);expect(all.slice(1).every(x=>x.status==="rejected")).toBe(true);
  });
  it("expires crashed holds but never hides late actual usage",async()=>{
    const r=await admitted({usd:.1,policies:[policy(.1)]});await db.query("update spend_reservations set expires_at=clock_timestamp()-interval '1 second' where id=$1",[r.id]);
    const next=await admitted({usd:.1,policies:[policy(.1)]});expect(await heldInPool(db,"meta")).toBe(.1);
    await settle(db,r.id,null,"test",usage,.02,now);expect(await heldInPool(db,"meta")).toBe(.1);await next.release();
  });
  it("renews only live leases and release cannot resurrect them",async()=>{
    const r=await admitted();expect((await db.query<{ok:boolean}>("select spend_renew($1,1000) as ok",[r.id])).rows[0]?.ok).toBe(true);await r.release();await r.release();
    expect((await db.query<{ok:boolean}>("select spend_renew($1,1000) as ok",[r.id])).rows[0]?.ok).toBe(false);
  });
  it("shares account concurrency, waits for release and lets other accounts run",async()=>{
    const releases=await Promise.all(Array.from({length:8},()=>hold(db,.1,"user-a")));let ran=false;
    const waiting=withHold(db,async()=>{},async()=>{ran=true;return "ok";},"user-a");
    await withHold(db,async()=>{},async()=>"other","user-b");expect(ran).toBe(false);await releases[0]!();await expect(waiting).resolves.toBe("ok");
    await Promise.all(releases.slice(1).map(r=>r()));expect(await heldFor(db,"user-a")).toBe(0);
  });
  it("bounds queued wait and drops aborted callers without delaying live ones",async()=>{
    const releases=await Promise.all(Array.from({length:8},()=>hold(db,.1,"user-a")));
    await expect(withHold(db,async()=>{},async()=>"bad","user-a",.1,undefined,"meta",.1,{waitMs:5})).rejects.toMatchObject({scope:"user"});
    const stop=new AbortController();let ran=false;const abandoned=withHold(db,async()=>{},async()=>{ran=true;},"user-a",.1,stop.signal);stop.abort();await expect(abandoned).rejects.toThrow();
    await Promise.all(releases.map(r=>r()));await withHold(db,async()=>{},async()=>"ok","user-a");expect(ran).toBe(false);
  });
  it("checks cancellation after guard and releases on provider failure",async()=>{
    const stop=new AbortController();let ran=false;
    await expect(withHold(db,async()=>{stop.abort();},async()=>{ran=true;},"user-a",.1,stop.signal)).rejects.toThrow();
    await expect(withHold(db,async()=>{},async()=>{throw new Error("mock failure");},"user-a")).rejects.toThrow("mock failure");expect(ran).toBe(false);expect(await heldFor(db,"user-a")).toBe(0);
  });
  it("rechecks rolling user allowance including other-instance holds",async()=>{
    const id=(await db.query<{id:string}>("insert into users(email)values('fixture@example.invalid')returning id")).rows[0]!.id;const r=await admitted({userId:id,usd:.1});
    await expect(withHold(db,()=>assertUserBudget(db,id,.15,now),async()=>"bad",id)).rejects.toMatchObject({scope:"user"});await r.release();
  });
  it("keeps provider pools and scaled personal shares separate",async()=>{
    const r=await admitted({userId:"fixture",pool:"claude",usd:.6,mineUsd:.1});expect(await heldFor(db,"fixture","claude")).toBe(.1);expect(await heldInPool(db,"claude")).toBe(.6);expect(await heldInPool(db,"meta")).toBe(0);
    await expect(withHold(db,()=>assertClaudeBudget(db,.65,now),async()=>"bad",undefined,.6,undefined,"claude")).rejects.toMatchObject({scope:"daily"});await r.release();
  });
  it("counts feature holds apart from other features",async()=>{
    const r=await admitted({scope:"guest",usd:.1});await expect(withBudgetScope(db,"guest",()=>assertScopeBudget(db,"guest","meta",.15,now),async()=>"bad")).rejects.toMatchObject({scope:"daily"});
    await expect(withBudgetScope(db,"preview",()=>assertScopeBudget(db,"preview","meta",.15,now),()=>heldForScope(db,"guest"))).resolves.toBe(.1);await r.release();
  });
  it("onUsage settles the active call once",async()=>{
    await withHold(db,()=>assertBudget(db,caps,now),async()=>{await recordSpend(db,null,"test",usage,.03,now);await recordSpend(db,null,"test",usage,.03,now);});
    expect(Number((await db.query<{cost:string}>("select sum(cost_usd) as cost from spend_ledger")).rows[0]?.cost)).toBe(.03);expect(await heldInPool(db,"meta")).toBe(0);
  });
  it("refuses invalid amounts and settlement in the wrong pool",async()=>{
    await expect(reserve(db,{usd:NaN})).rejects.toThrow();await expect(reserve(db,{usd:-1})).rejects.toThrow();const r=await admitted();
    await expect(settle(db,r.id,null,"test",{...usage,model:"claude-test"},.01,now)).rejects.toThrow("match");await r.release();
  });
  it("account deletion removes the hold owner but retains late spend in service totals",async()=>{
    const id=(await db.query<{id:string}>("insert into users(email)values('deleted@example.invalid')returning id")).rows[0]!.id;
    const r=await admitted({userId:id});await db.query("delete from users where id=$1",[id]);
    await settle(db,r.id,id,"test",usage,.02,now);
    expect((await db.query<{user_id:null}>("select user_id from spend_ledger")).rows[0]?.user_id).toBe(null);
  });
});

it("migration 030 bootstraps lifetime totals from an existing provider-separated ledger",async()=>{
  const lite=new PGlite();const db:Db={query:(s,p)=>lite.query(s,p) as never,exec:s=>lite.exec(s)};
  try{
    await db.exec(await readFile(new URL("../sql/001_init.sql",import.meta.url),"utf8"));
    await db.exec("insert into spend_ledger(model,kind,cost_usd,created_at) values('muse-spark-1.3','old',9.9,'2025-01-01'),('claude-test','old',100,'2025-01-01'),('apify:test','old',900,'2025-01-01')");
    await db.exec(await readFile(new URL("../sql/030_shared_spend.sql",import.meta.url),"utf8"));
    const p={pool:"meta" as const,type:"global" as const,since:"2026-10-27T00:00:00Z",cap:.1,total:10};
    const r=await reserve(db,{usd:.1,policies:[p]});expect(r).not.toBe("slots");
    await expect(reserve(db,{usd:.1,policies:[p]})).rejects.toMatchObject({scope:"total"});
    expect((await db.query<{pool:string;usd:string}>("select pool,usd from spend_pool_totals order by pool")).rows).toEqual([{pool:"claude",usd:"100.000000"},{pool:"meta",usd:"9.900000"}]);
    // Check the existing timestamp index can support the bounded admission sum.
    await db.exec("set enable_seqscan=off");
    const plan=await db.query("explain select sum(cost_usd) from spend_ledger where created_at >= '2026-10-27' and model not like 'claude-%' and model not like 'apify:%'");
    expect(JSON.stringify(plan.rows)).toContain("spend_ledger_created");expect(JSON.stringify(plan.rows)).toContain("Index Cond:");
  }finally{await lite.close();}
});
