#!/usr/bin/env node
"use strict";
// Keir 3.0 ledger migration rehearsal. Dry-run by default: reports exactly
// what a migration would add without touching the file. --apply writes a
// timestamped backup next to the ledger, then adds the additive v3 work
// record projection (data.v3 = { records, migratedAt }) inside the same v1
// envelope, so the 2.x binary keeps reading the file and rollback is
// restoring the backup or deleting the v3 key. Authority never expands:
// the migration adds projections only, it never alters jobs, actions,
// decisions, approvals or pause state.
// --apply refuses while keir-operator.service is active: the operator is the
// single ledger writer, holds the whole ledger in memory and rewrites it on
// every save, so a concurrent apply either loses its own v3 key or the
// operator's writes. It also refuses if the file changed between read and
// rename, and never shares the operator's `ledger.json.tmp` temp path.
// Usage: keir-migrate-v3.js [ledger.json] [--apply]
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { projectWorkRecords, integrityReport, sourceDigest, v3Stale } = require("../lib/operator/workrecord");

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--")) || "/var/lib/keir-operator/ledger.json";
const apply = args.includes("--apply");
const before = fs.statSync(file);
const raw = fs.readFileSync(file, "utf8");
const data = JSON.parse(raw);
if (data.version !== 1) { console.error("unsupported ledger version"); process.exit(2); }
const report = integrityReport(data);
if (report.problems.length || report.unmappedJobs.length) {
  console.error(JSON.stringify({ ok: false, report }, null, 2));
  process.exit(1);
}
const { records } = projectWorkRecords(data);
const summary = { ok: true, paused: data.paused === true,
  jobs: report.jobs, records: Object.keys(records).length,
  alreadyMigrated: Boolean(data.v3), staleSnapshot: v3Stale(data), apply };
if (!apply) { console.log(JSON.stringify({ ...summary, mode: "dry-run" }, null, 2)); process.exit(0); }
const systemctl = process.env.KEIR_SYSTEMCTL || "systemctl";
const unit = spawnSync(systemctl, ["is-active", "--quiet", "keir-operator.service"]);
if (unit.error?.code !== "ENOENT" && unit.status === 0) {
  console.error(JSON.stringify({ ok: false, reason: "keir-operator.service is active; stop it before --apply" }));
  process.exit(3);
}
function durableWrite(target, content) {
  const fd = fs.openSync(target, "w", 0o600);
  try { fs.writeSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function fsyncDir(dir) { const fd = fs.openSync(dir, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
const backup = `${file}.pre-v3-${new Date().toISOString().replace(/[:.]/g, "-")}`;
durableWrite(backup, raw);
data.v3 = { records, migratedAt: Date.now(), sourceDigest: sourceDigest(data) };
const tmp = `${file}.v3-migrate-tmp`;
durableWrite(tmp, JSON.stringify(data));
const latest = fs.statSync(file);
if (latest.mtimeMs !== before.mtimeMs || latest.size !== before.size) {
  fs.rmSync(tmp, { force: true });
  console.error(JSON.stringify({ ok: false, reason: "ledger changed while migrating; another writer is active", backup }));
  process.exit(4);
}
fs.renameSync(tmp, file);
fsyncDir(path.dirname(file));
// Post-write proof: re-reading must reproduce the same record count.
const check = JSON.parse(fs.readFileSync(file, "utf8"));
const verified = Object.keys(check.v3?.records || {}).length === Object.keys(records).length
  && check.paused === data.paused;
console.log(JSON.stringify({ ...summary, mode: "applied", backup, verified }, null, 2));
if (!verified) process.exit(1);
