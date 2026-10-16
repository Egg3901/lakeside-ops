"use strict";
const http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs');
// Local OTLP sink: retain only numeric usage, never prompts, account metadata or credentials.
async function createCodexUsage(file){
 const token=crypto.randomBytes(24).toString('hex'),seen=new Set(),events=[];let rejected=0,lastAt=0;
 const integer=x=>{const n=typeof x==='number'?x:typeof x==='string'&&/^\d+$/.test(x)?Number(x):NaN;return Number.isSafeInteger(n)&&n>=0?n:null;};
 function observe(data){for(const resource of data.resourceLogs||[])for(const scope of resource.scopeLogs||[])for(const log of scope.logRecords||[]){
  const a=Object.fromEntries((log.attributes||[]).map(x=>[x.key,x.value?.stringValue??x.value?.intValue??x.value?.doubleValue??x.value?.boolValue]));
  if(a['event.kind']!=='response.completed'||a.input_token_count===undefined)continue;
  const input=integer(a.input_token_count),output=integer(a.output_token_count),cached=integer(a.cached_token_count);
  if(input===null||output===null||cached===null||cached>input){rejected++;continue;}
  // Codex prefill warmups are absent from its authoritative turn totals.
  if(output===0&&a.ttft_ms===undefined&&a.model_reasoning_effort===undefined)continue;
  const stamp=a['event.timestamp']||log.timeUnixNano;if(!stamp){rejected++;continue;}
  const digest=crypto.createHash('sha256').update(JSON.stringify([stamp,a['conversation.id'],input,output,cached])).digest('hex');
  if(seen.has(digest))continue;seen.add(digest);lastAt=Date.now();events.push({digest,input_tokens:input,output_tokens:output,cached_input_tokens:cached});
  fs.appendFileSync(file,JSON.stringify(events.at(-1))+'\n',{mode:0o600});
 }}
 const server=http.createServer(async(req,res)=>{if(req.method!=='POST'||req.url!=='/'+token){res.writeHead(404).end();return;}let chunks=[],size=0;try{for await(const b of req){size+=b.length;if(size>2e6){res.writeHead(413).end();return;}chunks.push(b);}observe(JSON.parse(Buffer.concat(chunks)));res.setHeader('Content-Type','application/json');res.end('{}');}catch{res.writeHead(400).end();}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 return{endpoint:'http://127.0.0.1:'+server.address().port+'/'+token,
  settle:async()=>{const end=Date.now()+250;while(Date.now()<end&&(!events.length||Date.now()-lastAt<25))await new Promise(r=>setTimeout(r,5));},
  totals:()=>events.length?{input_tokens:events.reduce((n,e)=>n+e.input_tokens,0),output_tokens:events.reduce((n,e)=>n+e.output_tokens,0),cache_read_input_tokens:events.reduce((n,e)=>n+e.cached_input_tokens,0)}:null,
  count:()=>events.length,rejected:()=>rejected,close:()=>{server.closeAllConnections();server.close();},observe};
}
module.exports={createCodexUsage};
