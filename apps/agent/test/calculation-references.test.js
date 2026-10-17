'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {calculate,calculateBatch}=require('../lib/operator/knowledge');
const {prepareStructuredSubmission:prepare,calculationInputSchema}=require('../lib/operator/structured-submission');
test('numeric result references accept the same $step spelling used in expressions',async()=>{
 const job={evidence:[70000,62500]},input={calculations:[{id:'profit',expression:'70000-62500'}],result:{profit:'$profit',canonical:'$calc.profit',answer:'Profit {{calc.profit}}'}};
 const result=await prepare(job,input,{allowCalculations:true});
 assert.equal(result.result.profit,7500);assert.equal(result.result.canonical,7500);assert.equal(result.result.answer,'Profit 7500');
 const schema=calculationInputSchema({type:'number'});assert.ok(new RegExp(schema.anyOf[1].pattern).test('$profit'));
 await assert.rejects(prepare(job,{...input,result:{profit:'$unknown'}},{allowCalculations:true}),/Unknown inline calculation/);
 await assert.rejects(prepare(job,input),/calculate tool granted/);
 assert.equal((await prepare(job,{result:{profit:'$profit'}})).result.profit,'$profit');
});
test('bare arithmetic names can only reference already successful steps',()=>{
 const rows=calculateBatch([{id:'profit',expression:'70000-62500'},{id:'double',expression:'profit*2'},{id:'floor',expression:'floor(double/7000)'}],[70000,62500,7000]);
 assert.equal(rows[1].value,15000);assert.equal(rows[2].value,2);
 assert.throws(()=>calculateBatch([{id:'profit',expression:'next*2'},{id:'next',expression:'2'}],[]),/Unknown prior calculation/);
 assert.throws(()=>calculate('profit*2',[]),/Unknown prior calculation/);
 for(const expr of ['process.exit()','constructor(1)','profit.constructor','globalThis','profit=1'])assert.throws(()=>calculate(expr,[]));
});
