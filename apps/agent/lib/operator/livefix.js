"use strict";
const { GITHUB_OWNER } = require("./github");
// Branch ancestry is source evidence. Only successful service-specific
// deployment receipts prove that source has reached players.
const blast = require("./blastradius");
const REPO = `repos/${GITHUB_OWNER}/AHDGame`;
const includesFix = (comparison) => ["behind", "identical"].includes(comparison?.status);

async function verifyLiveFix({ api, mcp, number, signal }) {
  try {
    const pr = await api([`${REPO}/pulls/${number}`]);
    if (!pr?.merged || !pr.merge_commit_sha) return { live: false, reason: "the fix PR is not merged", pr };
    const files = [];
    let complete = false;
    for (let page = 1; page <= 30; page++) {
      const rows = await api([`${REPO}/pulls/${number}/files?per_page=100&page=${page}`]);
      if (!Array.isArray(rows)) return { live: false, reason: "fix file list unavailable", pr };
      files.push(...rows.flatMap((r) => [r.filename, ...(r.previous_filename ? [r.previous_filename] : [])]));
      if (rows.length < 100) { complete = true; break; }
    }
    if (!complete) return { live: false, reason: "fix file list incomplete", pr };
    const worker = files.some((f) => blast.ECONOMY_PATHS.test(f) || blast.WORKER_PATHS.test(f));
    const where = {}, deployment = {};
    const services = [{ branch: "main", service: "AHD Production" }, ...(worker ? [{ branch: "turn-worker/production", service: "AHD Turn Worker" }] : [])];
    for (const { branch, service } of services) {
      const receipt = await api([`${REPO}/commits/${encodeURIComponent(branch)}/status`]);
      if (!receipt?.sha) return { live: false, reason: `${service} deployed commit unavailable`, pr, files, where };
      where[branch] = includesFix(await api([`${REPO}/compare/${receipt.sha}...${pr.merge_commit_sha}`]));
      if (!where[branch]) return { live: false, reason: `the fix is not on ${branch}`, pr, files, where };
      const status = receipt.statuses?.find((s) => s.context === `A House Divided - ${service}`);
      if (status?.state !== "success") return { live: false, reason: `${service} deployment is not successful on this commit`, pr, files, where };
      deployment[service] = { sha: receipt.sha, url: status.target_url };
    }
    const health = await mcp.call("railway", "railway_status", {}, false, signal);
    for (const { service } of services) {
      if (health?.services?.find((s) => s.service === service)?.status !== "SUCCESS") return { live: false, reason: `${service} latest deployment is not successful`, pr, files, where, deployment };
    }
    return { live: true, pr, files, where, deployment };
  } catch (e) { return { live: false, reason: `deployment evidence unavailable: ${String(e.message).slice(0, 160)}` }; }
}

module.exports = { verifyLiveFix };
