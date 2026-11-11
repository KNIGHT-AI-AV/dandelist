import { expect,it,vi } from "vitest";
import { createApp } from "../src/app";
import type { Db } from "../src/db";

it.each([undefined,false,true])("public feature read reports history=%s without account/database work",async modelHistory=>{
  const query=vi.fn(async()=>{throw new Error("No DB access expected");});
  const exec=vi.fn(async()=>{throw new Error("No DB access expected");});
  const sendCode=vi.fn(async()=>{throw new Error("No email expected");});
  const app=createApp({db:{query,exec} as Db,mailer:{sendCode},jwtSecret:"fixture-secret-over-32-characters-long",codePepper:"fixture-pepper-over-16",now:()=>new Date(),webOrigins:["https://web.fixture.invalid"],modelHistory});
  const response=await app.request("/config/features",{headers:{Origin:"https://web.fixture.invalid"}});
  expect(response.status).toBe(200);expect(await response.json()).toEqual({chatContinuity:modelHistory===true});
  expect(response.headers.get("cache-control")).toBe("public, max-age=60");expect(response.headers.get("access-control-allow-origin")).toBe("https://web.fixture.invalid");
  expect(response.headers.get("set-cookie")).toBe(null);expect(query).not.toHaveBeenCalled();expect(exec).not.toHaveBeenCalled();expect(sendCode).not.toHaveBeenCalled();
});
