#!/usr/bin/env node
"use strict";
// Keir 3.0 stage A evidence tool: project work records over a ledger snapshot
// and print the structural integrity report. Read-only. Counts and ids only.
// Usage: keir-workrecords.js [ledger.json] [--records]
const fs = require("node:fs");
const { projectWorkRecords, integrityReport } = require("../lib/operator/workrecord");

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--")) || "/var/lib/keir-operator/ledger.json";
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const report = integrityReport(data);
if (args.includes("--records")) {
  const { records } = projectWorkRecords(data);
  const active = Object.values(records).filter((r) => r.state !== "terminal");
  console.log(JSON.stringify({ report, activeRecords: active }, null, 2));
} else {
  console.log(JSON.stringify(report, null, 2));
}
if (report.problems.length || report.unmappedJobs.length) process.exitCode = 1;
