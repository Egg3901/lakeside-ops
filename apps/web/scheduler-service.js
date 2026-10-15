"use strict";
const { assertSimTurns } = require("./worldsim-limits");

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const crypto = require("crypto");
const { promisify } = require("util");
const { MongoClient } = require("mongodb");
const { getConfig } = require("./src/core/config");

const execFileAsync = promisify(execFile);
const schedulerConfig = getConfig().scheduler || {};
const QUEUE_BIN = process.env.CHECK_SCHEDULER_BIN || schedulerConfig.queueBin || "lakeside-check-queue";
const QUEUE_ROOT = process.env.CHECK_SCHEDULER_STATE || schedulerConfig.queueRoot || path.join(os.homedir(), ".local", "state", "ops-dashboard", "check-queue");
const SIM_CONTROL_URI = process.env.SIM_CONTROL_URI || "mongodb://127.0.0.1:27018";
const SIM_CONTROL_DB = process.env.SIM_CONTROL_DB || "sim_control";
const HYGIENE_REPORT = process.env.HYGIENE_REPORT || schedulerConfig.hygieneReport || path.join(QUEUE_ROOT, "hygiene.json");

const CHECK_PRESETS = Object.freeze({
  typecheck: ["npm", "run", "typecheck"],
  test: ["npm", "test"],
  verify: ["npm", "run", "verify"],
  build: ["npm", "run", "build"],
});
let previousCpuSample = null;

function cpuUsagePct() {
  try {
    const fields = fs.readFileSync("/proc/stat", "utf8").split("\n")[0].trim().split(/\s+/).slice(1).map(Number);
    const idle = fields[3] + (fields[4] || 0);
    const total = fields.reduce((sum, value) => sum + value, 0);
    const current = { idle, total };
    if (!previousCpuSample) { previousCpuSample = current; return null; }
    const totalDelta = total - previousCpuSample.total;
    const idleDelta = idle - previousCpuSample.idle;
    previousCpuSample = current;
    return totalDelta > 0 ? Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 100))) : null;
  } catch { return null; }
}

function safeJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function listCheckJobs(limit = 50) {
  const jobs = [];
  for (const bucket of ["running", "queued", "finished"]) {
    const dir = path.join(QUEUE_ROOT, bucket);
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const job = safeJson(path.join(dir, name));
      if (job) jobs.push(job);
    }
  }
  return jobs.sort((a, b) => String(b.requested_at).localeCompare(String(a.requested_at))).slice(0, limit);
}

async function enqueueCheck({ workdir, preset, label, priority = "normal" }) {
  if (!CHECK_PRESETS[preset]) throw new Error("Unknown check preset");
  if (!/^(low|normal|high)$/.test(priority)) throw new Error("Invalid priority");
  const args = ["enqueue", "--workdir", String(workdir), "--label", String(label || preset).slice(0, 120), "--priority", priority, "--", ...CHECK_PRESETS[preset]];
  const { stdout } = await execFileAsync(QUEUE_BIN, args, { timeout: 5000 });
  return stdout.trim();
}

async function listWorldSims(limit = 30) {
  const client = new MongoClient(SIM_CONTROL_URI, { serverSelectionTimeoutMS: 1500 });
  try {
    await client.connect();
    return await client.db(SIM_CONTROL_DB).collection("simJobs")
      .find({}, { projection: { metrics: 0 } }).sort({ createdAt: -1 }).limit(limit).toArray();
  } finally { await client.close().catch(() => {}); }
}

async function enqueueWorldSim({ preset, turns, seed, autonomyLevel = "v3", marketSystemMode = "off" }) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(String(preset || ""))) throw new Error("Invalid preset");
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(String(seed || ""))) throw new Error("Invalid seed");
  turns = assertSimTurns(turns);
  if (!["v3", "v4", "v5"].includes(autonomyLevel)) throw new Error("Invalid autonomy level");
  if (!["off", "realization", "ledger", "clearing", "capital", "plants"].includes(marketSystemMode)) throw new Error("Invalid market mode");
  const runId = crypto.randomUUID();
  const now = new Date();
  const client = new MongoClient(SIM_CONTROL_URI, { serverSelectionTimeoutMS: 1500 });
  try {
    await client.connect();
    await client.db(SIM_CONTROL_DB).collection("simJobs").insertOne({
      _id: runId, runId, preset, turns, seed,
      dbName: `ahd_sim_${seed}`.replace(/[^a-zA-Z0-9_-]/g, "_"),
      autonomyLevel, marketSystemMode, startPolicy: "window", status: "queued", currentTurn: 0,
      error: null, createdAt: now, updatedAt: now, source: "ops-scheduler",
    });
    return runId;
  } finally { await client.close().catch(() => {}); }
}

function hostSnapshot() {
  const total = os.totalmem();
  const free = os.freemem();
  const checks = listCheckJobs();
  const disk = fs.statfsSync("/");
  const diskTotal = disk.blocks * disk.bsize;
  const diskFree = disk.bavail * disk.bsize;
  return {
    cpuCount: os.cpus().length,
    cpuUsedPct: cpuUsagePct(),
    load: os.loadavg().map((n) => Number(n.toFixed(2))),
    memory: { total, free, used: total - free, usedPct: Math.round(((total - free) / total) * 100) },
    disk: { total: diskTotal, free: diskFree, used: diskTotal - diskFree, usedPct: Math.round(((diskTotal - diskFree) / diskTotal) * 100) },
    checks: {
      running: checks.filter((j) => j.state === "running").length,
      queued: checks.filter((j) => j.state === "queued").length,
    },
  };
}

async function schedulerSnapshot() {
  const checks = listCheckJobs();
  let worldSims = [];
  let worldSimError = null;
  try { worldSims = await listWorldSims(); } catch (error) { worldSimError = error.message; }
  const hygiene = safeJson(HYGIENE_REPORT);
  return { host: hostSnapshot(), checks, worldSims, worldSimError, hygiene, presets: Object.keys(CHECK_PRESETS) };
}

module.exports = { CHECK_PRESETS, enqueueCheck, enqueueWorldSim, listCheckJobs, listWorldSims, schedulerSnapshot };
