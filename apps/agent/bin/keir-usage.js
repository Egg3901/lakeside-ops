#!/usr/bin/env node
"use strict";
// Read-only: keir-usage.js [usage.jsonl] [hours, default 24]
const path = require("node:path");
const { readUsage } = require("../lib/operator/usage");
const [file, hours = "24"] = process.argv.slice(2), until = Date.now();
const n = Number(hours);
if (!Number.isFinite(n) || n <= 0 || n > 8760) throw new Error("Hours must be between 0 and 8760");
readUsage(file || path.join(process.env.KEIR_STATE_DIR || "/var/lib/keir-operator", "usage.jsonl"), { since: until - n * 3600000, until })
  .then(report => console.log(JSON.stringify(report, null, 2))).catch(e => { console.error(e.message); process.exitCode = 1; });
