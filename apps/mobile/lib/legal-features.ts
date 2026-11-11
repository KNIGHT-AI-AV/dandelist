import { useEffect,useMemo,useState } from "react";
import { API_URL } from "./auth";
import { DRAFT_FEATURES } from "./drafts/features";
import { legalDocuments } from "./drafts/legal";

/** Deployment flag, never account data. Refresh lets an open legal page follow a server flag change. */
export function useLegalDocuments(clientHistory=DRAFT_FEATURES.MODEL_HISTORY_ENABLED){
  const [serverHistory,setServerHistory]=useState(false);
  useEffect(()=>{
    let live=true;
    let pending:AbortController|undefined;
    let requestTimer:ReturnType<typeof setTimeout>|undefined;
    const refresh=async()=>{
      if(pending)return;
      const controller=new AbortController();pending=controller;
      const timeout=setTimeout(()=>{controller.abort();if(live&&pending===controller){pending=undefined;setServerHistory(false);}},5000);
      requestTimer=timeout;
      try{
        const response=await fetch(API_URL.replace(/\/+$/,"")+"/config/features",{
          method:"GET",headers:{Accept:"application/json"},credentials:"omit",cache:"default",signal:controller.signal,
        });
        if(!response.ok)throw new Error("Feature configuration unavailable");
        const body=await response.json() as {chatContinuity?:unknown}|null;
        if(live&&pending===controller&&!controller.signal.aborted)setServerHistory(body?.chatContinuity===true);
      }catch{if(live&&pending===controller)setServerHistory(false);}
      finally{clearTimeout(timeout);if(requestTimer===timeout)requestTimer=undefined;if(pending===controller)pending=undefined;}
    };
    void refresh();
    const poll=setInterval(()=>void refresh(),60_000);
    return ()=>{live=false;clearInterval(poll);clearTimeout(requestTimer);pending?.abort();};
  },[]);
  return useMemo(()=>legalDocuments(clientHistory||serverHistory),[clientHistory,serverHistory]);
}
