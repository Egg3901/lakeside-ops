"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), cp = require("node:child_process");
const { reconcilePublication } = require("../lib/operator/publication-recovery");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keir-publication-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => cp.execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
  git("init", "-q"); fs.writeFileSync(path.join(dir, "file.txt"), "before\n"); git("add", "file.txt");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "before");
  fs.writeFileSync(path.join(dir, "file.txt"), "after\n");
  const patch = git("diff", "--full-index") + "\n", patchFile = path.join(dir, "saved.patch"); fs.writeFileSync(patchFile, patch);
  const sha = require("node:crypto").createHash("sha256").update(patch).digest("hex");
  const blob = git("hash-object", "file.txt"), head = "a".repeat(40);
  const job = { id: "job", state: "blocked", role: "owner", replyChannel: "app", effects: {}, summary: "Old missing receipt" };
  const action = { id: "publication", jobId: job.id, kind: "publish_patch", state: "executing", args: { repository: "AHDGame", patchFile, patchSha256: sha, revise: { number: 42, branch: "keir/fixture", url: "https://github.com/lakesidegamedev/AHDGame/pull/42" } } };
  const ledger = { data: { jobs: { job }, actions: { publication: action }, ownerMuseOrigins: {} }, audit: () => {}, save: () => {} };
  const requests = [];
  const api = async endpoint => { requests.push(endpoint); if (endpoint.endsWith("/pulls/42")) return { state: "open", head: { sha: head, ref: "keir/fixture", repo: { full_name: "lakesidegamedev/AHDGame" } } }; if (endpoint.includes("/contents/")) return { type: "file", sha: blob }; throw Error("Unexpected write or API " + endpoint); };
  return { dir, git, job, action, ledger, requests, api, config: { repositories: { AHDGame: dir } } };
}
test("observes exact published postimages without replaying writes or minting authority", async t => {
  const f = fixture(t), before = JSON.stringify(f.ledger.data.ownerMuseOrigins);
  const r = await reconcilePublication(f, f.action.id);
  assert.equal(r.verified, true); assert.equal(f.action.state, "done"); assert.equal(f.job.state, "blocked");
  assert.match(f.job.summary, /verified/); assert.equal(JSON.stringify(f.ledger.data.ownerMuseOrigins), before);
  assert.deepEqual(f.job.effects, {}); assert.equal(f.requests.length, 2);
  assert.equal((await reconcilePublication(f, f.action.id)).duplicate, true); assert.equal(f.requests.length, 2);
});
test("keeps a different remote postimage held", async t => {
  const f = fixture(t); const api = f.api; f.api = async p => p.includes("/contents/") ? { type: "file", sha: "b".repeat(40) } : api(p);
  await assert.rejects(reconcilePublication(f, f.action.id), /postimage/); assert.equal(f.action.state, "executing");
});
test("rejects changed patches, branch mismatch and active actions", async t => {
  const f = fixture(t); fs.appendFileSync(f.action.args.patchFile, "changed");
  await assert.rejects(reconcilePublication(f, f.action.id), /digest/); assert.equal(f.requests.length, 0);
  const g = fixture(t); g.action.args.revise.branch = "keir/other";
  await assert.rejects(reconcilePublication(g, g.action.id), /branch/); assert.equal(g.action.state, "executing");
  const h = fixture(t); h.job.state = "running";
  await assert.rejects(reconcilePublication(h, h.action.id), /active/); assert.equal(h.requests.length, 0);
});
test("another unresolved effect remains held after publication verification", async t => {
  const f = fixture(t); f.job.effects.other = { state: "started" };
  await reconcilePublication(f, f.action.id); assert.equal(f.action.state, "done"); assert.equal(f.job.effects.other.state, "started");
});
