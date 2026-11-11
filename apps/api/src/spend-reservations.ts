import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Db } from "./db";
import type { Usage } from "@dandelist/meta";

export type Pool = "meta" | "claude";
export const HOLD_USD = .1;
export const CLAUDE_HOLD_USD = .6;
export const MAX_INFLIGHT_PER_USER = 8;
export const SLOT_WAIT_MS = 20_000;
export const HOLD_TTL_MS = 10 * 60_000;
const RENEW_INTERVAL_MS = HOLD_TTL_MS / 3;
const RENEW_RETRY_MS = 15_000;
const LEASE_MARGIN_MS = 30_000;
export class SpendLimitError extends Error {
  constructor(readonly scope: "daily" | "total" | "user") {
    super(scope === "daily" ? "Today's AI budget is used up. Try again tomorrow." : scope === "user" ? "You've used today's research allowance. Try again tomorrow." : "The AI budget for this event is used up.");
  }
}
export interface BudgetPolicy { pool: Pool; type: "global" | "user" | "scope"; since: string; cap: number; total?: number; userId?: string; scope?: string; exclusive?: boolean; extra?: number }
interface Capture { db: Db; policies: BudgetPolicy[] }
interface Active { db: Db; id: string; signal: AbortSignal }
const capture = new AsyncLocalStorage<Capture>();
const active = new AsyncLocalStorage<Active>();
/** Guards still run for readiness checks; within withHold their policies are rechecked atomically by SQL. */
export function collectPolicy(db: Db, policy: BudgetPolicy): void { const c=capture.getStore(); if(c?.db===db)c.policies.push(policy); }
const money = (usd: number) => { if (!Number.isFinite(usd) || usd < 0) throw new Error("Invalid reservation amount"); return usd.toFixed(6); };
export async function heldInPool(db: Db, pool: Pool): Promise<number> { return heldAmount(db,pool); }
export async function heldFor(db: Db, userId: string, pool: Pool="meta"): Promise<number> { return heldAmount(db,pool,userId); }
export async function heldForScope(db: Db, scope: string, pool: Pool="meta"): Promise<number> { return heldAmount(db,pool,undefined,scope); }
async function heldAmount(db: Db,pool: Pool,userId?: string,scope?: string) {
  const {rows}=await db.query<{usd:string}>(`select coalesce(sum(case when $2::text is null then usd else mine_usd end),0) as usd from spend_reservations
    where pool=$1 and state='held' and expires_at > clock_timestamp() and ($2::text is null or user_id=$2) and ($3::text is null or scope=$3)`,[pool,userId??null,scope??null]);
  return Number(rows[0]?.usd??0);
}
export interface Reservation { id: string; release(): Promise<void> }
export async function reserve(db: Db,opts: {userId?:string;pool?:Pool;scope?:string;usd?:number;mineUsd?:number;policies?:BudgetPolicy[];ttlMs?:number}={}): Promise<Reservation | "slots"> {
  const id=randomUUID(),ttl=opts.ttlMs??HOLD_TTL_MS;
  if(!Number.isSafeInteger(ttl)||ttl<=0||ttl>HOLD_TTL_MS)throw new Error("Invalid reservation TTL");
  const {rows}=await db.query<{result:string}>("select spend_reserve($1,$2,$3,$4,$5,$6,$7,$8::jsonb) as result",[id,opts.pool??"meta",opts.userId??null,opts.scope??null,money(opts.usd??HOLD_USD),money(opts.mineUsd??opts.usd??HOLD_USD),ttl,JSON.stringify(opts.policies??[])]);
  const result=rows[0]?.result;
  if(result==="slots")return "slots";
  if(result!=="ok") { if(result==="daily"||result==="total"||result==="user")throw new SpendLimitError(result); throw new Error("Reservation refused"); }
  return {id,release:async()=>{await db.query("select spend_release($1)",[id]);}};
}
/** Low-level reservation, used by tests and bounded internal jobs; model paths use withHold's collected guards. */
export async function hold(db: Db,usd=HOLD_USD,userId?:string,pool:Pool="meta",mineUsd=usd): Promise<()=>Promise<void>> {
  const r=await reserve(db,{usd,userId,pool,mineUsd});if(r==="slots")throw new SpendLimitError("user");return r.release;
}
function delay(ms:number,signal?:AbortSignal) {
  return new Promise<void>((resolve,reject)=>{
    const done=()=>{clearTimeout(timer);signal?.removeEventListener("abort",stop);resolve();};
    const stop=()=>{clearTimeout(timer);signal?.removeEventListener("abort",stop);reject(signal?.reason??new Error("Aborted"));};
    const timer=setTimeout(done,ms);signal?.addEventListener("abort",stop,{once:true});if(signal?.aborted)stop();
  });
}
export async function withHold<T>(db:Db,check:()=>Promise<void>,run:()=>Promise<T>,userId?:string,usd=HOLD_USD,signal?:AbortSignal,pool:Pool="meta",mineUsd=usd,opts:{scope?:string;waitMs?:number}={}):Promise<T> {
  signal?.throwIfAborted();
  const policies:BudgetPolicy[]=[];
  await capture.run({db,policies},check);
  const by=Date.now()+(opts.waitMs??SLOT_WAIT_MS);
  let reservation:Reservation;
  let leaseUntil=0,backoff=50,attempt=0;
  for(;;){
    signal?.throwIfAborted();
    if(attempt++>0&&Date.now()>=by)throw new SpendLimitError("user");
    // Query start is a conservative lower bound for the database's lease deadline.
    const started=Date.now();
    const r=await reserve(db,{usd,mineUsd,userId,pool,scope:opts.scope,policies});
    if(r!=="slots"){reservation=r;leaseUntil=started+HOLD_TTL_MS;break;}
    const left=by-Date.now();if(left<=0)throw new SpendLimitError("user");
    // Database polling sees releases from any instance; no process-local queues or budget state.
    const jittered=Math.min(500,backoff*(.9+Math.random()*.2));
    await delay(Math.min(left,jittered),signal);
    backoff=Math.min(500,backoff*2);
  }
  const lease=new AbortController();
  const requestSignal=signal?AbortSignal.any([signal,lease.signal]):lease.signal;
  let renewing:Promise<unknown>|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined,deadline:ReturnType<typeof setTimeout>|undefined,stopped=false;
  const lost=()=>lease.abort(new Error("Reservation lease lost"));
  const watchDeadline=()=>{
    clearTimeout(deadline);
    deadline=setTimeout(lost,Math.max(0,leaseUntil-Date.now()-LEASE_MARGIN_MS));deadline.unref();
  };
  const schedule=(ms:number)=>{
    if(stopped||lease.signal.aborted)return;
    timer=setTimeout(()=>{
      const started=Date.now();
      renewing=db.query<{ok:boolean}>("select spend_renew($1,$2) as ok",[reservation.id,HOLD_TTL_MS]).then(r=>{
        if(stopped)return;
        if(!r.rows[0]?.ok){lost();return;}
        leaseUntil=started+HOLD_TTL_MS;watchDeadline();schedule(RENEW_INTERVAL_MS);
      }).catch(()=>{
        // A transport/DB error says nothing about ownership. Retry within the last
        // confirmed lease, while the independent watchdog also covers a hung query.
        if(Date.now()>=leaseUntil-LEASE_MARGIN_MS)lost();
        else schedule(Math.min(RENEW_RETRY_MS,leaseUntil-Date.now()-LEASE_MARGIN_MS));
      });
    },ms);timer.unref();
  };
  watchDeadline();schedule(RENEW_INTERVAL_MS);
  try{
    signal?.throwIfAborted();
    return await active.run({db,id:reservation.id,signal:requestSignal},async()=>{const value=await run();requestSignal.throwIfAborted();return value;});
  }finally{stopped=true;clearTimeout(timer);clearTimeout(deadline);await renewing;await reservation.release();}
}
export async function withBudgetScope<T>(db:Db,scope:string,check:()=>Promise<void>,run:()=>Promise<T>,pool:Pool="meta",usd=HOLD_USD):Promise<T> {return withHold(db,check,run,undefined,usd,undefined,pool,usd,{scope});}
export async function settle(db:Db,id:string,userId:string|null,kind:string,usage:Usage,costUsd:number,now:Date):Promise<boolean> {
  const {rows}=await db.query<{inserted:boolean}>("select spend_settle($1,$2,$3,$4,$5,$6,$7,$8,$9) as inserted",[id,userId,kind,usage.model,usage.inputTokens,usage.outputTokens,usage.searches,money(costUsd),now.toISOString()]);return !!rows[0]?.inserted;
}
export function currentReservation(db:Db):string|undefined {const r=active.getStore();return r?.db===db?r.id:undefined;}
/** Bind provider I/O to the active lease without sharing client state between concurrent requests. */
export const reservedFetch=(base:typeof fetch):typeof fetch => ((input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
  const signal=active.getStore()?.signal;
  return base(input,signal?{...init,signal:init?.signal?AbortSignal.any([init.signal,signal]):signal}:init);
}) as typeof fetch;
