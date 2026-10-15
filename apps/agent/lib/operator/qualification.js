"use strict";
// A successful promotion receipt can replace duplicate checks only when it
// came from the protected, current CI implementation for this exact merge.
const REPO = "Egg3901/AHDGame";
const WORKFLOW = ".github/workflows/ci.yml";
const SCRIPT = "scripts/ci/staging-qualification.mjs";
const SHA = /^[a-f0-9]{40}$/;
async function promotionQualification({ api, pr, runs, repository = REPO }) {
  const no = { qualified: false };
  if (repository !== REPO || pr.base?.ref !== "main" || pr.head?.ref !== "staging" ||
      pr.head?.repo?.full_name !== REPO || pr.base?.repo?.full_name !== REPO ||
      !Number.isSafeInteger(pr.number) || pr.number <= 0 || !SHA.test(pr.base?.sha || "") ||
      !SHA.test(pr.head?.sha || "") || !SHA.test(pr.merge_commit_sha || "")) return no;
  const receipt = (runs || []).find(r => r.name === "reuse-staging-qualification" &&
    r.status === "completed" && r.conclusion === "success" && r.app?.slug === "github-actions" && r.head_sha === pr.head.sha);
  if (!receipt) return no;
  const match = /^https:\/\/github\.com\/Egg3901\/AHDGame\/actions\/runs\/(\d+)\/job\/(\d+)$/.exec(receipt.details_url || "");
  if (!match) return no;
  try {
    const read = path => api([`repos/${REPO}/${path}`]);
    const workflow = await read("actions/workflows/ci.yml");
    const run = await read(`actions/runs/${match[1]}`);
    if (!Number.isSafeInteger(workflow.id) || run.workflow_id !== workflow.id || run.path !== WORKFLOW || run.event !== "pull_request" ||
        run.head_sha !== pr.head.sha || run.head_repository?.full_name !== REPO ||
        !(run.pull_requests || []).some(p => p.number === pr.number && p.head?.sha === pr.head.sha &&
          p.head?.ref === "staging" && p.base?.ref === "main" && p.base?.sha === pr.base.sha)) return no;
    const jobs = await read(`actions/runs/${match[1]}/jobs?per_page=100`);
    if (!Array.isArray(jobs.jobs) || !Number.isSafeInteger(jobs.total_count) || jobs.total_count > 100 || jobs.jobs.length !== jobs.total_count || !jobs.jobs.some(j =>
      String(j.id) === match[2] && j.name === receipt.name && j.status === "completed" && j.conclusion === "success" &&
      j.check_run_url === `https://api.github.com/repos/${REPO}/check-runs/${receipt.id}`)) return no;
    const head = await read(`git/commits/${pr.head.sha}`), merge = await read(`git/commits/${pr.merge_commit_sha}`);
    if (!SHA.test(head.tree?.sha || "") || merge.tree?.sha !== head.tree.sha) return no;
    for (const path of [WORKFLOW, SCRIPT]) {
      const protectedFile = await read(`contents/${path}?ref=development`);
      const testedFile = await read(`contents/${path}?ref=${pr.head.sha}`);
      if (protectedFile.type !== "file" || testedFile.type !== "file" || !SHA.test(protectedFile.sha || "") || protectedFile.sha !== testedFile.sha) return no;
    }
    return { qualified: true, run: Number(match[1]), tree: head.tree.sha, via: "staging-qualification" };
  } catch { return no; }
}
module.exports = { promotionQualification };
