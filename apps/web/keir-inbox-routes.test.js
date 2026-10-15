// Unit tests for the Keir inbox routes (admin gate and proxy).
// Run: node --test keir-inbox-routes.test.js
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { handleKeirInboxRoute, isKeirInboxPath } = require("./keir-inbox-routes");

function call(pathname, { method = "GET", session = { role: "admin", email: "mod@example.test" }, headers = {}, body, upstream } = {}) {
  const req = Readable.from(body ? [JSON.stringify(body)] : []);
  Object.assign(req, { method, url: pathname, headers: { host: "ops.example.test", ...headers } });
  const out = { status: 0, headers: {}, body: "" };
  const res = { setHeader() {}, writeHead(s, h) { out.status = s; out.headers = h || {}; }, end(b) { out.body = String(b || ""); } };
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const u = upstream || { status: 200, json: { ok: true } };
    return { ok: u.status < 400, status: u.status, headers: new Map([["content-type", "image/png"]]), json: async () => u.json, arrayBuffer: async () => Buffer.from("png") };
  };
  const ctx = { resolveSession: async () => session, addSecurityHeaders() {}, renderShell: ({ title, body: b }) => `<title>${title}</title>${b}`, fetchImpl, token: "secret-token" };
  return handleKeirInboxRoute(req, res, pathname.split("?")[0], ctx).then((handled) => ({ handled, ...out, calls, json: () => JSON.parse(out.body) }));
}

const SAME = { "x-requested-with": "ops-dashboard", origin: "https://ops.example.test" };

describe("keir inbox routes", () => {
  it("only claims its own paths", async () => {
    assert.equal(isKeirInboxPath("/inbox"), true);
    assert.equal(isKeirInboxPath("/api/keir/inbox/threads"), true);
    assert.equal(isKeirInboxPath("/api/kanban"), false);
    assert.equal((await call("/kanban")).handled, false);
  });

  it("sends signed-out visitors to sign in and hides from non-admins", async () => {
    assert.equal((await call("/inbox", { session: null })).status, 302);
    assert.equal((await call("/api/keir/inbox/threads", { session: null })).status, 401);
    assert.equal((await call("/inbox", { session: { role: "moderator" } })).status, 404);
    assert.equal((await call("/api/keir/inbox/threads", { session: { role: "moderator" } })).status, 404);
  });

  it("renders the page for admins", async () => {
    const r = await call("/inbox");
    assert.equal(r.status, 200);
    assert.match(r.body, /Keir inbox/);
    assert.doesNotMatch(r.body, /secret-token/);
  });

  it("proxies reads with the server-side token", async () => {
    const r = await call("/api/keir/inbox/threads?q=ada");
    assert.equal(r.status, 200);
    assert.equal(r.calls[0].url, "http://127.0.0.1:9767/threads?q=ada");
    assert.equal(r.calls[0].init.headers.Authorization, "Bearer secret-token");
  });

  it("proxies the Keir alerts feed and passes a missing endpoint through as 404", async () => {
    const ok = await call("/api/keir/inbox/alerts", { upstream: { status: 200, json: { prodHold: null, pendingApprovals: [] } } });
    assert.equal(ok.status, 200);
    assert.equal(ok.calls[0].url, "http://127.0.0.1:9767/alerts");
    assert.equal(ok.calls[0].init.headers.Authorization, "Bearer secret-token");
    const missing = await call("/api/keir/inbox/alerts", { upstream: { status: 404, json: { error: "Not found" } } });
    assert.equal(missing.status, 404);
    assert.equal((await call("/api/keir/inbox/alerts", { session: { role: "moderator" } })).calls.length, 0);
    assert.equal((await call("/api/keir/inbox/alerts", { method: "POST", headers: SAME, body: {} })).status, 404);
  });

  it("refuses writes without a same-origin header", async () => {
    const r = await call("/api/keir/inbox/claims/4/approve", { method: "POST", body: {} });
    assert.equal(r.status, 403);
    assert.equal(r.calls.length, 0);
  });

  it("takes the acting admin from the session, not the browser", async () => {
    const r = await call("/api/keir/inbox/claims/4/approve", { method: "POST", headers: SAME, body: { by: "someone-else" } });
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.calls[0].init.body).by, "mod@example.test");
  });

  it("does not expose the poke or unknown paths through the dashboard", async () => {
    assert.equal((await call("/api/keir/inbox/poke", { method: "POST", headers: SAME, body: {} })).status, 404);
    assert.equal((await call("/api/keir/inbox/../etc", {})).status, 404);
    assert.equal((await call("/api/keir/inbox/attachments/..%2Fx", {})).status, 404);
  });

  it("passes upstream errors through", async () => {
    const r = await call("/api/keir/inbox/claims/4/recheck", { method: "POST", headers: SAME, body: {}, upstream: { status: 409, json: { ok: false, error: "Claim cannot be rechecked now" } } });
    assert.equal(r.status, 409);
    assert.equal(r.json().error, "Claim cannot be rechecked now");
  });
});
