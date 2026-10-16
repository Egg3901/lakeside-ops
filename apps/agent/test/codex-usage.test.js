'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createCodexUsage}=require('../../cli/headless/codex-usage');
const payload=(attrs)=>({resourceLogs:[{scopeLogs:[{logRecords:[{attributes:Object.entries(attrs).map(([key,value])=>({key,value:{stringValue:String(value)}}))}]}]}]});
test('Codex response meter matches turn semantics, deduplicates, excludes warmup and never persists identity',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-usage-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=dir+'/usage.jsonl',m=await createCodexUsage(file);t.after(m.close);
 const base={'event.kind':'response.completed',input_token_count:100,output_token_count:10,cached_token_count:20,'event.timestamp':'first','conversation.id':'private-id','user.email':'secret@example.invalid',ttft_ms:20};
 a.equal((await fetch(m.endpoint+'/wrong',{method:'POST',body:'{}'})).status,404);
 // A real warmup has neither an effort nor a ttft attribute.
 const warm={...base,output_token_count:0};delete warm.ttft_ms;await fetch(m.endpoint,{method:'POST',body:JSON.stringify(payload(warm))});m.observe(payload(warm));
 m.observe(payload(base));m.observe(payload(base));m.observe(payload({...base,'event.timestamp':'second',input_token_count:150,cached_token_count:70,output_token_count:5}));
 a.deepEqual(m.totals(),{input_tokens:250,output_tokens:15,cache_read_input_tokens:90});a.equal(m.count(),2);
 m.observe(payload({...base,'event.timestamp':'bad',input_token_count:'-10'}));a.equal(m.rejected(),1);
 const text=fs.readFileSync(file,'utf8');a.doesNotMatch(text,/secret|private-id|user.email|conversation/);
});
