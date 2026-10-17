import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connectVps } from "./vps-profile.mjs";
import { discoverVps } from "./integrations/vps-discovery.mjs";
import { startMcpProbe } from "./test-support/mcp-probe.mjs";
function fixture(t, options={}) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'keir-discover-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const env={LAKESIDE_CODE_CONFIG_DIR:root},file=path.join(root,'token'),token='a'.repeat(64);fs.writeFileSync(file,token);
 connectVps('https://ops.example',file,env,options);return{env,token,file};
}
const response=(id,result,headers={})=>new Response(JSON.stringify({jsonrpc:'2.0',id,result}),{headers:{'content-type':'application/json',...headers}});
test('one token discovers gateway services and remote project names without exposing credentials or paths',async t=>{
 const f=fixture(t),seen=[];
 const value=await discoverVps(f.env,{fetchImpl:async(url,options)=>{
  assert.equal(String(url),'https://ops.example/api/keir/app/desktop/mcp');assert.equal(options.headers.Cookie,`ops_session=${f.token}`);assert.equal(options.redirect,'error');
  const m=JSON.parse(options.body);seen.push(m.method);
  if(m.method==='initialize')return response(m.id,{protocolVersion:'2025-06-18'},{'mcp-session-id':'session1'});
  assert.equal(options.headers['Mcp-Session-Id'],'session1');
  if(m.method==='notifications/initialized')return new Response(null,{status:202});
  if(m.method==='tools/list')return response(m.id,{tools:[{name:'vps_status'},{name:'vps_read'}]});
  return response(m.id,{content:[{type:'text',text:JSON.stringify({projects:{game:'/srv/private/game'},services:['ops-knowledge'],sentryConfigured:true})}]});
 }});
 assert.equal(value.state,'connected');assert.deepEqual(value.projects,['game']);assert.deepEqual(value.services,['ops-knowledge']);assert.equal(value.sentryConfigured,true);
 assert.deepEqual(seen,['initialize','notifications/initialized','tools/list','tools/call']);assert.ok(!JSON.stringify(value).includes(f.token));assert.ok(!JSON.stringify(value).includes('/srv/private'));
});
test('generic bearer MCP works against a real HTTP server and does not receive Keir calls',async t=>{
 const f=fixture(t,{kind:'mcp',auth:'bearer'}),probe=await startMcpProbe(f.token);t.after(()=>probe.close());connectVps(probe.url,f.file,f.env,{kind:'mcp',auth:'bearer'});
 const value=await discoverVps(f.env);assert.equal(value.state,'connected');assert.deepEqual(value.tools,['local_probe']);assert.equal(probe.observed.has('tools/call'),false);
});
test('auth failures and missing credentials give safe recovery without erasing configuration',async t=>{
 const f=fixture(t),before=fs.readFileSync(path.join(f.env.LAKESIDE_CODE_CONFIG_DIR,'vps.json'),'utf8');
 const result=await discoverVps(f.env,{fetchImpl:async()=>new Response(f.token,{status:401})});assert.equal(result.errorKind,'auth');assert.ok(!JSON.stringify(result).includes(f.token));
 fs.rmSync(f.file);assert.equal((await discoverVps(f.env)).state,'offline');assert.equal(fs.readFileSync(path.join(f.env.LAKESIDE_CODE_CONFIG_DIR,'vps.json'),'utf8'),before);
});
test('SSE responses support pagination and stop after the matching event without waiting for stream closure',async t=>{
 const f=fixture(t,{kind:'mcp'});let lists=0;
 const result=await discoverVps(f.env,{fetchImpl:async(_url,options)=>{
  const m=JSON.parse(options.body);if(m.id===undefined)return new Response(null,{status:202});
  const value=m.method==='initialize'?{protocolVersion:'2025-06-18'}:++lists===1?{tools:[{name:'first'}],nextCursor:'page2'}:{tools:[{name:'second'}]};
  const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(`event: message\r\ndata: ${JSON.stringify({jsonrpc:'2.0',id:m.id,result:value})}\r\n\r\n`));}});
  return new Response(stream,{headers:{'content-type':'text/event-stream'}});
 }});assert.equal(result.state,'connected');assert.deepEqual(result.tools,['first','second']);assert.equal(result.discoveryComplete,true);
});
test('slow or cancelled probes terminate and unconfigured installs perform no network IO',async t=>{
 const f=fixture(t);const result=await discoverVps(f.env,{timeoutMs:10,fetchImpl:async(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('abort')),{once:true}))});assert.equal(result.errorKind,'timeout');
 const empty={LAKESIDE_CODE_CONFIG_DIR:path.join(f.env.LAKESIDE_CODE_CONFIG_DIR,'empty')};assert.equal((await discoverVps(empty,{fetchImpl:()=>{throw Error('must not call');}})).state,'unconfigured');
});
