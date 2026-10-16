const {test}=require('node:test'),assert=require('node:assert/strict');const {claim,complete}=require('./src/queue.cjs');
test('claim respects priority',()=>{const jobs=[{id:'a',state:'queued',priority:1,createdAt:1},{id:'b',state:'queued',priority:3,createdAt:2}];assert.equal(claim(jobs,10,20,'t').id,'b');});
test('stale worker cannot complete',()=>{const jobs=[{id:'a',state:'running',leaseToken:'new',leaseUntil:30}];assert.equal(complete(jobs,'a','old','bad'),false);assert.equal(jobs[0].state,'running');});
