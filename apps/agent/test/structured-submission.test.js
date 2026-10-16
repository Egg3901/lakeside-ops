'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {prepareStructuredSubmission:prepare,calculationInputSchema}=require('../lib/operator/structured-submission');
const job={evidence:[70000,62500]},options={allowCalculations:true};
test('calculation rendering uses the original arithmetic and source evidence guards without mutation',async()=>{
 const input={calculations:[{id:'profit',expression:'70000-62500'},{id:'share',expression:'$profit/70000*100'}],result:{answer:'{{calc.profit}}; {{calc.share:2}}%',facts:{profit:'$calc.profit'},values:['$calc.share']},summary:'Profit {{calc.profit:0}}'};
 const before=JSON.stringify(input),evidence=JSON.stringify(job.evidence),r=await prepare(job,input,options);
 assert.equal(r.result.answer,'7500; 10.71%');assert.equal(r.result.facts.profit,7500);assert.equal(r.summary,'Profit 7500');assert.equal(r.result.values[0],7500/70000*100);
 assert.equal(JSON.stringify(input),before);assert.equal(JSON.stringify(job.evidence),evidence);
 await assert.rejects(prepare(job,{...input,calculations:[{id:'bad',expression:'999999-62500'}]},options),/not in anything/);
 await assert.rejects(prepare(job,input),/calculate tool granted/);
});
test('unknown references, duplicate or forward steps, code and nonfinite output cannot enter a submitted report',async()=>{
 const valid={calculations:[{id:'one',expression:'1'}],result:{answer:'{{calc.missing}}'}};
 await assert.rejects(prepare(job,valid,options),/Unknown inline calculation/);
 await assert.rejects(prepare(job,{...valid,result:{n:'$calc.missing'}},options),/Unknown inline calculation/);
 for(const calculations of [[{id:'x',expression:'$later'}],[{id:'x',expression:'1'},{id:'x',expression:'2'}],[{id:'x',expression:'process.exit()'}],[{id:'x',expression:'1/0'}],[],Array.from({length:33},(_,i)=>({id:'n'+i,expression:'1'}))])await assert.rejects(prepare(job,{...valid,calculations},options));
 for(const answer of ['{{calc.one:11}}','{{calc.one:99}}','{{calc.one:-1}}','{{calc.one:abc}}'])await assert.rejects(prepare(job,{...valid,result:{answer}},options),/precision|placeholder/);
});
test('display precision does not round exact numeric fields; size and depth are bounded',async()=>{
 const input={calculations:[{id:'third',expression:'1/3'}],result:{answer:'{{calc.third:2}}',facts:{third:'$calc.third'}}};
 const r=await prepare(job,input,options);assert.equal(r.result.answer,'0.33');assert.equal(r.result.facts.third,1/3);
 let result={};for(let i=0;i<26;i++)result={next:result};await assert.rejects(prepare(job,{...input,result},options),/structural/);
 await assert.rejects(prepare(job,{...input,result:{answer:'x'.repeat(32001)}},options),/characters/);
});
test('reference input schemas preserve the original result constraints and literal submissions',async()=>{
 const original={type:'object',properties:{count:{type:'integer',minimum:1},nested:{type:'array',items:{type:'number',maximum:10}},text:{type:'string'}},required:['count']};
 const before=JSON.stringify(original),schema=calculationInputSchema(original);
 assert.equal(JSON.stringify(original),before);assert.deepEqual(schema.properties.count.anyOf[0],original.properties.count);
 assert.ok(new RegExp(schema.properties.count.anyOf[1].pattern).test('$calc.count'));assert.equal(schema.properties.nested.items.anyOf[0].maximum,10);assert.deepEqual(schema.properties.text,original.properties.text);
 const literal={result:{answer:'Literal {{calc.name}} without a calculation plan',count:4}};assert.equal((await prepare(job,literal)).result,literal.result);
});
