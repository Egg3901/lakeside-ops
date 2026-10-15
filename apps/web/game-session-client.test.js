const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLegacyAhdVerifier, LegacySessionUnavailable } = require('./game-session-client');
const config = { origin: 'https://game.example', cookieName: 'auth-token-main-site' };
const now = Math.floor(Date.now() / 1000);
const valid = { active: true, sub: 'a'.repeat(24), username: 'fixture', iat: now - 5, exp: now + 60 };
const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
test('forwards only the exact deployment cookie to the pinned issuer', async () => {
  let calls = 0;
  const verify = createLegacyAhdVerifier(config, async (url, options) => {
    calls++;
    assert.equal(url, 'https://game.example/api/auth/session');
    assert.equal(options.headers.Cookie, 'auth-token-main-site=opaque');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal);
    return json({ ...valid, email: 'contact@example.test', isAdmin: true, emailVerified: true });
  });
  const result = await verify('ops_session=secret; auth-token-sandbox-staging=other; auth-token-main-site=opaque');
  assert.deepEqual(result, { identity: { provider: 'ahd', id: valid.sub, username: 'fixture', email: 'contact@example.test' }, issuedAt: valid.iat, expiresAt: valid.exp });
  assert.equal(calls, 1);
});
for (const cookie of [undefined, '', 'auth-token-sandbox-staging=x', 'auth-token-main-site=', 'auth-token-main-site=x; auth-token-main-site=y', `auth-token-main-site=${'x'.repeat(8193)}`, 'auth-token-main-site=x\r\ny']) {
  test(`rejects invalid cookie shape ${String(cookie).slice(0, 55)}`, async () => {
    const verify = createLegacyAhdVerifier(config, () => { throw Error('must not fetch'); });
    assert.equal(await verify(cookie), null);
  });
}
test('inactive issuer response returns no identity', async () => {
  assert.equal(await createLegacyAhdVerifier(config, async () => new Response('', { status: 401 }))('auth-token-main-site=x'), null);
});
for (const patch of [{ active: false }, { sub: 'invalid' }, { iat: undefined }, { exp: undefined }, { exp: now - 1 }, { iat: now + 120 }, { iat: 1.5 }, { email: true }]) {
  test(`fails closed on invalid issuer claims ${JSON.stringify(patch)}`, async () => {
    await assert.rejects(createLegacyAhdVerifier(config, async () => json({ ...valid, ...patch }))('auth-token-main-site=x'), LegacySessionUnavailable);
  });
}
for (const reply of [() => new Response('', { status: 503 }), () => new Response('', { status: 302 }), () => new Response('{}'), () => json({ ...valid, extra: 'x'.repeat(16385) }), () => { throw Error('network'); }]) {
  test('issuer outage or malformed response fails closed', async () => {
    await assert.rejects(createLegacyAhdVerifier(config, async () => reply())('auth-token-main-site=x'), LegacySessionUnavailable);
  });
}
test('rejects unsafe issuer configuration', () => {
  for (const origin of ['http://game.example', 'https://user:pass@game.example', 'https://game.example/path', 'https://game.example/?query=x']) {
    assert.throws(() => createLegacyAhdVerifier({ ...config, origin }));
  }
  assert.throws(() => createLegacyAhdVerifier({ ...config, cookieName: 'auth-token-*' }));
});
