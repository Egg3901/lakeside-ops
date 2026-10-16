'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {createToolServer}=require('../lib/operator/toolserver');
const {createBroker}=require('../lib/operator/broker'),{createLedger}=require('../lib/operator/store'),{TOOLS}=require('../lib/operator/agent');
const rpc=(s,method,params)=>fetch(s.url,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}).then(r=>r.json());
const call=(s,name,args)=>rpc(s,'tools/call',{name,arguments:args});
async function fixture(t,sourceReads='focused',tools=TOOLS.filter(x=>['evidence_batch','finish'].includes(x.name))){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'keir-source-tools-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.mkdirSync(dir+'/repo');
 fs.writeFileSync(dir+'/repo/a.ts',Array.from({length:20},(_,i)=>i===16?'export const sentinel = 17;':'// line '+(i+1)).join('\n'));
 fs.writeFileSync(dir+'/repo/b.txt','second file\n');fs.writeFileSync(dir+'/outside.txt','not in task');fs.symlinkSync(dir+'/outside.txt',dir+'/repo/link.txt');
 const ledger=createLedger(dir+'/ledger.json'),job=ledger.createJob('read',{kind:'command',role:'owner',actorId:'owner',internalProbe:true,source:{}});job.state='running';let executions=0;
 const broker=createBroker({ledger,config:{stateDir:dir,ownerId:'owner',staffIds:[],repositories:{}},mcp:{servers:()=>[],call:async()=>{throw Error('external call forbidden')}},discord:async()=>{throw Error('external call forbidden')},sandbox:{run:async(_id,command)=>{executions++;return{code:0,output:cp.execFileSync('bash',['--noprofile','--norc','-c',command],{cwd:dir,encoding:'utf8'})}}}});
 const server=createToolServer({broker,normalizeImage:()=>{},sourceReads}),s=await server.open(job,tools,new AbortController().signal);t.after(()=>{s.close();server.close()});return{s,dir,job,executions:()=>executions};
}
test('focused source reader preserves original lines and batches independent files through the real broker',async t=>{
 const f=await fixture(t),listed=(await rpc(f.s,'tools/list')).result.tools;
 assert.ok(listed.some(x=>x.name==='evidence_batch'),'combined reader remains granted');
 assert.ok(listed.some(x=>x.name==='read_files'),'familiar local read facade is advertised');
 assert.ok(f.s.tools.some(x=>x.name==='read_files'),'provider receives the same advertised grants');
 const response=await call(f.s,'read_files',{files:[{path:'a.ts',line:17,lines:1},{path:'b.txt'}]});assert.equal(response.result.isError,undefined,JSON.stringify(response));
 const result=JSON.parse(response.result.content[0].text);assert.equal(f.executions(),1);assert.equal(result.results[0].excerpt,'17|export const sentinel = 17;');assert.equal(result.results[1].path,'b.txt');assert.match(result.results[0].sha256,/^[a-f0-9]{64}$/);assert.equal(result.trust,'evidence-only');
 assert.equal(f.job.evidenceBatches.length,1);assert.equal(f.job.state,'running');assert.equal(f.s.session.completion,undefined);
});
test('source search preserves actual paths and original line numbers',async t=>{
 const f=await fixture(t),response=await call(f.s,'search_files',{terms:['sentinel'],paths:['a.ts']});assert.equal(response.result.isError,undefined,JSON.stringify(response));
 const row=JSON.parse(response.result.content[0].text).results[0].matches[0];assert.equal(row.line,17);assert.equal(row.citation,'a.ts:17');assert.equal(f.executions(),1);
});
test('focused facades retain path, role and underlying grant boundaries',async t=>{
 const f=await fixture(t),response=await call(f.s,'read_files',{files:[{path:'../outside.txt'},{path:'link.txt'}]});assert.equal(response.result.isError,undefined,JSON.stringify(response));assert.ok(JSON.parse(response.result.content[0].text).results.every(x=>x.error));
 f.job.role='player';const before=f.executions(),denied=await call(f.s,'read_files',{files:[{path:'a.ts'}]});assert.equal(denied.result.isError,true);assert.equal(f.executions(),before);
 const noGrant=await fixture(t,'focused',TOOLS.filter(x=>x.name==='finish'));assert.ok(!noGrant.s.tools.some(x=>x.name==='read_files'));assert.equal((await call(noGrant.s,'read_files',{files:[{path:'a.ts'}]})).result.isError,true);assert.equal(noGrant.executions(),0);
});
test('local source facades reject arbitrary service operations and malformed requests before execution',async t=>{
 const f=await fixture(t);
 for(const input of [{files:[]},{files:Array.from({length:9},()=>({path:'a.ts'}))},{files:[{path:'a.ts',op:'service',server:'support',tool:'support_reply'}]},{files:[{path:'a.ts',line:0}]},{files:[{path:'a.ts',lines:361}]},{files:[{}]},{files:[{path:'a.ts'}],server:'support'}])assert.equal((await call(f.s,'read_files',input)).result.isError,true);
 for(const input of [{terms:[]},{terms:['x']},{terms:['sentinel'],op:'service'},{terms:['sentinel'],maxMatches:41}])assert.equal((await call(f.s,'search_files',input)).result.isError,true);
 assert.equal(f.executions(),0);
});
test('focused source tools are opt-in and cannot override an explicitly granted tool name',async t=>{
 const base=await fixture(t,'combined');assert.ok(base.s.tools.some(x=>x.name==='evidence_batch'));assert.ok(!base.s.tools.some(x=>x.name==='read_files'));
 const tools=[...TOOLS.filter(x=>x.name==='evidence_batch'),{name:'read_files',description:'preexisting grant',input_schema:{type:'object'}}];const f=await fixture(t,'focused',tools);assert.equal(f.s.tools.filter(x=>x.name==='read_files').length,1);assert.equal(f.s.tools.find(x=>x.name==='read_files').description,'preexisting grant');
 const response=await call(f.s,'read_files',{files:[{path:'a.ts'}]});assert.equal(response.result.isError,true);assert.equal(f.executions(),0);
});
