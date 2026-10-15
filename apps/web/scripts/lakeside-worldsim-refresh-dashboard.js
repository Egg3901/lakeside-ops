#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const { buildWorldsimDashboard } = require("../worldsim-dashboard");
const { writeWorldsimRunPages } = require("../worldsim-run-pages");
const { readWorldsimQueue } = require("../worldsim-run-timeline");

async function main() {
  const directory = process.env.WORLDSIM_PUBLISHED_DIR;
  if (!directory) throw new Error("WORLDSIM_PUBLISHED_DIR is required");
  const client = new MongoClient(process.env.SIM_CONTROL_URI || "mongodb://127.0.0.1:27018/sim_control", { maxPoolSize: 1, serverSelectionTimeoutMS: 5000 });
  await client.connect();
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
    const jobs = await readWorldsimQueue(client.db());
    const statuses = jobs.reduce((counts, job) => {
      counts[job.status] = (counts[job.status] || 0) + 1;
      return counts;
    }, {});
    writeWorldsimRunPages(directory, jobs, manifest);
    const { html } = buildWorldsimDashboard({ manifest, statuses, jobs });
    const output = path.join(directory, "worldsim-audit-program.html");
    const temp = `${output}.${process.pid}.tmp`;
    fs.writeFileSync(temp, html, { mode: 0o644 });
    fs.renameSync(temp, output);
    console.log(JSON.stringify({ ok: true, jobs: jobs.length, running: statuses.running || 0, bytes: html.length }));
  } finally { await client.close(); }
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { main };
