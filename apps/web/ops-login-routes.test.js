const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = process.env.OPS_AUTH_TEST_ROOT || __dirname;
const source = fs.readFileSync(path.join(root,'server.js'),'utf8');
const { OpsLoginTransactions } = require(path.join(root,'ops-login-transactions.js'));
const host='ops.example.test';
function harness({redeemError=false, provider='ahd', staff=true}={}) {
  const calls={redeem:0,mint:0};
  const context={URL,OpsLoginTransactions,OPS_SSO_HOSTS:[host,'other.example.test'],LAKESIDE_AUTH_AHD_ORIGIN:'https://auth.example.test',
    require:()=>({OpsLoginTransactions,stateTag:()=>'t'}),console:{warn:()=>{},log:()=>{}},cookieDomainFor:()=>'',addSecurityHeaders:()=>{},
    safeNextUrl:raw=>{try{const u=new URL(raw);return u.origin==='https://'+host?u.toString():null;}catch{return null;}},
    getLakesideAuthClient:()=>({loginUrl:(_p,callback)=>'https://auth.example.test/auth/ahd?return='+encodeURIComponent(callback),redeem:async()=>{calls.redeem++;if(redeemError)throw Error('outage');return {identity:{provider,id:'a'.repeat(24),email:'staff@example.test'}};}}),
    resolveSession:async req=>/(?:^|; )ops_session=existing/.test(req.headers.cookie||'')?{role:'admin'}:null,
    resolveStaffFromAhdUser:async()=>staff?{email:'staff@example.test',role:'admin'}:null,
    mintOpsSession:(res,_staff,next)=>{calls.mint++;res.writeHead(302,{'Set-Cookie':'ops_session=new; Secure; HttpOnly',Location:next});res.end();},
  };
  const helpers=source.slice(source.indexOf('const { OpsLoginTransactions'),source.indexOf('function mintOpsSession'));
  const routes=source.slice(source.indexOf('  if (req.method === "GET" && pathname === "/auth/game")'),source.indexOf('  // POST /api/login'));
  vm.runInNewContext(helpers+'\nthis.handle=async function(req,res){const pathname=new URL(req.url,"https://placeholder").pathname;'+routes+'};',context);
  async function request(url,cookie='',requestHost=host){const res={headers:{},status:200,body:'',setHeader(k,v){this.headers[k.toLowerCase()]=v;},writeHead(status,headers={}){this.status=status;for(const [k,v]of Object.entries(headers))this.setHeader(k,v);},end(body=''){this.body=body;}};await context.handle({method:'GET',url,headers:{host:requestHost,cookie}},res);return res;}
  async function start(next=''){const res=await request('/auth/game'+(next?'?next='+encodeURIComponent(next):''));const callback=new URL(new URL(res.headers.location).searchParams.get('return'));return {res,state:callback.searchParams.get('state'),cookie:res.headers['set-cookie'][0].split(';')[0]};}
  return {calls,request,start};
}
test('login starts with state and host-only browser cookie, no-store and no-referrer',async()=>{
 const h=harness(),a=await h.start();assert.equal(a.res.status,302);assert.equal(a.state.length,43);assert.match(a.cookie,/^__Host-ops_login=/);assert.equal(a.res.headers['cache-control'],'private, no-store');assert.equal(a.res.headers['referrer-policy'],'no-referrer');assert.ok(a.res.headers['set-cookie'][1].includes('Max-Age=0'));
});
test('unsolicited and duplicate callback parameters never redeem a code',async()=>{
 const h=harness();for(const url of ['/auth/callback?code=x','/auth/callback?code=x&code=y&state=bad','/auth/callback?code=x&state=bad&state=bad']){const r=await h.request(url,'ops_session=existing');assert.equal(r.status,400);assert.equal(r.headers['set-cookie'],undefined);}
 // An unmatched callback from a browser that is already signed in goes home; it still redeems and mints nothing.
 const replay=await h.request('/auth/callback?code=x&state=bad','ops_session=existing');assert.equal(replay.status,302);assert.equal(replay.headers.location,'/');assert.equal(replay.headers['set-cookie'],undefined);
 assert.equal((await h.request('/auth/callback?code=x&state=bad')).status,400);assert.equal(h.calls.redeem,0);assert.equal(h.calls.mint,0);
});
test('wrong browser or host cannot consume a callback, correct browser can',async()=>{
 const h=harness(),a=await h.start('https://'+host+'/agents');const url='/auth/callback?code=one&state='+a.state;
 assert.equal((await h.request(url)).status,400);assert.equal((await h.request(url,a.cookie,'other.example.test')).status,400);assert.equal(h.calls.redeem,0);
 const r=await h.request(url,a.cookie);assert.equal(r.status,302);assert.equal(r.headers.location,'https://'+host+'/agents');assert.equal(h.calls.mint,1);
 assert.equal((await h.request(url,a.cookie)).status,400);assert.equal(h.calls.redeem,1);
});
test('a callback is consumed before asynchronous redemption',async()=>{
 const h=harness(),a=await h.start();const url='/auth/callback?code=one&state='+a.state;
 const responses=await Promise.all([h.request(url,a.cookie),h.request(url,a.cookie)]);assert.deepEqual(responses.map(r=>r.status).sort(),[302,400]);assert.equal(h.calls.redeem,1);
});
test('redemption outage preserves existing session and cannot replay the transaction',async()=>{
 const h=harness({redeemError:true}),a=await h.start();const url='/auth/callback?code=one&state='+a.state;const r=await h.request(url,a.cookie+'; ops_session=existing');assert.equal(r.status,503);assert.equal(r.headers['set-cookie'],undefined);assert.equal((await h.request(url,a.cookie)).status,400);assert.equal(h.calls.mint,0);
});
test('wrong provider and failed staff authorization cannot mint a session',async()=>{
 for(const options of [{provider:'discord'},{staff:false}]){const h=harness(options),a=await h.start();const r=await h.request('/auth/callback?code=one&state='+a.state,a.cookie);assert.equal(r.status,302);assert.equal(r.headers['set-cookie'],undefined);assert.equal(h.calls.mint,0);}
});
test('untrusted Host cannot mint a login transaction',async()=>{const h=harness();for(const x of ['attacker.example','ops.example.test:444','ops.example.test@attacker.example'])assert.equal((await h.request('/auth/game','',x)).status,400);});
test('old cross-host handoff starts a new transaction on the intended host',async()=>{
 const h=harness();const r=await h.request('/auth/handoff?return='+encodeURIComponent('https://other.example.test/auth/callback?code=attacker'));assert.equal(r.status,302);assert.equal(r.headers.location,'https://other.example.test/auth/game');assert.equal(h.calls.redeem,0);
 for(const target of ['https://attacker.example/auth/callback','https://user@other.example.test/auth/callback','https://other.example.test:444/auth/callback','https://other.example.test/auth/callback#x'])assert.equal((await h.request('/auth/handoff?return='+encodeURIComponent(target))).status,400);
});
test('stale continuation cookie cannot affect the new transaction destination',async()=>{const h=harness(),a=await h.start('https://attacker.example/');const r=await h.request('/auth/callback?code=one&state='+a.state,a.cookie+'; ops_next=https%3A%2F%2Fattacker.example');assert.equal(r.headers.location,'/');});
test('sign-in failures render an HTML page with a restart link instead of a downloadable body',async()=>{
 const h=harness(),a=await h.start();const r=await h.request('/auth/callback?code=one&state='+a.state);
 assert.equal(r.status,400);assert.equal(r.headers['content-type'],'text/html; charset=utf-8');assert.match(r.body,/<!doctype html>/);assert.match(r.body,/href="\/auth\/game"/);assert.match(r.body,/same browser/);
 const o=harness({redeemError:true}),b=await o.start();const u=await o.request('/auth/callback?code=one&state='+b.state,b.cookie);
 assert.equal(u.status,503);assert.equal(u.headers['content-type'],'text/html; charset=utf-8');assert.match(u.body,/Start sign-in again/);
 const bad=await h.request('/auth/game','','attacker.example');assert.equal(bad.headers['content-type'],'text/html; charset=utf-8');
});
