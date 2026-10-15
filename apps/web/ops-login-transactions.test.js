const { test } = require('node:test');
const assert = require('node:assert/strict');
const { OpsLoginTransactions } = require('./ops-login-transactions');
const origin = 'https://ops.example.test';
const empty = { headers: {} };
const browser = tx => ({ headers: { cookie: tx.cookie.split(';')[0] } });
test('requires independent browser proof and consumes exactly once', () => {
  const store = new OpsLoginTransactions(); const tx = store.start(empty, origin, '/destination', 100);
  assert.match(tx.cookie, /^__Host-ops_login=/); assert.match(tx.cookie, /Secure; HttpOnly; SameSite=Lax/); assert.ok(!tx.cookie.includes('Domain='));
  assert.equal(store.consume(empty, tx.state, origin, 101), null);
  assert.equal(store.consume(browser(tx), tx.state, 'https://other.example.test', 101), null);
  assert.deepEqual(store.consume(browser(tx), tx.state, origin, 101), { next: '/destination' });
  assert.equal(store.consume(browser(tx), tx.state, origin, 101), null);
});
test('wrong browser and duplicate cookies cannot consume a valid transaction', () => {
  const s = new OpsLoginTransactions();const a=s.start(empty,origin),b=s.start(empty,origin);
  assert.equal(s.consume(browser(b),a.state,origin),null);
  assert.equal(s.consume({headers:{cookie:a.cookie.split(';')[0]+'; '+a.cookie.split(';')[0]}},a.state,origin),null);
  assert.ok(s.consume(browser(a),a.state,origin));
});
test('same browser can complete concurrent logins with independent destinations', () => {
  const s=new OpsLoginTransactions();const a=s.start(empty,origin,'/first');const b=s.start(browser(a),origin,'/second');
  assert.equal(browser(a).headers.cookie,browser(b).headers.cookie);
  assert.deepEqual(s.consume(browser(a),b.state,origin),{next:'/second'});
  assert.deepEqual(s.consume(browser(a),a.state,origin),{next:'/first'});
});
test('expiry, malformed state and restart fail closed', () => {
  const s=new OpsLoginTransactions();const a=s.start(empty,origin,'/',0);
  for(const state of [null,undefined,'',a.state+'x'])assert.equal(s.consume(browser(a),state,origin,1),null);
  assert.equal(s.consume(browser(a),a.state,origin,600000),null);
  assert.equal(new OpsLoginTransactions().consume(browser(a),a.state,origin,1),null);
});
test('bounded pending store frees expired slots and stores no raw browser/state secrets', () => {
  const s=new OpsLoginTransactions({capacity:1});const a=s.start(empty,origin,'/',0);
  assert.equal(s.start(empty,origin,'/',1),null);assert.ok(!s.pending.has(a.state));
  assert.ok(!JSON.stringify([...s.pending.values()]).includes(browser(a).headers.cookie.split('=')[1]));
  assert.ok(s.start(empty,origin,'/',600000));
});
