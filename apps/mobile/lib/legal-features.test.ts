import { createElement } from "react";
import { act,create,type ReactTestRenderer } from "react-test-renderer";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import type { LegalDocument } from "../components/legal";
import { PRIVACY,PRIVACY_UPDATED,TERMS,TERMS_UPDATED } from "./legal";
import copy from "./drafts/copy.json";

(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({clientHistory:false,documents:undefined as LegalDocument[]|undefined}));
vi.mock("./auth",()=>({API_URL:"https://public.fixture.invalid/"}));
vi.mock("./drafts/features",()=>({DRAFT_FEATURES:{get MODEL_HISTORY_ENABLED(){return h.clientHistory;},ENTITLEMENTS_ENABLED:false}}));
vi.mock("expo-router",()=>({useLocalSearchParams:()=>({})}));
vi.mock("@dandelist/catalogue",()=>({entries:[]}));
vi.mock("react-native",()=>({Text:"Text",View:"View"}));
vi.mock("./theme",()=>({layout:{stack:{section:24,base:16}},type:{},usePalette:()=>({}),useType:()=>({})}));
vi.mock("../components/lux",()=>({Hairline:()=>null}));
vi.mock("../components/photo-credit",()=>({PhotoCredit:()=>null}));
vi.mock("../components/legal",()=>({LegalPage:({documents}:{documents:LegalDocument[]})=>{
  h.documents=documents;return createElement("Policy",null,documents.flatMap(d=>d.sections.flatMap(s=>[s.heading,...s.body])));
}}));
const {default:Legal}=await import("../app/legal");
const request=vi.fn(async(_url:unknown,_init?:RequestInit)=>Response.json({chatContinuity:false}));
let root:ReactTestRenderer|undefined;
beforeEach(()=>{h.clientHistory=false;h.documents=undefined;request.mockReset();request.mockImplementation(async()=>Response.json({chatContinuity:false}));vi.stubGlobal("fetch",request);});
afterEach(async()=>{await act(async()=>root?.unmount());root=undefined;vi.useRealTimers();vi.unstubAllGlobals();});
const mount=async()=>{await act(async()=>{root=create(createElement(Legal));});};
const today=()=>{
  expect(h.documents?.[0]?.sections).toBe(PRIVACY);expect(h.documents?.[1]?.sections).toBe(TERMS);
  expect(h.documents?.[0]?.updated).toBe(PRIVACY_UPDATED);expect(h.documents?.[1]?.updated).toBe(TERMS_UPDATED);
};
const continuity=()=>{
  expect(h.documents?.[0]?.sections).toContainEqual({id:"chat-continuity",heading:copy.legal.privacyHeading,body:copy.legal.privacyBody});
  expect(h.documents?.[1]?.sections).toContainEqual({id:"chat-continuity-terms",heading:copy.legal.termsHeading,body:copy.legal.termsBody});
  expect(JSON.stringify(root?.toJSON())).toContain(copy.legal.privacyHeading);
  expect(h.documents?.[0]?.sections.slice(0,PRIVACY.length)).toEqual(PRIVACY);
};
it("server on shows the continuity sections in the legal page without a client flag",async()=>{request.mockResolvedValueOnce(Response.json({chatContinuity:true}));await mount();continuity();});
it("server off shows today's text and dates exactly",async()=>{await mount();today();});
it("network failure shows today's text",async()=>{request.mockRejectedValueOnce(new Error("fixture offline"));await mount();today();});
it("HTTP failure shows today's text",async()=>{request.mockResolvedValueOnce(new Response(null,{status:503}));await mount();today();});
it("malformed feature data cannot turn the legal section on",async()=>{request.mockResolvedValueOnce(Response.json({chatContinuity:"true"}));await mount();today();});
it("loading leaves today's text visible, then adds the sections on a positive reply",async()=>{
  let complete!:(response:Response)=>void;request.mockImplementationOnce(()=>new Promise<Response>(resolve=>{complete=resolve;}));
  await mount();today();await act(async()=>complete(Response.json({chatContinuity:true})));continuity();
});
it.each(["off","unavailable"])("client draft override still shows the sections when server is %s",async state=>{
  h.clientHistory=true;if(state==="unavailable")request.mockRejectedValueOnce(new Error("fixture offline"));await mount();continuity();
});
it("makes a public credential-free GET without using the account API",async()=>{
  await mount();expect(request).toHaveBeenCalledWith("https://public.fixture.invalid/config/features",expect.objectContaining({method:"GET",credentials:"omit",headers:{Accept:"application/json"}}));
  expect(request.mock.calls[0]?.[1]?.headers).not.toHaveProperty("Authorization");
});
it("an already open page follows a later server flag change",async()=>{
  vi.useFakeTimers();request.mockResolvedValueOnce(Response.json({chatContinuity:false})).mockResolvedValueOnce(Response.json({chatContinuity:true}));
  await mount();today();await act(async()=>{await vi.advanceTimersByTimeAsync(60_000);});continuity();expect(request).toHaveBeenCalledTimes(2);
});
it("times out without hiding today's text and cancels all timers on unmount",async()=>{
  vi.useFakeTimers();request.mockImplementationOnce(()=>new Promise<Response>(()=>{}));await mount();today();
  await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);today();
  await act(async()=>root?.unmount());root=undefined;expect(vi.getTimerCount()).toBe(0);
});
it("ignores a reply arriving after the legal page unmounts",async()=>{
  let complete!:(response:Response)=>void;request.mockImplementationOnce(()=>new Promise<Response>(resolve=>{complete=resolve;}));
  await mount();const documents=h.documents;await act(async()=>root?.unmount());root=undefined;
  await act(async()=>complete(Response.json({chatContinuity:true})));expect(h.documents).toBe(documents);
});
