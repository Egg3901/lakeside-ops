"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {createLedger}=require("../lib/operator/store"),{createBroker}=require("../lib/operator/broker"),{createToolServer}=require("../lib/operator/toolserver");
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),"keir-result-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const ledger=createLedger(dir+"/ledger.json"),job=ledger.createJob("typed",{kind:"command",role:"owner",actorId:"owner",internalProbe:true,source:{}});job.state="running";job.resultSchema={type:"object",properties:{answer:{type:"string"},facts:{type:"object",required:["count"]}},required:["answer","facts"]};const broker=createBroker({ledger,config:{ownerId:"owner",staffIds:[],stateDir:dir,repositories:{}},mcp:{servers:()=>[]},sandbox:{},discord:async()=>{throw Error("unexpected external call")}});return{dir,ledger,job,broker};}
test("done requires the trusted result contract and persists the artifact atomically with finish",async t=>{
 const f=fixture(t);await assert.rejects(f.broker.tool(f.job,"finish",{state:"done",summary:"sounds complete"}),/result/);assert.equal(f.job.state,"running");
 await assert.rejects(f.broker.tool(f.job,"finish",{state:"done",summary:"partial",result:{answer:"partial",facts:{}}}),/count/);assert.equal(f.job.state,"running");
 const result={answer:"verified",facts:{count:4}};await f.broker.tool(f.job,"finish",{state:"done",summary:"verified",result});
 const saved=createLedger(f.dir+"/ledger.json").data.jobs[f.job.id];assert.equal(saved.state,"done");assert.deepEqual(saved.result,result);assert.match(saved.resultReceipt.sha256,/^[a-f0-9]{64}$/);
});
test("blocked tasks need no fabricated result and the task schema is advertised in finish",async t=>{
 const f=fixture(t),server=createToolServer({broker:f.broker,normalizeImage:()=>{}}),session=await server.open(f.job,[{name:"finish",description:"finish",input_schema:{type:"object",properties:{state:{type:"string"},summary:{type:"string"}}}}],new AbortController().signal);t.after(()=>{session.close();server.close()});
 const response=await fetch(session.url,{method:"POST",body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list"})}).then(r=>r.json());assert.deepEqual(response.result.tools[0].inputSchema.properties.result,f.job.resultSchema);
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
