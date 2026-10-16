"use strict";
function createEvidenceCache({load,ttlMs,now=Date.now}){
 const entries=new Map();
 async function get(key){
  const hit=entries.get(key);if(hit&&now()-hit.at<ttlMs)return hit.value;
  const value=await load(key);entries.set(key,{value,at:now()});return value;
 }
 return{get,invalidate:key=>entries.delete(key),clear:()=>entries.clear()};
}
module.exports={createEvidenceCache};
