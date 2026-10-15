"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { MongoClient } = require("mongodb");
const crypto = require("node:crypto");
const uri = process.env.FEDERATION_TEST_MONGO_URI;

test("scheduler queues a complete 1991 horizon in an isolated control database", { skip: !uri }, async () => {
  const address = new URL(uri);
  assert.equal(address.protocol, "mongodb:");
  assert.ok(["localhost", "127.0.0.1"].includes(address.hostname));
  const name = `ahd_test_ops_horizon_${crypto.randomUUID().replaceAll("-", "")}`;
  process.env.SIM_CONTROL_URI = uri;
  process.env.SIM_CONTROL_DB = name;
  const { enqueueWorldSim } = require("./scheduler-service");
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  try {
    const runId = await enqueueWorldSim({ preset: "1991-default", turns: 1776, seed: "synthetic_horizon" });
    const job = await client.db(name).collection("simJobs").findOne({ _id: runId });
    assert.equal(job.turns, 1776);
    assert.equal(job.preset, "1991-default");
    assert.equal(job.status, "queued");
    assert.equal(job.currentTurn, 0);
    assert.equal(job.startPolicy, "window");
    assert.match(job.dbName, /^ahd_sim_/);
    assert.equal(job.cloneFromLive, undefined);
    await assert.rejects(enqueueWorldSim({ preset: "1991-default", turns: 2001, seed: "too_long" }), /between 1 and 2000/);
    assert.equal(await client.db(name).collection("simJobs").countDocuments({}), 1);
  } finally {
    await client.db(name).dropDatabase();
    await client.close();
  }
});
