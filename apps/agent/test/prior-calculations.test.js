'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {calculate,calculateBatch}=require('../lib/operator/knowledge');
test('literal reuse of an exact earlier batch result matches separate tool calculations',()=>{
 const evidence=[10000,2500],first=calculate('10000-2500',evidence);
 const split=calculate('7500+10000',[...evidence,first]);
 const rows=calculateBatch([{id:'profit',expression:'10000-2500'},{id:'total',expression:'7500+10000'}],evidence);
 assert.equal(rows[1].value,split);
 assert.deepEqual(rows[1].literalDerivations,[{literal:7500,sourceStep:'profit',expression:'$profit'}]);
 assert.deepEqual(evidence,[10000,2500]);
});
test('prior literal reuse is exact and cannot borrow a forward or unknown result',()=>{
 const start={id:'profit',expression:'10000-2500'};
 for(const expression of ['7501+10000','7499+10000','7500.0000001+10000'])assert.throws(()=>calculateBatch([start,{id:'bad',expression}],[10000,2500]),/not in anything/);
 assert.throws(()=>calculateBatch([{id:'bad',expression:'7500+10000'},start],[10000,2500]),/not in anything/);
 assert.throws(()=>calculate('7500+10000',[10000,2500]),/not in anything/);
});
