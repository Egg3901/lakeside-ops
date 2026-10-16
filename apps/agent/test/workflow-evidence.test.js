"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),cp=require("node:child_process");
const {createLedger}=require("../lib/operator/store"),{createWorkflowEvidence}=require("../lib/operator/workflow-evidence"),{createBroker}=require("../lib/operator/broker");
test("one sandbox execution batches independent source reads and durable receipts reopen after reload",async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"keir-workflow-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.mkdirSync(dir+"/repo");fs.writeFileSync(dir+"/repo/test.js","const slots = 4;\nconst cost = 10;\n");
 const ledger=createLedger(dir+"/ledger.json"),job=ledger.createJob("fixture",{kind:"command",role:"owner"});job.state="running";let executions=0;
 const deps={stateDir:dir,ledger,sandbox:{run:async(_id,command)=>{executions++;return{code:0,output:cp.execFileSync("bash",["--noprofile","--norc","-c",command],{cwd:dir,encoding:"utf8"})}}}};
 const response=await createWorkflowEvidence(deps).collect(job,{queries:[{op:"read",path:"test.js",line:1,lines:1},{op:"read",path:"test.js",line:2,lines:1},{op:"search",terms:["slots"]}]});
 assert.equal(executions,1);assert.equal(response.results.length,3);assert.match(response.results[0].lines[0].text,/slots = 4/);
 const loaded=createLedger(dir+"/ledger.json"),restored=loaded.data.jobs[job.id];
 const prior=await createWorkflowEvidence({...deps,ledger:loaded}).collect(restored,{queries:[{op:"receipt",receipt:response.receipt}]});
 assert.equal(executions,1);assert.equal(prior.results[0].historical,true);assert.deepEqual(prior.results[0].results,response.results);
 const foreign=await createWorkflowEvidence(deps).collect(job,{queries:[{op:"receipt",receipt:"../../ledger"}]});assert.match(foreign.results[0].error,/outside this task/);
});
test("batched service reads preserve broker and child-worker scope restrictions",async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"keir-workflow-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const ledger=createLedger(dir+"/ledger.json");let external=0;
 const broker=createBroker({ledger,config:{ownerId:"owner",staffIds:[],stateDir:dir,repositories:{}},sandbox:{},discord:async()=>{external++;throw Error("unexpected")},mcp:{servers:()=>[],call:async()=>{external++;throw Error("unexpected")}}});
 const job=ledger.createJob("fixture",{kind:"command",role:"support",actorId:"owner",internalProbe:true,source:{}});job.state="running";
 const result=await broker.tool(job,"evidence_batch",{queries:[{op:"service",server:"support",tool:"support_reply",args:{text:"unauthorized"}}]});assert.ok(result.results[0].error);assert.equal(external,0);
 job.role="owner";job.codingParent=ledger.createJob("parent",{kind:"command",role:"owner",actorId:"owner",source:{}}).id;
 const child=await broker.tool(job,"evidence_batch",{queries:[{op:"service",server:"gamestate",tool:"game_overview"}]});assert.match(child.results[0].error,/Coding subworkers/);assert.equal(external,0);
 job.role="player";await assert.rejects(broker.tool(job,"evidence_batch",{queries:[{op:"catalog",server:"gamestate"}]}));assert.equal(external,0);
});
