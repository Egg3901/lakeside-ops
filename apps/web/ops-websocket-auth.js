const crypto = require('node:crypto');
function credentialKeys(req) {
  return (req.headers.cookie || '').split(';').map(v => v.trim())
    .filter(v => v.startsWith('ops_session=') || v.startsWith('auth-token-main-site='))
    .map(v => crypto.createHash('sha256').update(v).digest('hex'));
}
function allowedBrowserOrigin(req, hosts) {
  try {
    const origin = new URL(req.headers.origin);
    return origin.protocol === 'https:' && origin.origin === req.headers.origin &&
      hosts.includes(origin.host) && hosts.includes(String(req.headers.host || '').toLowerCase());
  } catch { return false; }
}
function principal(session) {
  if (!session || session.role !== 'admin') return null;
  if (session.source === 'game' && session.userId) return `game:${session.userId}`;
  if (session.source === 'local' && session.email) return `local:${session.email}`;
  return null;
}
class OpsWebSocketAuth {
  constructor({ intervalMs = 10000, timeoutMs = 5000 } = {}) {
    this.intervalMs = intervalMs;
    this.timeoutMs = timeoutMs;
    this.connections = new Set();
  }
  attach(ws, req, initial, resolve) {
    const expected = principal(initial);
    const entry = { keys: credentialKeys(req), stop: () => {} };
    let stopped = false, pending = null;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      this.connections.delete(entry);
      // Terminate immediately so no commands or output survive revoked access.
      ws.terminate();
    };
    entry.stop = stop;
    const authorize = async () => {
      if (stopped || ws.readyState !== 1 || !expected) { stop(); return false; }
      if (pending) return pending;
      pending = (async () => {
        let timeout;
        try {
          const result = await Promise.race([
            Promise.resolve().then(resolve),
            new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('authorization timeout')), this.timeoutMs); }),
          ]);
          if (stopped || ws.readyState !== 1 || principal(result) !== expected) { stop(); return false; }
          return true;
        } catch { stop(); return false; }
        finally { clearTimeout(timeout); }
      })();
      try { return await pending; } finally { pending = null; }
    };
    const timer = setInterval(authorize, this.intervalMs);
    timer.unref?.();
    ws.once('close', () => {
      stopped = true;
      clearInterval(timer);
      this.connections.delete(entry);
    });
    this.connections.add(entry);
    ws.authorize = authorize;
    return authorize;
  }
  revoke(req) {
    const keys = new Set(credentialKeys(req));
    for (const entry of this.connections) {
      if (entry.keys.some(k => keys.has(k))) entry.stop();
    }
  }
}
module.exports = { OpsWebSocketAuth, allowedBrowserOrigin };
