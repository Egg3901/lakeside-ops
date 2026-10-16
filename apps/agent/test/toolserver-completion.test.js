"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createToolServer}=require("../lib/operator/toolserver");
async function fixture(t,tool){const server=createToolServer({broker:{tool},normalizeImage:()=>{throw Error("unused")}});const session=await server.open({id:"test"},[{name:"finish"},{name:"shell"}],new AbortController().signal);t.after(()=>{session.close();server.close()});return session;}
const call=(s,name,input={})=>fetch(s.url,{method:"POST",body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name,arguments:input}})}).then(r=>r.json());
test("accepted finish publishes an authenticated receipt and closes further tool execution",async t=>{
 let calls=0;const s=await fixture(t,async()=>{calls++;return{state:"waiting"}});
 assert.equal(s.completionUrl,s.url+"/completion");
 const pending=fetch(s.completionUrl,{signal:AbortSignal.timeout(2000)}).then(r=>r.json());
 await call(s,"finish",{state:"done",summary:"Verified findings"});
 const receipt=await pending;assert.equal(receipt.state,"waiting");assert.equal(receipt.summary,"Verified findings");assert.equal(receipt.version,1);
 assert.equal((await call(s,"shell")).result.isError,true);assert.equal(calls,1);
 assert.equal((await fetch(s.completionUrl.replace(/[a-f0-9]{48}/,"0".repeat(48)))).status,404);
});
test("a rejected finish never produces a completion receipt",async t=>{
 const s=await fixture(t,async()=>{throw Error("approval still pending")});
 assert.equal((await call(s,"finish")).result.isError,true);
 await assert.rejects(fetch(s.completionUrl,{signal:AbortSignal.timeout(50)}));
 assert.equal(s.session.completion,undefined);
});
test("finish cannot race an active tool",async t=>{
 let release,started;const ready=new Promise(r=>started=r),work=new Promise(r=>release=r);
 const s=await fixture(t,async(_j,name)=>{if(name==="shell"){started();await work;return{code:0}}return{state:"done"}});
 t.after(()=>release());const pending=call(s,"shell");await ready;
 assert.equal((await call(s,"finish",{state:"done"})).result.isError,true);assert.equal(s.session.completion,undefined);
 release();await pending;assert.equal((await call(s,"finish",{state:"done"})).result.isError,undefined);
});
test('verified edit completion uses the same active-tool fence and accepted receipt',async t=>{
 let release,started;const ready=new Promise(r=>started=r),work=new Promise(r=>release=r),job={id:'test',state:'running',codingContract:{allowCompleteOnPass:true}};
 const server=createToolServer({broker:{tool:async(_job,name)=>{if(name==='shell'){started();await work;return{code:0}}job.state='done';return{passed:true,finished:{state:'done',summary:'checked patch'}}}},normalizeImage:()=>{}}),s=await server.open(job,[{name:'shell'},{name:'edit_verify'}],new AbortController().signal);t.after(()=>{release();s.close();server.close()});
 const pending=call(s,'shell');await ready;assert.equal((await call(s,'edit_verify',{complete:true})).result.isError,true);assert.equal(job.state,'running');release();await pending;
 assert.equal((await call(s,'edit_verify',{complete:true})).result.isError,undefined);const receipt=await fetch(s.completionUrl).then(r=>r.json());assert.equal(receipt.summary,'checked patch');assert.equal(receipt.state,'done');assert.equal((await call(s,'shell')).result.isError,true);
});
test('structured submission cannot race an active tool or run twice after acceptance',async t=>{
 let release,started;const ready=new Promise(r=>started=r),work=new Promise(r=>release=r);let finishes=0;
 const server=createToolServer({broker:{tool:async(_job,name)=>{if(name==='shell'){started();await work;return{code:0}}finishes++;return{state:'done'}}},normalizeImage:()=>{}}),s=await server.open({resultSchema:{type:'object'}},[{name:'finish',input_schema:{type:'object'}},{name:'shell'}],new AbortController().signal);t.after(()=>{release();s.close();server.close()});
 const pending=call(s,'shell');await ready;
 assert.equal((await call(s,'submit_result',{result:{answer:'ready'}})).result.isError,true);assert.equal(finishes,0);assert.equal(s.session.completion,undefined);
 release();await pending;assert.equal((await call(s,'submit_result',{result:{answer:'verified'}})).result.isError,undefined);assert.equal(finishes,1);
 assert.equal((await call(s,'submit_result',{result:{answer:'duplicate'}})).result.isError,true);assert.equal(finishes,1);
});
