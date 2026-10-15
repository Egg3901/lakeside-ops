"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLedger } = require("../lib/operator/store");
const { createDelegation } = require("../lib/operator/delegation");
const { createBroker } = require("../lib/operator/broker");
const dirs = []; test.after(() => dirs.forEach(p => fs.rmSync(p, { recursive: true, force: true })));
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keir-coding-")); dirs.push(dir);
  const ledger = createLedger(path.join(dir, "ledger.json"));
  const parent = ledger.createJob("parent", { kind: "command", role: "owner", actorId: "111111111111111111", state: "running", repository: "AHDGame", repositoryRef: { branch: "development", commit: "abcdef1234" }, deadline: 9e15 }); parent.state = "running";
  const patch = "diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-old\n+fixed\n";
  const calls = []; let dirty = false;
  const sandbox = { fork: (...a) => calls.push(["fork", ...a]), workspace: () => dir, run: async (id, command) => { calls.push(["run", id, command]); return { code: 0, output: command.includes("git apply") ? "" : id === parent.id ? dirty ? patch : "" : patch }; } };
  const config = { ownerId: parent.actorId, staffIds: [], repositories: {} };
  const delegation = createDelegation({ ledger, sandbox, config });
  return { ledger, parent, patch, calls, sandbox, config, delegation, dirty: () => { dirty = true; } };
}
const instructions = "Verified zero values are valid; fix nullish handling and run focused tests for zero and null.";
test("delegation pins the configured coder (Wonder Full), forks the verified snapshot and reuses an identical request", async () => {
  const f = fixture(); const r = await f.delegation.delegate(f.parent, instructions);
  const child = f.ledger.data.jobs[r.taskId];
  assert.equal(child.provider.model, "muse-wonder-full-1.0"); assert.equal(child.provider.runner, "muse");assert.equal(child.effortPin, "medium");assert.equal(child.codingParent, f.parent.id);
  assert.equal(child.replyChannel, undefined);assert.equal(child.ticket, undefined);
  assert.deepEqual(child.repositoryRef, f.parent.repositoryRef);
  assert.equal((await f.delegation.delegate(f.parent, instructions)).taskId, child.id);
  assert.equal(f.calls.filter(c => c[0] === "fork").length, 1);
});
test("SOL must inspect the exact patch before applying, with unchanged baseline", async () => {
  const f = fixture();const { taskId } = await f.delegation.delegate(f.parent, instructions);const child = f.ledger.data.jobs[taskId];child.state = "done";child.summary = "Four focused tests pass.";
  await assert.rejects(f.delegation.review(f.parent, { taskId, action: "apply", reviewedDigest: "unseen" }), /Inspect and review/);
  const r = await f.delegation.review(f.parent, { taskId, action: "inspect" });assert.equal(r.patch, f.patch);assert.equal(r.testReport, child.summary);
  await assert.rejects(f.delegation.review(f.parent, { taskId, action: "apply", reviewedDigest: "wrong" }), /exact patch digest/);
  assert.equal((await f.delegation.review(f.parent, { taskId, action: "apply", reviewedDigest: r.digest })).applied, true);
  f.dirty();await assert.rejects(f.delegation.review(f.parent, { taskId, action: "apply", reviewedDigest: r.digest }), /snapshot has changed/);
  child.repositoryRef.commit = "changed";await assert.rejects(f.delegation.review(f.parent, { taskId, action: "inspect" }), /baseline changed/);
});
test("coding completion wakes SOL once; failures return to SOL without contacting players", async () => {
  const f = fixture();const { taskId } = await f.delegation.delegate(f.parent, instructions);const child = f.ledger.data.jobs[taskId];f.parent.state = "waiting";child.state = "blocked";child.summary = "Focused test could not run.";
  f.delegation.complete(child);f.delegation.complete(child);
  assert.equal(f.parent.state, "queued");assert.equal(f.parent.inbox.length, 1);assert.equal(f.parent.inbox[0].codingResult, taskId);
  assert.equal(Object.keys(f.ledger.data.outbox).length, 0);
});
test("coding subworkers cannot publish, investigate players, send messages or delegate", async () => {
  const f = fixture();const { taskId } = await f.delegation.delegate(f.parent, instructions);const child = f.ledger.data.jobs[taskId];child.state = "running";
  const b = createBroker({ ...f, mcp: { servers: () => [] }, discord: async () => [] });
  for (const name of ["publish_patch", "channel_reply", "read_tool", "repository_snapshot", "request_heal", "delegate_fix", "review_fix", "remember", "recall", "ticket_record", "player_note", "recent_changes", "view_page"]) await assert.rejects(b.tool(child, name, {}), /Coding subworkers only/);
  await b.tool(child, "finish", { state: "done", summary: "Implemented the correction and tested it." });
  assert.equal(Object.keys(f.ledger.data.outbox).length, 0);
});
test("dirty snapshots, nested delegation and unrelated result access are rejected", async () => {
  const f = fixture();f.dirty();await assert.rejects(f.delegation.delegate(f.parent, instructions), /before editing/);
  await assert.rejects(f.delegation.delegate({ ...f.parent, codingParent: "other" }, instructions), /Only the primary/);
  await assert.rejects(f.delegation.review(f.parent, { taskId: "other", action: "inspect" }), /does not belong/);
});

test("forked coding snapshots preserve isolation between SOL and Luna", async () => {
  const { createSandbox } = require("../lib/operator/sandbox");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keir-coding-fork-"));dirs.push(dir);
  const base = path.join(dir, "base");fs.mkdirSync(base);fs.writeFileSync(path.join(base, "value.txt"), "original");
  const sandbox = createSandbox(path.join(dir, "tasks"));const parent = "aaaaaaaaaaaa", child = "bbbbbbbbbbbb";
  sandbox.attach(parent, base);
  assert.equal((await sandbox.run(parent, "printf 'parent' > repo/value.txt")).code, 0);
  sandbox.fork(parent, child);
  assert.equal((await sandbox.run(child, "cat repo/value.txt")).output, "parent");
  assert.equal((await sandbox.run(child, "printf 'child' > repo/value.txt")).code, 0);
  assert.equal((await sandbox.run(parent, "cat repo/value.txt")).output, "parent");
  assert.equal(fs.readFileSync(path.join(base, "value.txt"), "utf8"), "original");
});

test("desktop sandbox resolves its workspace-local React build dependency", { skip: !fs.existsSync("/root/projects/AHDClient/apps/desktop/node_modules/@vitejs/plugin-react") }, async () => {
  const { createSandbox } = require("../lib/operator/sandbox");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keir-desktop-deps-"));dirs.push(dir);
  const base = path.join(dir, "base");fs.mkdirSync(path.join(base, "apps/desktop"), { recursive: true });
  const sandbox = createSandbox(path.join(dir, "tasks"));const id = "cccccccccccc";sandbox.attach(id, base);
  const r = await sandbox.run(id, "cd repo/apps/desktop && node -p \"require.resolve('@vitejs/plugin-react')\"", undefined, { deps: sandbox.deps("AHDClient") });
  assert.equal(r.code, 0, r.output);assert.match(r.output, /apps\/desktop\/node_modules\/@vitejs\/plugin-react/);
});

test("the coding subworker is told its own sandbox is read-only by design and to write through shell", async () => {
  const { createDelegation } = require("../lib/operator/delegation");
  const fsx = require("node:fs"), osx = require("node:os"), pathx = require("node:path");
  const { createLedger } = require("../lib/operator/store");
  const dir = fsx.mkdtempSync(pathx.join(osx.tmpdir(), "keir-luna-"));
  const ledger = createLedger(pathx.join(dir, "ledger.json"));
  const parent = ledger.createJob("p", { kind: "ticket", role: "support", repository: "AHDGame", repositoryRef: { ref: "main", sha: "abc" }, source: {} });
  const d = createDelegation({ ledger, config: {}, sandbox: { run: async () => ({ code: 0, output: "" }), fork: () => {} } });
  const r = await d.delegate(parent, "Rename the factory-built construction method label and add a focused test.");
  const content = ledger.data.jobs[r.taskId].source.content;
  assert.match(content, /read-only sandbox or disabled shell and write tools on purpose/);
  assert.match(content, /keir MCP tool `shell`/);
  fsx.rmSync(dir, { recursive: true, force: true });
});

test("an investigator is a read-only child on the coder model whose report wakes the parent", async () => {
  const f = fixture();
  const { childTools } = require("../lib/operator/delegation");
  const r = await f.delegation.investigate(f.parent, "Why do Japan's provisional metrics never move? We know effectForecast only displays pressure.");
  const child = f.ledger.data.jobs[r.taskId];
  assert.ok(child.investigation && child.codingParent === f.parent.id);
  assert.equal(child.provider.model, "muse-wonder-full-1.0");
  assert.ok(childTools(child).includes("read_tool") && !childTools(child).includes("publish_patch") && !childTools(child).includes("support_action"));
  assert.deepEqual(childTools({ codingParent: "x" }), ["shell", "local_file", "checkpoint", "finish"]);
  child.state = "done"; child.summary = "Cause: carry-forward in collectOwnerReadings.";
  f.parent.state = "waiting";
  f.delegation.complete(child);
  assert.equal(f.parent.state, "queued");
  assert.match(f.parent.inbox.at(-1).content, /Investigation .* finished done: Cause: carry-forward/);
});

test("queued and sleeping delegations have a bounded wait and report without another activation", async () => {
  const f = fixture(); let clock = Date.now();
  const d = createDelegation({ ...f, now: () => clock });
  for (const state of ["queued", "waiting"]) {
    const r = await d.investigate(f.parent, `Find the exact cause with read-only evidence for the ${state} fixture.`);
    const child = f.ledger.data.jobs[r.taskId]; child.state = state; child.at = clock;
    f.parent.state = "waiting";
    clock += 59 * 60000; d.tick(); assert.equal(child.state, state);
    clock += 60000; d.tick(); d.tick();
    assert.equal(child.state, "blocked"); assert.equal(child.wakeAt, 0);
    assert.equal(f.parent.state, "queued");
    assert.equal(f.parent.inbox.filter(m => m.investigationResult === child.id).length, 1);
    assert.match(f.parent.inbox.at(-1).content, /wait budget/);
  }
});

test("a cancelled child wakes its waiting parent once without a model poll", async () => {
  const f = fixture();
  const r = await f.delegation.investigate(f.parent, "Find the cause with evidence for the cancelled fixture.");
  const child = f.ledger.data.jobs[r.taskId]; child.state = "cancelled"; child.summary = "Cancelled before completion.";
  f.parent.state = "waiting"; f.delegation.tick(); f.delegation.tick();
  assert.equal(f.parent.state, "queued");
  assert.equal(f.parent.inbox.filter(m => m.investigationResult === child.id).length, 1);
  assert.match(f.parent.inbox.at(-1).content, /finished cancelled/);
});

test("a terminal parent cancels idle child work instead of leaving a queued orphan", async () => {
  const f = fixture();
  const r = await f.delegation.investigate(f.parent, "Find evidence for a request that is later completed.");
  const child = f.ledger.data.jobs[r.taskId]; f.parent.state = "done";
  f.delegation.tick();
  assert.equal(child.state, "cancelled"); assert.equal(child.wakeAt, 0);
  assert.equal((f.parent.inbox || []).length, 0);
});
