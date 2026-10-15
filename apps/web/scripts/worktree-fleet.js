#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { enrichPullRequests, inventoryAsync, pruneSafe, archiveCandidates, quarantineStaleDirty, summarize } = require("../src/core/worktree-lifecycle");

const roots = (process.env.WORKTREE_AUDIT_ROOTS || "/root/projects:/root/personal:/root/misc").split(":").filter(Boolean);
async function main() {
const report = enrichPullRequests(await inventoryAsync({ roots }));
const before = summarize(report);
const output = { generatedAt: new Date().toISOString(), roots, before, repositories: report };

if (process.argv.includes("--prune-safe")) {
  output.actions = pruneSafe(report);
  const afterReport = enrichPullRequests(await inventoryAsync({ roots }));
  output.after = summarize(afterReport);
  output.repositories = afterReport;
}

if (process.argv.includes("--archive-candidates")) {
  const archiveArg = process.argv.find(arg => arg.startsWith("--archive-root="));
  if (!archiveArg) throw new Error("--archive-candidates requires --archive-root=<absolute path>");
  output.archiveActions = archiveCandidates(report, { archiveRoot: archiveArg.slice("--archive-root=".length), generatedAt: output.generatedAt });
  const afterReport = enrichPullRequests(await inventoryAsync({ roots }));
  output.after = summarize(afterReport);
  output.repositories = afterReport;
}

if (process.argv.includes("--quarantine-stale-dirty")) {
  const archiveArg = process.argv.find(arg => arg.startsWith("--archive-root="));
  if (!archiveArg) throw new Error("--quarantine-stale-dirty requires --archive-root=<absolute path>");
  output.quarantineActions = quarantineStaleDirty(report, { archiveRoot: archiveArg.slice("--archive-root=".length), generatedAt: output.generatedAt });
  const afterReport = enrichPullRequests(await inventoryAsync({ roots }));
  output.after = summarize(afterReport);
  output.repositories = afterReport;
}

const outputArg = process.argv.find(arg => arg.startsWith("--output="));
if (outputArg) {
  const destination = path.resolve(outputArg.slice("--output=".length));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(output, null, 2)}\n`, { flag: "wx" });
  fs.renameSync(temporary, destination);
  console.log(JSON.stringify({ output: destination, before: output.before, actions: output.actions?.length || 0, after: output.after }, null, 2));
} else {
  console.log(JSON.stringify(output, null, 2));
}
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
