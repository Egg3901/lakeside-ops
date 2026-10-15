#!/usr/bin/env node
"use strict";
// Keir 3.0 shadow review, read-only. Runs beside keir-shadow during the soak
// so the two can be compared; it does not replace the timer on its own.
// Usage: keir-shadow3.js [ledger.json] [--minutes N] [--json file]
// Identity comes from KEIR_OWNER_ID and KEIR_STAFF_IDS (comma separated).
const fs = require("node:fs");
const { shadowReport } = require("../lib/operator/shadow3");

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith("--") && !String(args[i - 1]).startsWith("--")) || "/var/lib/keir-operator/ledger.json";
const now = Date.now();
const since = now - Number(opt("--minutes") || 20) * 60000;
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const report = shadowReport(data, { now, since, ownerId: process.env.KEIR_OWNER_ID || null,
  staffIds: (process.env.KEIR_STAFF_IDS || "").split(",").filter(Boolean) });
const out = opt("--json");
if (out) {
  const tmp = `${out}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(report), { mode: 0o600 });
  fs.renameSync(tmp, out);
}
console.log(JSON.stringify({ at: report.at, records: report.records, anomalies: report.anomalies.length,
  byKind: report.anomalies.reduce((m, a) => ({ ...m, [a.kind]: (m[a.kind] || 0) + 1 }), {}) }, null, 2));
