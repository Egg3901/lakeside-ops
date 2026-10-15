'use strict';
const crypto = require('node:crypto');
const COOKIE = '__Host-ops_login';
const TTL_MS = 10 * 60 * 1000;
const SHAPE = /^[a-zA-Z0-9_-]{43}$/;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

function browserToken(req) {
  const values = String(req.headers.cookie || '').split(';').map(x => x.trim())
    .filter(x => x.startsWith(COOKIE + '='))
    .map(x => x.slice(COOKIE.length + 1));
  return values.length === 1 && SHAPE.test(values[0]) ? values[0] : null;
}

// A restart expires pending logins, not established Ops sessions. Callback
// state and the browser secret are independent; neither alone can redeem.
class OpsLoginTransactions {
  constructor({ capacity = 10000 } = {}) { this.pending = new Map(); this.capacity = capacity; }
  start(req, origin, next = '/', now = Date.now()) {
    for (const [key, row] of this.pending) if (row.expires <= now) this.pending.delete(key);
    if (this.pending.size >= this.capacity) return null;
    const browser = browserToken(req) || crypto.randomBytes(32).toString('base64url');
    const state = crypto.randomBytes(32).toString('base64url');
    this.pending.set(digest(state), { browser: digest(browser), origin, next, expires: now + TTL_MS });
    return { state, cookie: `${COOKIE}=${browser}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600` };
  }
  consume(req, state, origin, now = Date.now()) {
    if (typeof state !== 'string' || !SHAPE.test(state)) return null;
    const key = digest(state);
    const row = this.pending.get(key);
    if (!row) return null;
    if (row.expires <= now) { this.pending.delete(key); return null; }
    const browser = browserToken(req);
    if (!browser || row.origin !== origin || !crypto.timingSafeEqual(Buffer.from(digest(browser)), Buffer.from(row.browser))) return null;
    this.pending.delete(key);
    return { next: row.next };
  }
}
module.exports = { OpsLoginTransactions };
