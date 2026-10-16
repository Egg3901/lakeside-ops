"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),cp=require("node:child_process");
const {queryWorkspace,evidenceCommand}=require("../lib/operator/workspace-evidence");
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
