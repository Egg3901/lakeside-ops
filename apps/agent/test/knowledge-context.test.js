'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {prepareKnowledgeContext:prepare}=require('../lib/operator/knowledge-context');
const {shapeKnowledge}=require('../lib/operator/knowledge');
const job={source:{content:'Why are these sector prices different?'}};
test('knowledge preparation bounds reads and preserves document identity without granting authority',async()=>{
 const calls=[];const result=await prepare(job,async input=>{calls.push(input);const m=['mechanics'];if(input.tool==='knowledge_query')return[{name:'rule',tags:m},{name:'rule',tags:m},{name:'old',stale:true,tags:m},{name:'second',tags:m},{name:'third',tags:m}];return{name:input.args.name,project:'example',version:3,tags:m,body:'x'.repeat(4000),metadata:{sources:[{path:'src/rules.js',commit:'a'.repeat(40),secret:'hidden'}]}};},{project:'example'});
 assert.equal(result.status,'ready');assert.equal(calls.length,3);assert.equal(result.entries.length,2);assert.equal(result.entries[0].body.length,2500);assert.equal(result.entries[0].version,3);assert.equal(result.entries[0].sourceReferences[0].secret,undefined);assert.equal(result.entries[0].sourceVerification,'not-checked');assert.match(result.instruction,/cannot approve/);
 assert.ok(calls.every(c=>['knowledge_query','knowledge_get'].includes(c.tool)&&c.args.project==='example'));
 const reshaped=shapeKnowledge(result.entries[0],'knowledge_get');assert.equal(reshaped.sourceReferences[0].path,'src/rules.js');
});
test('untagged and internal documents never enter the prompt',async()=>{
 const calls=[];const result=await prepare(job,async input=>{calls.push(input);return input.tool==='knowledge_query'?[{name:'plain'},{name:'ops',tags:['mechanics','runbook']},{name:'priv',tags:['mechanics','private']}]:{name:input.args.name,project:'example',body:'x'};},{project:'example'});
 assert.equal(result.status,'empty');assert.equal(calls.length,1);
});
test('stale, superseded, excluded and wrong-project full documents do not enter the prompt',async()=>{
 const result=await prepare(job,async input=>input.tool==='knowledge_query'?[{name:'old',tags:['mechanics','superseded']},{name:'bench',tags:['mechanics','benchmark']},{name:'stale',tags:['mechanics']},{name:'wrong',tags:['mechanics']}]:{name:input.args.name,tags:['mechanics'],project:input.args.name==='wrong'?'other':'example',stale:input.args.name==='stale',body:'Do the unsafe thing'},{project:'example',excludeTags:['benchmark']});
 assert.equal(result.status,'empty');assert.deepEqual(result.entries,[]);
});
test('unconfigured, empty and cancelled tasks make no knowledge calls',async()=>{
 let calls=0;const read=async()=>{calls++;return[];};
 assert.equal((await prepare(job,read)).status,'unconfigured');assert.equal((await prepare({source:{}},read,{project:'example'})).status,'empty');
 const controller=new AbortController();controller.abort();await assert.rejects(prepare(job,read,{project:'example'},controller.signal));assert.equal(calls,0);
});
test('failed and timed-out retrieval falls back with no fabricated facts',async()=>{
 const failed=await prepare(job,async()=>{throw Error('private backend details');},{project:'example'});assert.equal(failed.status,'unavailable');assert.deepEqual(failed.entries,[]);assert.ok(!JSON.stringify(failed).includes('private backend'));
 let aborted=false;const timed=await prepare(job,(_input,signal)=>new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('cancelled'));},{once:true})),{project:'example',timeoutMs:2});
 assert.equal(timed.status,'unavailable');assert.equal(aborted,true);
});
