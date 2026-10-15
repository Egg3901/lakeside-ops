#!/usr/bin/env node
"use strict";
// Keir 3.0 baseline metrics over a ledger snapshot plus usage log. Read-only.
// Usage: keir-metrics.js [ledger.json] [usage.jsonl]
const fs = require("node:fs");
const { computeMetrics, parseUsage } = require("../lib/operator/metrics");

const [ledgerFile, usageFile] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(ledgerFile || "/var/lib/keir-operator/ledger.json", "utf8"));
let usage = [];
try { usage = parseUsage(fs.readFileSync(usageFile || "/var/lib/keir-operator/usage.jsonl", "utf8")); } catch { /* usage is optional evidence */ }
console.log(JSON.stringify(computeMetrics(data, usage), null, 2));
