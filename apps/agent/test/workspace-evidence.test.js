"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),cp=require("node:child_process");
const {queryWorkspace,evidenceCommand}=require("../lib/operator/workspace-evidence");
test('adaptive numbered reads use the byte budget rather than forcing sixty-line pages',()=>{
 const root=path.resolve(__dirname,'../../cli/bench/fixtures/01-reconcile-deliveries');
 const file='source/src/lib/military/defenceLotEconomics.ts';
 const response=queryWorkspace(root,[{op:'read',path:file}],{format:'numbered'}),result=response.results[0];
 assert.equal(result.encoding,'numbered-source-v1');
 const rows=result.excerpt.split('\n');assert.ok(rows.length>180);assert.ok(rows.length<=360);
 const source=fs.readFileSync(path.join(root,file),'utf8').split('\n');
 for(let i=0;i<rows.length;i++)assert.equal(rows[i],`${i+1}|${source[i]}`);
 assert.equal(result.nextLine,rows.length+1);assert.equal(result.truncated,true);
 assert.ok(Buffer.byteLength(JSON.stringify(response))<19000);
 const batch=queryWorkspace(root,[{op:'read',path:file},{op:'read',path:'evidence/world.json'}],{format:'numbered'});
 assert.ok(batch.results.every(x=>x.excerpt));assert.equal(batch.results[1].truncated,false);
});
test("batch searches and reads produce real defining lines and source hashes",t=>{
 const root=path.resolve(__dirname,"../../cli/bench/fixtures/03-single-fact");
 const result=queryWorkspace(root,[{op:"search",terms:["DEFENCE_FACTORY_SLOTS_PER_PLANT"],paths:["defenceLotEconomics.ts"]},{op:"read",path:"source/src/lib/military/defenceLotEconomics.ts",line:356,lines:1}]);
 const row=result.results[1].lines[0];assert.equal(row.line,356);assert.match(row.text,/= 4;/);assert.equal(result.results[1].path+":"+row.line,"source/src/lib/military/defenceLotEconomics.ts:356");assert.match(result.results[1].sha256,/^[a-f0-9]{64}$/);assert.ok(result.results[0].matches.some(x=>x.line===356));
});
test("task evidence rejects traversal and symlink escape and never executes query text",t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"keir-evidence-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.mkdirSync(dir+"/repo");fs.writeFileSync(dir+"/secret","outside");fs.symlinkSync(dir+"/secret",dir+"/repo/link");fs.writeFileSync(dir+"/repo/file.txt","literal $(touch PWNED)\n");
 const escaped=queryWorkspace(dir+"/repo",[{op:"read",path:"../secret"},{op:"read",path:"link"}]);assert.ok(escaped.results.every(x=>x.error));
 const command=evidenceCommand([{op:"search",terms:["$(touch PWNED)"]}]);assert.ok(command.length<16000);
 const result=JSON.parse(cp.execFileSync("bash",["--noprofile","--norc","-c",command],{cwd:dir,encoding:"utf8"}));assert.equal(result.results[0].matches.length,1);assert.equal(fs.existsSync(dir+"/repo/PWNED"),false);
});
test("natural word searches find equivalent snake and camel case identifiers without another read",()=>{
 const root=path.resolve(__dirname,"../../cli/bench/fixtures/03-single-fact");
 const result=queryWorkspace(root,[{op:"search",terms:["factory slots"],paths:["defenceLotEconomics.ts"]}]).results[0];
 assert.ok(result.matches.some(x=>x.line===356&&/= 4;/.test(x.text)));
 assert.match(result.sources["source/src/lib/military/defenceLotEconomics.ts"],/^[a-f0-9]{64}$/);
});
test("partial source reads expose symbol locations and an explicit continuation",()=>{
 const root=path.resolve(__dirname,"../../cli/bench/fixtures/03-single-fact");
 const result=queryWorkspace(root,[{op:"read",path:"source/src/lib/military/defenceLotEconomics.ts"}]).results[0];
 assert.equal(result.nextLine,61);
 assert.ok(result.outline.some(x=>x.line===318&&x.symbol==='lotPriceBand'));
 assert.ok(result.outline.some(x=>x.line===356&&x.symbol==='DEFENCE_FACTORY_SLOTS_PER_PLANT'));
});
test("oversized evidence is explicitly bounded without cutting JSON or losing query errors",t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"keir-evidence-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.writeFileSync(dir+"/huge","x".repeat(40000));
 const result=queryWorkspace(dir,[{op:"read",path:"huge"},{op:"read",path:"missing"}]);assert.equal(result.results[0].truncated,true);assert.ok(result.results[1].error);assert.ok(JSON.stringify(result).length<20000);
});
test('one evidence batch retrieves requested pricing definitions without paging unrelated source',()=>{
 const root=path.resolve(__dirname,'../../cli/bench/fixtures/01-reconcile-deliveries'),file='source/src/lib/military/defenceLotEconomics.ts';
 const names=['legacyLotProductionCost','contractLotProductionCost','lotCostIndex','lotProductionCost'];
 const result=queryWorkspace(root,names.map(symbol=>({op:'read',path:file,symbol})));
 for(let i=0;i<names.length;i++){
  const r=result.results[i];assert.equal(r.error,undefined);assert.match(r.lines[0].text,new RegExp('^export function '+names[i]+'\\('));assert.equal(r.truncated,false);assert.ok(r.lines.length>2);assert.ok(r.windowEndLine>=r.lines.at(-1).line);
 }
 assert.ok(Buffer.byteLength(JSON.stringify(result))<18000);
});

test('named windows preserve bounds, reject ambiguity and execute in the actual sandbox command',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'keir-symbol-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.mkdirSync(dir+'/repo');
 fs.writeFileSync(dir+'/repo/sample.ts','/**\nexport function fake() {}\n*/\nexport function target() {\n'+Array.from({length:140},(_,i)=>'  // line '+i).join('\n')+'\n}\nexport const after = 3;\n');
 const first=queryWorkspace(dir+'/repo',[{op:'read',path:'sample.ts',symbol:'target',lines:5}]).results[0];assert.equal(first.lines[0].line,4);assert.equal(first.nextLine,9);assert.equal(first.truncated,true);
 const next=queryWorkspace(dir+'/repo',[{op:'read',path:'sample.ts',symbol:'target',line:first.nextLine,lines:120}]).results[0];assert.equal(next.lines[0].line,9);assert.ok(next.lines.length<=120);
 assert.match(queryWorkspace(dir+'/repo',[{op:'read',path:'sample.ts',symbol:'fake'}]).results[0].error,/not found/);
 fs.writeFileSync(dir+'/repo/duplicate.ts','export function repeated();\nexport function repeated() {}\n');assert.match(queryWorkspace(dir+'/repo',[{op:'read',path:'duplicate.ts',symbol:'repeated'}]).results[0].error,/ambiguous/);
 const result=JSON.parse(cp.execFileSync('bash',['--noprofile','--norc','-c',evidenceCommand([{op:'read',path:'sample.ts',symbol:'after'}])],{cwd:dir,encoding:'utf8'}));assert.match(result.results[0].lines[0].text,/after = 3/);assert.equal(result.results[0].truncated,false);
});
