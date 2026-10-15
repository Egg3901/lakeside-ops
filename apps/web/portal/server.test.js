"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const http = require("node:http");
const { createPortal, publicOrigin } = require("./server");
const { passwordHash, passwordMatches } = require("./auth");
const { createRuntime } = require("../../agent/lib/standalone/runtime");

async function fixture(t, execute) {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "keir-portal-"));
  const configFile = path.join(state, "config.json");
  fs.writeFileSync(configFile, JSON.stringify({ state_dir: state, default_route: "claude:test-model@medium", projects: [{ id: "demo", repo_path: state, default_branch: "main", public: false, uses_check_scheduler: false }] }));
  const runtime = createRuntime({ configFile, execute, log() {} });
  const hash = await passwordHash("correct horse battery staple");
  // A fixed Host origin lets an ephemeral listener exercise the real boundary.
  const server = createPortal({ origin: "http://127.0.0.1:9724", passwordHash: hash, stateDir: state, runtime });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(url, { body, cookie, origin, host = "127.0.0.1:9724" } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(base + url, { method: body ? "POST" : "GET", headers: { Host: host, ...(cookie ? { cookie } : {}), ...(origin ? { Origin: origin } : {}), ...(body ? { "Content-Type": "application/json" } : {}) } }, res => {
        let data = ""; res.on("data", b => { data += b; }); res.on("end", () => {
          const headers = Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v]));
          resolve(new Response(data, { status: res.statusCode, headers }));
        });
      }); req.on("error", reject); req.end(body ? JSON.stringify(body) : undefined);
    });
  }
  t.after(async () => { runtime.stop(); server.closeAllConnections(); await new Promise(r => server.close(r)); fs.rmSync(state, { recursive: true, force: true }); });
  const login = await request("/api/login", { body: { password: "correct horse battery staple" } });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  return { runtime, request, cookie, state };
}

test("standalone auth isolates clients and excludes studio routes", async t => {
  const { request, cookie, state } = await fixture(t, async () => ({ state: "done", outcome: { result: { summary: "ok" } } }));
  assert.equal((await request("/api/me")).status, 401);
  assert.equal((await request("/api/me", { cookie })).status, 200);
  assert.equal((await request("/api/me", { cookie, host: "evil.example.com" })).status, 421);
  assert.equal((await request("/api/keir/app/messages", { cookie, origin: "https://evil.example.com", body: { text: "hello" } })).status, 403);
  assert.equal((await request("/api/engine/health", { cookie })).status, 404);
  const persisted = fs.readFileSync(path.join(state, "sessions.json"), "utf8");
  assert.ok(!persisted.includes(cookie.split("=")[1]));
  assert.match(cookie, /^ops_session=/);
  const logout = await request("/api/logout", { cookie, body: {} }); assert.equal(logout.status, 200);
  assert.equal((await request("/api/me", { cookie })).status, 401);
});

test("portal messages reach the same durable Keir thread and deduplicate retries", async t => {
  let calls = 0;
  const { request, cookie, runtime } = await fixture(t, async () => { calls++; return { state: "done", outcome: { result: { summary: "Your project has a src directory." } } }; });
  const input = { text: "Inspect my repository", clientId: "client-one", mode: "new" };
  const first = await request("/api/keir/app/messages", { cookie, body: input }); assert.equal(first.status, 201);
  const saved = await first.json();
  await new Promise(r => setTimeout(r, 30));
  const again = await request("/api/keir/app/messages", { cookie, body: input }); assert.equal(again.status, 200);
  assert.equal((await again.json()).jobId, saved.jobId); assert.equal(calls, 1);
  const view = await (await request("/api/keir/app/thread", { cookie })).json();
  assert.ok(view.messages.some(x => x.text === "Your project has a src directory."));
  assert.equal(runtime.ledger.data.jobs[saved.jobId].state, "done");
  const threads = await (await request("/api/keir/app/threads", { cookie })).json(); assert.ok(threads.threads.some(t => t.id === "main"));
});

test("stopping a running task aborts execution and suppresses a late reply", async t => {
  let abort;
  const { request, cookie, runtime } = await fixture(t, ({ signal }) => new Promise(resolve => {
    abort = signal; signal.addEventListener("abort", () => resolve({ state: "done", outcome: { result: { summary: "late reply" } } }));
  }));
  const posted = await (await request("/api/keir/app/messages", { cookie, body: { text: "Inspect the project", mode: "new" } })).json();
  await new Promise(r => setTimeout(r, 20));
  assert.equal((await request("/api/keir/app/cancel", { cookie, body: { taskId: posted.jobId } })).status, 200);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(abort.aborted, true);
  assert.equal(runtime.ledger.data.jobs[posted.jobId].state, "cancelled");
  assert.ok(!runtime.app.view().messages.some(x => x.text === "late reply"));
});

test("password verification and deployment origins fail closed", async () => {
  const hash = await passwordHash("a very long test password");
  assert.equal(await passwordMatches("a very long test password", hash), true);
  assert.equal(await passwordMatches("wrong", hash), false);
  for (const value of ["http://example.com", "https://a:b@example.com", "https://example.com/path"]) assert.throws(() => publicOrigin(value));
});

test("a follow-up arriving during execution gets another activation", async t => {
  let finish, calls = 0;
  const { request, cookie, runtime } = await fixture(t, () => {
    calls++;
    return calls === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ state: "done", outcome: { result: { summary: "Follow-up handled" } } });
  });
  const first = await (await request("/api/keir/app/messages", { cookie, body: { text: "Inspect the repository", mode: "new" } })).json();
  const next = await (await request("/api/keir/app/messages", { cookie, body: { text: "Also inspect tests", mode: "followup" } })).json();
  assert.equal(first.jobId, next.jobId);
  finish({ state: "done", outcome: { result: { summary: "Initial inspection" } } });
  await new Promise(r => setTimeout(r, 30));
  assert.equal(calls, 2);
  assert.equal(runtime.ledger.data.jobs[first.jobId].state, "done");
  assert.ok(runtime.app.view().messages.some(x => x.text === "Follow-up handled"));
});

test("coding grant requires an explicit registered-worktree path before runtime starts", () => {
  assert.throws(() => createRuntime({ configFile: "/nonexistent", grant: "coding" }), /absolute registered worktree/);
  assert.throws(() => createRuntime({ configFile: "/nonexistent", grant: "unrestricted" }), /grant must be read or coding/);
});
