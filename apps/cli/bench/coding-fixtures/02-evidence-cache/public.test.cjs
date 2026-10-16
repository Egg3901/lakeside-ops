const {test}=require('node:test'),assert=require('node:assert/strict');const {createEvidenceCache}=require('./src/cache.cjs');
test('concurrent calls share a load',async()=>{let count=0;const cache=createEvidenceCache({load:async()=>{count++;return 4},ttlMs:10});assert.deepEqual(await Promise.all([cache.get('a'),cache.get('a')]),[4,4]);assert.equal(count,1);});
test('cached undefined is a valid value',async()=>{let count=0;const cache=createEvidenceCache({load:async()=>{count++},ttlMs:10});await cache.get('a');await cache.get('a');assert.equal(count,1);});
