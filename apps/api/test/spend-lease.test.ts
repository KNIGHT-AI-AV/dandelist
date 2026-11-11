import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Db } from "../src/db";
import { HOLD_TTL_MS, SLOT_WAIT_MS, reservedFetch, withHold } from "../src/spend-reservations";

beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(0);vi.spyOn(Math,"random").mockReturnValue(.5);});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
const database=(renew:()=>Promise<boolean>,slots=false)=>{
  const attempts:number[]=[];
  const query=vi.fn(async(sql:string)=>{
    if(sql.includes("spend_reserve")){attempts.push(Date.now());return {rows:[{result:slots?"slots":"ok"}]};}
    if(sql.includes("spend_renew"))return {rows:[{ok:await renew()}]};
    return {rows:[]};
  });
  return {db:{query,exec:async()=>{}} as unknown as Db,query,attempts};
};
function providerCall(db:Db){
  let complete!:()=>void,signal!:AbortSignal;
  const base=vi.fn((_input:unknown,init?:RequestInit)=>new Promise<Response>((resolve,reject)=>{
    signal=init!.signal!;complete=()=>resolve(new Response("fixture"));
    signal.addEventListener("abort",()=>reject(signal.reason),{once:true});
  })) as unknown as typeof fetch;
  const result=withHold(db,async()=>{},()=>reservedFetch(base)("https://provider.fixture.invalid"));
  // Observe rejection immediately, including when fake timers abort the provider.
  const outcome=result.then(value=>({value,error:undefined}),error=>({value:undefined,error}));
  return {outcome,complete:()=>complete(),signal:()=>signal};
}
it("continues the provider call after one transient renewal error and retries successfully",async()=>{
  const renew=vi.fn<()=>Promise<boolean>>().mockRejectedValueOnce(new Error("temporary DB failure")).mockResolvedValue(true);
  const {db,query}=database(renew);const call=providerCall(db);await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(HOLD_TTL_MS/3);expect(renew).toHaveBeenCalledTimes(1);expect(call.signal().aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(15_000);expect(renew).toHaveBeenCalledTimes(2);expect(call.signal().aborted).toBe(false);
  // Past the original deadline: the confirmed retry extended the lease.
  await vi.advanceTimersByTimeAsync(HOLD_TTL_MS-215_000);expect(call.signal().aborted).toBe(false);
  call.complete();expect((await call.outcome).error).toBeUndefined();
  expect(query.mock.calls.some(([sql])=>sql.includes("spend_release"))).toBe(true);expect(vi.getTimerCount()).toBe(0);
});
it("aborts the in-flight provider immediately when renewal reports a lost lease",async()=>{
  const {db}=database(async()=>false);const call=providerCall(db);await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(HOLD_TTL_MS/3);
  expect(call.signal().aborted).toBe(true);expect((await call.outcome).error).toMatchObject({message:"Reservation lease lost"});expect(vi.getTimerCount()).toBe(0);
});
it("tolerates repeated errors only until the last confirmed lease approaches expiry",async()=>{
  const renew=vi.fn(async()=>{throw new Error("DB unavailable");});const {db}=database(renew);const call=providerCall(db);await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(HOLD_TTL_MS-30_001);expect(renew.mock.calls.length).toBeGreaterThan(2);expect(call.signal().aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);expect((await call.outcome).error).toMatchObject({message:"Reservation lease lost"});expect(vi.getTimerCount()).toBe(0);
});
it("backs slot polls off from 50 to 500 ms and enforces the overall 20 second deadline",async()=>{
  const {db,attempts}=database(async()=>true,true);const run=vi.fn(async()=>"bad");
  const outcome=withHold(db,async()=>{},run,"fixture").catch(error=>error);
  await vi.advanceTimersByTimeAsync(1250);expect(attempts).toEqual([0,50,150,350,750,1250]);
  await vi.advanceTimersByTimeAsync(SLOT_WAIT_MS-1251);expect(attempts.length).toBeLessThan(50);expect(run).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);expect(await outcome).toMatchObject({scope:"user"});expect(attempts.every(t=>t<SLOT_WAIT_MS)).toBe(true);expect(vi.getTimerCount()).toBe(0);
});
it("cancels a caller during slot backoff without another poll or provider call",async()=>{
  const {db,attempts}=database(async()=>true,true);const stop=new AbortController(),run=vi.fn(async()=>"bad");
  const outcome=withHold(db,async()=>{},run,"fixture",.1,stop.signal).catch(error=>error);
  await vi.advanceTimersByTimeAsync(350);expect(attempts).toHaveLength(4);stop.abort(new Error("fixture canceled"));
  expect(await outcome).toMatchObject({message:"fixture canceled"});await vi.advanceTimersByTimeAsync(SLOT_WAIT_MS);
  expect(attempts).toHaveLength(4);expect(run).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
