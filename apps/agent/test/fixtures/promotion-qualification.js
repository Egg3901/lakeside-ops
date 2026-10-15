"use strict";
function fixture() {
  const prefix = "repos/lakesidegamedev/AHDGame/", head = "a".repeat(40), merge = "b".repeat(40), base = "c".repeat(40), tree = "d".repeat(40), blob = "e".repeat(40);
  const pr = { number: 42, state: "open", mergeable: true, merge_commit_sha: merge, head: { ref: "staging", sha: head, repo: { full_name: "lakesidegamedev/AHDGame" } }, base: { ref: "main", sha: base, repo: { full_name: "lakesidegamedev/AHDGame" } } };
  const receipt = { id: 50, name: "reuse-staging-qualification", head_sha: head, app: { slug: "github-actions" }, status: "completed", conclusion: "success", details_url: "https://github.com/lakesidegamedev/AHDGame/actions/runs/100/job/200" };
  const runs = [receipt, { name: "CodeQL", status: "in_progress" }];
  const responses = {
    "actions/workflows/ci.yml": { id: 30 },
    "actions/runs/100": { workflow_id: 30, path: ".github/workflows/ci.yml", event: "pull_request", head_sha: head, head_repository: { full_name: "lakesidegamedev/AHDGame" }, pull_requests: [{ number: 42, head: { ref: "staging", sha: head }, base: { ref: "main", sha: base } }] },
    "actions/runs/100/jobs?per_page=100": { total_count: 1, jobs: [{ id: 200, name: receipt.name, status: "completed", conclusion: "success", check_run_url: "https://api.github.com/repos/lakesidegamedev/AHDGame/check-runs/50" }] },
    [`git/commits/${head}`]: { tree: { sha: tree } }, [`git/commits/${merge}`]: { tree: { sha: tree } },
    "pulls/42": pr, [`commits/${head}/check-runs?per_page=100`]: { check_runs: runs },
  };
  for (const path of [".github/workflows/ci.yml", "scripts/ci/staging-qualification.mjs"]) for (const ref of ["development", head]) responses[`contents/${path}?ref=${ref}`] = { type: "file", sha: blob };
  const calls = [];
  const api = async ([path]) => { calls.push(path); if (!path.startsWith(prefix) || !responses[path.slice(prefix.length)]) throw new Error("Unexpected API fixture: " + path); return responses[path.slice(prefix.length)]; };
  return { api, calls, pr, runs, receipt, responses, head, merge };
}
module.exports = { fixture };
