// Unit tests for the product kanban store, routes and MCP tools.
// Run: node --test kanban-store.test.js
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openKanban, parseGithubRef } = require("./kanban-store");
const { handleKanbanRoute } = require("./kanban-routes");
const { registerKanbanTools } = require("./mcp/kanban-tools");

let clock;
let k;
function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kanban-test-"));
  clock = new Date("2026-10-09T12:00:00Z");
  k = openKanban(path.join(dir, "kanban.db"), { now: () => clock });
  k.upsertProduct({ slug: "a-house-divided", name: "A House Divided", aliases: ["ahd", "ahdgame", "adhd-bot"] });
  k.upsertProduct({ slug: "metroforge", name: "MetroForge", aliases: ["mf"] });
  k.db.prepare("INSERT INTO kanban_github_sources (repo, product) VALUES ('lakesidegamedev/AHDGame', 'a-house-divided')").run();
}
const days = (n) => { clock = new Date(clock.getTime() + n * 86_400_000); };

describe("kanban store", () => {
  beforeEach(fresh);

  it("resolves product aliases case-insensitively, including owner/repo", () => {
    for (const name of ["ahd", "AHDGame", "adhd-bot", "lakesidegamedev/AHDGame", "A House Divided", "a-house-divided"]) {
      assert.equal(k.resolveProduct(name), "a-house-divided", name);
    }
    assert.throws(() => k.resolveProduct("nope"), /unknown product/);
  });

  it("add with start:true lands in now, assigned, with a started event", () => {
    const item = k.add({ product: "ahd", title: "Fix the globe", start: true, summary: "on it" }, { actor: "claude" });
    assert.equal(item.lane, "now");
    assert.equal(item.assigned_to, "claude");
    assert.deepEqual(item.events.map((e) => e.event_type).sort(), ["created", "started"]);
    assert.ok(item.updated_at);
  });

  it("work_report events move lanes and set needs_owner; idempotency key dedupes", () => {
    const { id } = k.add({ product: "mf", title: "Station costs" });
    assert.equal(k.report({ id, event: "started", summary: "go", actor: "codex" }).item.lane, "now");
    assert.equal(k.report({ id, event: "blocked", summary: "waiting" }).item.lane, "blocked");
    const asked = k.report({ id, event: "decision_requested", summary: "pick A or B", idempotency_key: "k1" });
    assert.equal(asked.item.needs_owner, true);
    assert.equal(k.report({ id, event: "decision_requested", summary: "again", idempotency_key: "k1" }).duplicate, true);
    const done = k.report({ id, event: "completed", summary: "shipped", evidence_url: "https://github.com/lakesidegamedev/AHDGame/pull/1" });
    assert.equal(done.item.lane, "done");
    assert.equal(done.item.needs_owner, false);
    assert.equal(done.item.evidence_url, "https://github.com/lakesidegamedev/AHDGame/pull/1");
    assert.throws(() => k.report({ id, event: "shipped", summary: "x" }), /event must be one of/);
    assert.throws(() => k.report({ id, event: "progress", summary: "x", evidence_url: "javascript:alert(1)" }), /http/);
  });

  it("derives staleness for now items after 5 days, filters on it, and an update clears it", () => {
    const { id } = k.add({ product: "ahd", title: "Old work", lane: "now" });
    k.add({ product: "ahd", title: "Old backlog", lane: "backlog" });
    days(6);
    assert.deepEqual(k.list({ stale: true }).items.map((i) => i.id), [id]);
    assert.equal(k.list({ stale: false }).items.length, 1);
    k.update(id, { detail: "reviewed" }, { actor: "owner" });
    assert.equal(k.list({ stale: true }).items.length, 0);
    k.update(id, { stale: true });
    assert.equal(k.get(id).stale, true);
  });

  it("brief separates needs-owner items from their lanes", () => {
    k.add({ product: "ahd", title: "Decide: casino limits", lane: "next", needs_owner: true });
    k.add({ product: "ahd", title: "Building", lane: "now" });
    const brief = k.brief({ product: "AHDGame" });
    assert.equal(brief.counts.needs_owner, 1);
    assert.equal(brief.counts.next, 0);
    assert.equal(brief.counts.now, 1);
    assert.equal(brief.needs_owner[0].title, "Decide: casino limits");
  });

  it("aliases resolve folded ids to the survivor", () => {
    const { id } = k.add({ product: "ahd", title: "Survivor" });
    k.db.prepare("INSERT INTO kanban_item_aliases (alias_id, item_id) VALUES (999999, ?)").run(id);
    assert.equal(k.get(999999).id, id);
    assert.equal(k.update(999999, { lane: "next" }).lane, "next");
  });

  it("parses GitHub refs and rejects duplicates links", () => {
    assert.deepEqual(parseGithubRef("lakesidegamedev/AHDGame#12"), { repo: "lakesidegamedev/AHDGame", number: 12, url: "https://github.com/lakesidegamedev/AHDGame/issues/12" });
    assert.equal(parseGithubRef("https://github.com/lakesidegamedev/AHDGame/issues/7?x=1").number, 7);
    k.add({ product: "ahd", title: "linked", github: "lakesidegamedev/AHDGame#12" });
    assert.throws(() => k.add({ product: "ahd", title: "again", github: "lakesidegamedev/AHDGame#12" }), /already item/);
  });

  it("github sync imports open issues, keeps updated_at on no-op, closes confirmed-closed links", async () => {
    const linked = k.add({ product: "ahd", title: "local twin", lane: "now", github: "lakesidegamedev/AHDGame#5" });
    const calls = [];
    let open = [{ number: 5, title: "tracker", url: "https://github.com/lakesidegamedev/AHDGame/issues/5", labels: [] },
      { number: 9, title: "new bug", url: "https://github.com/lakesidegamedev/AHDGame/issues/9", labels: [{ name: "blocked" }] }];
    const run = async (_bin, args) => {
      calls.push(args.join(" "));
      if (args[0] === "issue") return { stdout: JSON.stringify(open) };
      return { stdout: JSON.stringify({ state: "closed", title: "tracker", html_url: "u", labels: [] }) };
    };
    let [result] = await k.syncGithub({ run });
    assert.equal(result.added, 1);
    const imported = k.list({ q: "new bug" }).items[0];
    assert.equal(imported.lane, "blocked");
    assert.equal(k.get(linked.id).updated_at, linked.updated_at, "sync must not refresh updated_at on a no-op");
    assert.equal(k.get(linked.id).title, "local twin", "sync must not overwrite a local title");
    open = open.filter((i) => i.number !== 5);
    [result] = await k.syncGithub({ run });
    assert.equal(result.closed, 1);
    assert.equal(k.get(linked.id).lane, "done");
    assert.ok(calls.some((c) => c.startsWith("api repos/lakesidegamedev/AHDGame/issues/5")));
  });
});

function fakeRes() {
  return { status: 0, headers: {}, body: "", writeHead(s, h) { this.status = s; this.headers = h || {}; }, end(b) { this.body = b || ""; }, setHeader() {} };
}
function fakeReq({ method = "GET", body, headers = {} } = {}) {
  const chunks = body ? [Buffer.from(JSON.stringify(body))] : [];
  return { method, headers: { host: "ops.example.com", ...headers }, async *[Symbol.asyncIterator]() { yield* chunks; } };
}

describe("kanban routes", () => {
  beforeEach(fresh);
  const ctx = (session) => ({ resolveSession: async () => session, addSecurityHeaders: () => {}, renderShell: ({ body }) => `<html>${body}</html>`, store: () => k });

  it("redirects signed-out visitors and 404s non-admins", async () => {
    let res = fakeRes();
    await handleKanbanRoute(fakeReq(), res, "/kanban", ctx(null));
    assert.equal(res.status, 302);
    res = fakeRes();
    await handleKanbanRoute(fakeReq(), res, "/kanban", ctx({ role: "moderator" }));
    assert.equal(res.status, 404);
    res = fakeRes();
    await handleKanbanRoute(fakeReq(), res, "/api/kanban", ctx({ role: "moderator" }));
    assert.equal(res.status, 404);
  });

  it("renders for admins and requires the same-origin header to write", async () => {
    k.add({ product: "ahd", title: "<script>x</script>" });
    let res = fakeRes();
    await handleKanbanRoute(fakeReq(), res, "/kanban", ctx({ role: "admin", email: "a@x" }));
    assert.equal(res.status, 200);
    assert.ok(!res.body.includes("<script>x</script>"), "board JSON must not close the script element");
    res = fakeRes();
    await handleKanbanRoute(fakeReq({ method: "POST", body: { product: "ahd", title: "t" } }), res, "/api/kanban/items", ctx({ role: "admin" }));
    assert.equal(res.status, 403);
    res = fakeRes();
    await handleKanbanRoute(fakeReq({ method: "POST", body: { product: "ahd", title: "t" }, headers: { "x-requested-with": "ops-dashboard", origin: "https://ops.example.com" } }), res, "/api/kanban/items", ctx({ role: "admin", email: "a@x" }));
    assert.equal(res.status, 201);
    assert.equal(JSON.parse(res.body).events[0].actor, "a@x");
    assert.equal(await handleKanbanRoute(fakeReq(), fakeRes(), "/tracker", ctx(null)), false);
  });
});

describe("kanban MCP tools", () => {
  beforeEach(fresh);
  function tools(write) {
    const registered = {};
    const server = { tool: (name, _d, _s, fn) => { registered[name] = fn; } };
    registerKanbanTools(server, {
      auth: { name: "test", scopes: { write } },
      jsonResult: (o) => ({ ok: true, o }),
      errorResult: (m) => ({ ok: false, m }),
      store: () => k,
    });
    return registered;
  }

  it("agents cannot flag owner decisions: decision_requested is a progress note", async () => {
    const t = tools(true);
    const added = (await t.kanban_add({ product: "ahd", title: "Pick a rate", needs_owner: true })).o;
    assert.equal(added.needs_owner, false);
    await t.kanban_update({ id: added.id, needs_owner: true });
    await t.work_report({ id: added.id, event: "decision_requested", summary: "A or B?" });
    const row = k.get(added.id).item || k.get(added.id);
    assert.equal(row.needs_owner, false);
    assert.match(JSON.stringify(k.get(added.id)), /Decision pending with the owner in chat: A or B\?/);
  });

  it("registers the agent verbs and gates writes on scope", async () => {
    const t = tools(false);
    assert.deepEqual(Object.keys(t).sort(), ["kanban_add", "kanban_brief", "kanban_get", "kanban_github_sync", "kanban_list", "kanban_update", "work_report"]);
    assert.equal((await t.kanban_add({ product: "ahd", title: "x" })).ok, false);
    assert.equal((await t.kanban_list({})).ok, true);
    const w = tools(true);
    const added = await w.kanban_add({ product: "adhd-bot", title: "x", start: true, actor: "claude" });
    assert.equal(added.o.lane, "now");
    assert.equal((await w.kanban_add({ product: "zzz", title: "x" })).m.includes("unknown product"), true);
  });
});
