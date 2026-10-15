"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { MAX_SIM_TURNS, simTurnsSchema, assertSimTurns } = require("./worldsim-limits");
const { makeSchedulerBody } = require("./scheduler-page");
const { enqueueWorldSim } = require("./scheduler-service");

for (const turns of [1, 1000, 1728, 1776, 1824, 2000]) {
  test(`accepts bounded horizon ${turns} through both request validators`, () => {
    assert.equal(simTurnsSchema(z).parse(turns), turns);
    assert.equal(assertSimTurns(turns), turns);
    assert.equal(assertSimTurns(String(turns)), turns);
  });
}
for (const turns of [0, -1, 2001, 5000, 1.5, Infinity, NaN, null, true]) {
  test(`rejects invalid turn count ${String(turns)} before queue access`, async () => {
    assert.equal(simTurnsSchema(z).safeParse(turns).success, false);
    assert.throws(() => assertSimTurns(turns), /between 1 and 2000/);
    await assert.rejects(enqueueWorldSim({ preset: "1991-default", turns, seed: "horizon_invalid" }), /between 1 and 2000/);
  });
}
test("the scheduler form accepts the complete bounded horizon", () => {
  assert.match(makeSchedulerBody().body, new RegExp(`name="turns"[^>]+max="${MAX_SIM_TURNS}"`));
});

test("registered MCP world and election tools accept pinned horizons and reject excess turns", { timeout: 5000 }, async () => {
  const filename = path.join(__dirname, "mcp/worldsim-server.js");
  const localRequire = createRequire(filename);
  const tools = new Map();
  const jobs = [];
  const database = { collection(name) {
    assert.equal(name, "simJobs");
    return { async insertOne(job) { jobs.push(job); } };
  } };
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  class CapturedServer {
    tool(name, description, schema, handler) { tools.set(name, { schema: z.object(schema), handler }); }
  }
  const overrides = {
    "dotenv": { config() {} },
    "mongodb": { MongoClient: class { async connect() {} db() { return database; } } },
    "@modelcontextprotocol/sdk/server/mcp.js": { McpServer: CapturedServer },
    "../knowledge-store": { async getDb() { return database; } },
    "../agent-tokens": { async ensureIndexes() {} },
    "../packages/mcp-server": { createServer({ buildServer }) { buildServer(); resolveReady(); } },
  };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    require: name => Object.hasOwn(overrides, name) ? overrides[name] : localRequire(name),
    __dirname: path.dirname(filename),
    process: { env: {}, exit(code) { throw new Error(`Unexpected server exit ${code}`); } },
    console: { log() {}, error() {} },
  }, { filename });
  await ready;
  const pin = { sourceWorktree: "synthetic_horizon", sourceCommit: "a".repeat(40) };
  for (const name of ["sim_run_world", "sim_run_election"]) {
    const tool = tools.get(name);
    assert.ok(tool);
    const args = { preset: "1991-default", turns: 1776, seed: "synthetic_horizon", ...pin, ...(name === "sim_run_world" ? { startPolicy: "window" } : {}) };
    assert.equal(tool.schema.safeParse({ ...args, turns: 2001 }).success, false);
    const result = await tool.handler(tool.schema.parse(args));
    assert.equal(JSON.parse(result.content[0].text).status, "queued");
    const job = jobs.at(-1);
    assert.equal(job.turns, 1776);
    assert.equal(job.sourceWorktree, pin.sourceWorktree);
    assert.equal(job.sourceCommit, pin.sourceCommit);
    assert.equal(job.status, "queued");
    assert.match(job.dbName, /^ahd_sim_/);
    assert.equal(job.cloneFromLive, undefined);
  }
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].startPolicy, "window");
  assert.equal(jobs[1].mode, "elections-only");
});
