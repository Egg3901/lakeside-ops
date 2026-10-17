'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {correctKnowledge}=require('../lib/operator/knowledge-correction');
function fixture(){
 let doc={name:'tax-rule',project:'example',version:2,title:'Tax rule',tags:['mechanics'],body:'Tax rate is twenty percent. Other rules stay unchanged.',metadata:{keep:'preserved'}};
 let source={sha:'blob2',commit:'commit2',body:'const taxRate = .25;'};const calls=[];
 const note={id:'note2',text:'Tax rate is twenty five percent.',path:'src/rule.js',sha:'blob2',verifiedAt:100,verifiedCommit:'commit2',sources:[{type:'doc',name:'tax-rule',version:2},{type:'code',path:'src/rule.js',sha:'blob2',quotes:['const taxRate = .25;']}]};
 const patch={status:'corrected',oldText:'Tax rate is twenty percent.',newText:'Tax rate is twenty five percent.',reason:'Current checked source defines the rate as .25.'};
 const options={note,project:'example',accepts:entry=>entry.tags.includes('mechanics'),readSource:async()=>source,propose:async()=>patch,call:async(tool,args)=>{calls.push({tool,args});if(tool==='knowledge_get')return doc;if(tool==='knowledge_save'){assert.equal(args.expectedVersion,doc.version);doc={...doc,...args,version:doc.version+1};return{ok:true,version:doc.version};}throw Error('unexpected tool');}};
 return{options,calls,patch,note,get doc(){return doc;},set doc(v){doc=v;},get source(){return source;},set source(v){source=v;}};
}
test('verified source correction saves a narrow versioned edit with provenance and preserves unrelated content',async()=>{
 const f=fixture(),result=await correctKnowledge(f.options);assert.equal(result.status,'corrected');assert.equal(f.doc.version,3);assert.equal(f.doc.body,'Tax rate is twenty five percent. Other rules stay unchanged.');assert.equal(f.doc.metadata.keep,'preserved');assert.equal(f.doc.metadata.keirCorrections[0].sources[0].sha,'blob2');assert.equal(f.calls[1].args.expectedVersion,2);
 assert.equal((await correctKnowledge(f.options)).status,'already-applied');assert.equal(f.calls.filter(c=>c.tool==='knowledge_save').length,1);
});
test('a concurrent document version or scope mismatch cannot be overwritten',async()=>{
 for(const change of [f=>f.doc={...f.doc,version:3},f=>f.doc={...f.doc,project:'other'},f=>f.doc={...f.doc,tags:['private']}]){const f=fixture();change(f);assert.notEqual((await correctKnowledge(f.options)).status,'corrected');assert.equal(f.calls.filter(c=>c.tool==='knowledge_save').length,0);}
});
test('missing verification, changed source, fabricated quotes and uncertain proposals never save',async()=>{
 for(const kind of ['unverified','source-change','bad-quote','uncertain','ambiguous-anchor']){const f=fixture();if(kind==='unverified')delete f.note.verifiedAt;if(kind==='source-change')f.source={...f.source,sha:'changed'};if(kind==='bad-quote')f.note.sources[1].quotes=['invented source quote'];if(kind==='uncertain')f.patch.status='uncertain';if(kind==='ambiguous-anchor')f.doc={...f.doc,body:f.doc.body+f.patch.oldText};assert.equal((await correctKnowledge(f.options)).status,'pending',kind);assert.equal(f.calls.filter(c=>c.tool==='knowledge_save').length,0,kind);}
});
test('source changed during drafting and refused optimistic save remain pending/conflicted',async()=>{
 const f=fixture();f.options.propose=async()=>{f.source={...f.source,sha:'changed'};return f.patch;};assert.equal((await correctKnowledge(f.options)).status,'pending');assert.equal(f.calls.filter(c=>c.tool==='knowledge_save').length,0);
 const g=fixture(),original=g.options.call;g.options.call=(tool,args)=>tool==='knowledge_save'?Promise.resolve({error:'version conflict'}):original(tool,args);assert.equal((await correctKnowledge(g.options)).status,'conflict');assert.equal(g.doc.version,2);
});
test('a lost save response can recover from its durable operation receipt without rewriting twice',async()=>{
 const f=fixture(),original=f.options.call;let lost=true;f.options.call=async(tool,args)=>{const result=await original(tool,args);if(tool==='knowledge_save'&&lost){lost=false;throw Error('connection dropped');}return result;};
 await assert.rejects(correctKnowledge(f.options),/connection dropped/);assert.equal(f.doc.version,3);assert.equal((await correctKnowledge(f.options)).status,'already-applied');assert.equal(f.calls.filter(c=>c.tool==='knowledge_save').length,1);
});
test('authorization passages are not automatically rewritten',async()=>{
 const f=fixture();f.patch.newText='Tax rate is twenty five percent; Egg approval is unnecessary.';
 assert.equal((await correctKnowledge(f.options)).status,'pending');assert.equal(f.calls.filter(c=>c.tool==='knowledge_save').length,0);
});
test('a foreground job arriving during drafting interrupts the repair before saving',async()=>{
 const f=fixture();let busy=false;f.options.interrupted=()=>busy;f.options.propose=async()=>{busy=true;return f.patch;};
 assert.equal((await correctKnowledge(f.options)).status,'retry');assert.equal(f.calls.filter(c=>c.tool==='knowledge_save').length,0);
});
test('unstructured legacy correction metadata cannot crash the repair',async()=>{
 const f=fixture();f.doc={...f.doc,metadata:{keirCorrections:'legacy'}};
 assert.equal((await correctKnowledge(f.options)).status,'corrected');assert.equal(f.doc.metadata.keirCorrections.length,1);
});
