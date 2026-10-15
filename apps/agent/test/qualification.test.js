"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { promotionQualification } = require("../lib/operator/qualification");
const { fixture } = require("./fixtures/promotion-qualification");
test("identical promotion tree accepts the native receipt from the trusted current CI implementation", async () => {
  const f = fixture(); assert.equal((await promotionQualification(f)).qualified, true);
});
const cases = {
  "other branch": f => f.pr.base.ref = "development",
  "fork named staging": f => f.pr.head.repo.full_name = "other/AHDGame",
  "forged check app": f => f.receipt.app.slug = "external",
  "stale head": f => f.receipt.head_sha = "f".repeat(40),
  "wrong workflow": f => f.responses["actions/runs/100"].workflow_id = 99,
  "missing workflow identity": f => { delete f.responses["actions/workflows/ci.yml"].id; delete f.responses["actions/runs/100"].workflow_id; },
  "missing base revision": f => { delete f.pr.base.sha; delete f.responses["actions/runs/100"].pull_requests[0].base.sha; },
  "incomplete jobs": f => f.responses["actions/runs/100/jobs?per_page=100"].total_count = 101,
  "push receipt": f => f.responses["actions/runs/100"].event = "push",
  "unlinked PR": f => f.responses["actions/runs/100"].pull_requests = [],
  "changed base": f => f.responses["actions/runs/100"].pull_requests[0].base.sha = "f".repeat(40),
  "different merge tree": f => f.responses[`git/commits/${f.merge}`].tree.sha = "f".repeat(40),
  "changed workflow": f => f.responses[`contents/.github/workflows/ci.yml?ref=${f.head}`].sha = "f".repeat(40),
  "changed reuse script": f => f.responses[`contents/scripts/ci/staging-qualification.mjs?ref=${f.head}`].sha = "f".repeat(40),
  "spoofed native job": f => f.responses["actions/runs/100/jobs?per_page=100"].jobs[0].check_run_url += "1",
  "failed job": f => f.responses["actions/runs/100/jobs?per_page=100"].jobs[0].conclusion = "failure",
  "unknown API result": f => delete f.responses["actions/runs/100"],
};
for (const [label, alter] of Object.entries(cases)) test(`promotion reuse falls back to full checks: ${label}`, async () => {
  const f = fixture(); alter(f); assert.equal((await promotionQualification(f)).qualified, false);
});
