"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {createLedger}=require("../lib/operator/store"),{createBroker}=require("../lib/operator/broker"),{createToolServer}=require("../lib/operator/toolserver");
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),"keir-result-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const ledger=createLedger(dir+"/ledger.json"),job=ledger.createJob("typed",{kind:"command",role:"owner",actorId:"owner",internalProbe:true,source:{}});job.state="running";job.resultSchema={type:"object",properties:{answer:{type:"string"},facts:{type:"object",required:["count"]}},required:["answer","facts"]};const broker=createBroker({ledger,config:{ownerId:"owner",staffIds:[],stateDir:dir,repositories:{}},mcp:{servers:()=>[]},sandbox:{},discord:async()=>{throw Error("unexpected external call")}});return{dir,ledger,job,broker};}
test('structured completion exposes a required-result submission instead of an optional finish argument',async t=>{
 const f=fixture(t),server=createToolServer({broker:f.broker,normalizeImage:()=>{}}),session=await server.open(f.job,[{name:'finish',description:'finish',input_schema:{type:'object',properties:{state:{type:'string'},summary:{type:'string'}},required:['state','summary']}}],new AbortController().signal);t.after(()=>{session.close();server.close()});
 const rpc=(method,params)=>fetch(session.url,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}).then(r=>r.json());
 const listed=(await rpc('tools/list')).result.tools,submit=listed.find(t=>t.name==='submit_result');assert.ok(submit);
 assert.deepEqual(submit.inputSchema.required,['result']);assert.deepEqual(submit.inputSchema.properties.result,f.job.resultSchema);
 assert.ok(session.tools.some(t=>t.name==='submit_result'));
 assert.equal((await rpc('tools/call',{name:'finish',arguments:{state:'done',summary:'ready'}})).result.isError,true);assert.equal(f.job.state,'running');
 assert.equal((await rpc('tools/call',{name:'submit_result',arguments:{}})).result.isError,true);assert.equal(f.job.state,'running');assert.equal(session.session.completion,undefined);
 const result={answer:'Verified answer',facts:{count:4}};
 assert.equal((await rpc('tools/call',{name:'submit_result',arguments:{result,summary:''}})).result.isError,undefined);
 assert.equal(f.job.state,'done');assert.deepEqual(f.job.result,result);
 const receipt=await fetch(session.completionUrl).then(r=>r.json());assert.equal(receipt.summary,'Verified answer');assert.equal(receipt.resultDigest,f.job.resultReceipt.sha256);
});
test('structured submission cannot grant completion when finish was not granted',async t=>{
 let calls=0;const server=createToolServer({broker:{tool:async()=>{calls++;return{state:'done'}}},normalizeImage:()=>{}}),session=await server.open({resultSchema:{type:'object'}},[{name:'shell'}],new AbortController().signal);t.after(()=>{session.close();server.close()});
 assert.equal(session.tools.some(t=>t.name==='submit_result'),false);
 const response=await fetch(session.url,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'submit_result',arguments:{result:{}}}})}).then(r=>r.json());
 assert.equal(response.result.isError,true);assert.equal(calls,0);
});
test('submission uses original finish guards and a blocked outcome needs no fabricated result',async t=>{
 const names=[];const server=createToolServer({broker:{tool:async(_job,name,input)=>{names.push(name);if(input.state==='done')throw Error('approval still pending');return{state:'blocked'}}},normalizeImage:()=>{}}),session=await server.open({resultSchema:{type:'object'}},[{name:'finish',input_schema:{type:'object'}}],new AbortController().signal);t.after(()=>{session.close();server.close()});
 const call=(name,input)=>fetch(session.url,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:input}})}).then(r=>r.json());
 const refused=await call('submit_result',{result:{answer:'ready'}});assert.equal(refused.result.isError,true);assert.match(refused.result.content[0].text,/approval still pending/);assert.equal(session.session.completion,undefined);assert.deepEqual(names,['finish']);
 assert.equal((await call('finish',{state:'blocked',summary:'Approval needed'})).result.isError,undefined);const receipt=await fetch(session.completionUrl).then(r=>r.json());assert.equal(receipt.state,'blocked');assert.equal(receipt.summary,'Approval needed');
});
test("done requires the trusted result contract and persists the artifact atomically with finish",async t=>{
 const f=fixture(t);await assert.rejects(f.broker.tool(f.job,"finish",{state:"done",summary:"sounds complete"}),/result/);assert.equal(f.job.state,"running");
 await assert.rejects(f.broker.tool(f.job,"finish",{state:"done",summary:"partial",result:{answer:"partial",facts:{}}}),/count/);assert.equal(f.job.state,"running");
 const result={answer:"verified",facts:{count:4}};await f.broker.tool(f.job,"finish",{state:"done",summary:"verified",result});
 const saved=createLedger(f.dir+"/ledger.json").data.jobs[f.job.id];assert.equal(saved.state,"done");assert.deepEqual(saved.result,result);assert.match(saved.resultReceipt.sha256,/^[a-f0-9]{64}$/);
});
test("blocked tasks need no fabricated result and the task schema is advertised in submission",async t=>{
 const f=fixture(t),server=createToolServer({broker:f.broker,normalizeImage:()=>{}}),session=await server.open(f.job,[{name:"finish",description:"finish",input_schema:{type:"object",properties:{state:{type:"string"},summary:{type:"string"}}}}],new AbortController().signal);t.after(()=>{session.close();server.close()});
 const response=await fetch(session.url,{method:"POST",body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list"})}).then(r=>r.json());assert.deepEqual(response.result.tools.find(t=>t.name==='submit_result').inputSchema.properties.result,f.job.resultSchema);
 await f.broker.tool(f.job,"finish",{state:"blocked",summary:"missing evidence"});assert.equal(f.job.result,undefined);
});
test("a required evidence contract refuses empty or unlocated citations before accepting done",async t=>{
 const f=fixture(t);f.job.resultSchema.properties.evidence={type:"array",minItems:3,items:{type:"object",properties:{path:{type:"string"},line:{type:"integer",minimum:1},claim:{type:"string"}},required:["path","line","claim"]}};
 f.job.resultSchema.required.push("evidence");const base={answer:"verified",facts:{count:4}};
 await assert.rejects(f.broker.tool(f.job,"finish",{state:"done",summary:"empty evidence",result:{...base,evidence:[]}}),/few items/);
 assert.equal(f.job.state,"running");
 await assert.rejects(f.broker.tool(f.job,"finish",{state:"done",summary:"unlocated",result:{...base,evidence:Array.from({length:3},()=>({path:"source.ts",claim:"supported"}))}}),/line/);
 assert.equal(f.job.state,"running");
 await f.broker.tool(f.job,"finish",{state:"done",summary:"located evidence",result:{...base,evidence:[1,2,3].map(line=>({path:"source.ts",line,claim:"supported"}))}});
 assert.equal(f.job.state,"done");
});
