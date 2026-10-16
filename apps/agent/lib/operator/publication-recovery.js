"use strict";
// Observe a lost PR revision receipt. This module never pushes, merges or retries
// a publication, and never turns a historical task into an authenticated request.
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const execFile = require("node:util").promisify(require("node:child_process").execFile);
const { repositoryName, pullRequestNumber, canonicalRepository } = require("./github");
const git = async (repo, args) => (await execFile("/usr/bin/git", ["-C", repo, ...args], { timeout: 15000, maxBuffer: 5 << 20, encoding: "buffer" })).stdout;
const apiRead = async endpoint => JSON.parse((await execFile("/usr/bin/gh", ["api", endpoint], { timeout: 20000, maxBuffer: 5 << 20 })).stdout);
async function postimages(repo, patch) {
  // Only ordinary text modifications are supported. Unknown patch forms stay
  // held rather than inferring an outcome from a PR title or abbreviated hash.
  const parts = patch.toString("utf8").split(/^diff --git /m).slice(1);
  if (!parts.length || parts.length > 100) throw Error("Unsupported publication patch");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "keir-postimage-"));
  try {
    await git(scratch, ["init", "--quiet"]);
    const files = [];
    for (const part of parts) {
      const header = /^a\/(\S+) b\/(\S+)\nindex ([a-f0-9]{7,40})\.\.([a-f0-9]{7,40}) 100644\n--- a\/([^\n]+)\n\+\+\+ b\/([^\n]+)\n@@/.exec(part);
      if (!header || header[1] !== header[2] || header[1] !== header[5] || header[1] !== header[6] || /(?:^|\/)\.\.?\//.test(header[1]) || header[1].startsWith("/") || header[1].split("/").some(p => p === ".git" || p === ".." || p === ".")) throw Error("Unsupported publication patch path or mode");
      const file = header[1]; if (files.some(f => f.path === file)) throw Error("Repeated publication patch path");
      const old = await git(repo, ["cat-file", "blob", header[3]]);
      const destination = path.join(scratch, file); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, old);
      files.push({ path: file, abbreviatedPostimage: header[4] });
    }
    const patchFile = path.join(scratch, ".publication.patch"); fs.writeFileSync(patchFile, patch);
    await git(scratch, ["apply", "--check", patchFile]); await git(scratch, ["apply", patchFile]);
    return files.map(f => {
      const bytes = fs.readFileSync(path.join(scratch, f.path));
      const sha = crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
      if (!sha.startsWith(f.abbreviatedPostimage)) throw Error("Publication patch postimage metadata disagrees with actual content");
      return { path: f.path, sha };
    });
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}
async function reconcilePublication({ ledger, config, api = apiRead }, id) {
  const d = ledger.data, action = d.actions[id], job = d.jobs[action?.jobId];
  if (action?.publicationReceipt) return { ...action.publicationReceipt, duplicate: true };
  if (!job || job.state === "running" || action?.kind !== "publish_patch" || action.state !== "executing") throw Error("Publication is active or not an unresolved publication");
  const args = action.args, revision = args.revise, repo = config.repositories[args.repository];
  if (!repo || !revision || pullRequestNumber(args.repository, revision.url) !== revision.number || !/^keir\//.test(revision.branch)) throw Error("No supported saved publication revision");
  const patch = fs.readFileSync(args.patchFile);
  if (patch.length > 5 << 20 || crypto.createHash("sha256").update(patch).digest("hex") !== args.patchSha256) throw Error("Saved patch digest changed");
  const files = await postimages(repo, patch), repository = repositoryName(args.repository);
  const pr = await api(`repos/${repository}/pulls/${revision.number}`);
  if (pr.head?.ref !== revision.branch || canonicalRepository(pr.head?.repo?.full_name) !== repository || !/^[a-f0-9]{40}$/.test(pr.head?.sha || "")) throw Error("Publication branch identity does not match");
  for (const f of files) {
    const object = await api(`repos/${repository}/contents/${f.path.split("/").map(encodeURIComponent).join("/")}?ref=${pr.head.sha}`);
    if (object.type !== "file" || object.sha !== f.sha) throw Error("Published postimage differs; retain the hold");
  }
  if (job.state === "running" || action.state !== "executing" || d.actions[id] !== action || crypto.createHash("sha256").update(fs.readFileSync(args.patchFile)).digest("hex") !== args.patchSha256) throw Error("Publication changed during verification");
  const receipt = { verified: true, at: Date.now(), pullRequest: revision.url, head: pr.head.sha, files, method: "exact-published-postimages" };
  action.publicationReceipt = receipt; action.state = "done";
  // This is observed publication only, never merge approval or completion of
  // other plan steps. Existing consent and all other effects remain untouched.
  job.updatedAt = receipt.at;
  job.summary = "Earlier PR publication verified on GitHub. Saved reports and remaining work are preserved; no publication was retried or merge approved.";
  (job.history ||= []).push({ at: new Date(receipt.at).toISOString(), kind: "publication_verified", summary: job.summary });
  ledger.audit("publication_receipt_reconciled", { job: job.id, action: id, ...receipt }); ledger.save();
  return receipt;
}
function createPublicationRecovery(deps) {
  let running = false; const checked = new Map();
  return { async tick() {
    if (running || deps.ledger.data.paused) return; running = true;
    try {
      const action = Object.values(deps.ledger.data.actions).find(a => a.kind === "publish_patch" && a.state === "executing" && a.args?.revise && deps.ledger.data.jobs[a.jobId]?.state !== "running" && Date.now() - (checked.get(a.id) || 0) >= 5 * 60000);
      if (!action) return; checked.set(action.id, Date.now());
      try { return await reconcilePublication(deps, action.id); }
      catch (e) { deps.log?.(`Publication ${action.id} remains held: ${String(e.message).slice(0, 200)}`); }
    } finally { running = false; }
  } };
}
module.exports = { postimages, reconcilePublication, createPublicationRecovery };
