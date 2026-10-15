"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { MongoClient, ObjectId, BSON } = require("mongodb");
const { readWorldsimExperimentReport, readWorldsimTelemetryPage, validateHeaders } = require("./worldsim-report-storage");

test("validates both storage versions and refuses incomplete generations", () => {
  const headers = [{ field: "seatsTimeline", sequence: 0, pointCount: 30 }];
  assert.equal(validateHeaders({ version: 1, generation: "old", chunkCount: 1 }, headers).get("seatsTimeline").total, 30);
  const manifest = { version: 2, generation: "new", chunkCount: 1, fields: [{ path: "seatsTimeline", chunkCount: 1, pointCount: 30 }] };
  assert.equal(validateHeaders(manifest, headers).get("seatsTimeline").total, 30);
  assert.throws(() => validateHeaders(manifest, []), /Incomplete/);
  assert.throws(() => validateHeaders(manifest, [{ ...headers[0], sequence: 1 }]), /Non-contiguous/);
  assert.throws(() => validateHeaders({ ...manifest, fields: [...manifest.fields, ...manifest.fields] }, headers), /manifest/);
  assert.throws(() => validateHeaders({ ...manifest, fields: [{ ...manifest.fields[0], pointCount: 31 }] }, headers), /Incomplete/);
  assert.throws(() => validateHeaders({ version: 1, generation: "old", chunkCount: 1 }, [{ field: "unknown", sequence: 0, pointCount: 1 }]), /manifest/);
});

test("rejects invalid limits and pagination before database access", async () => {
  const db = { collection() { throw new Error("unexpected database access"); } };
  await assert.rejects(readWorldsimExperimentReport(db, "run", 9), /limit/);
  await assert.rejects(readWorldsimTelemetryPage(db, "run", "macro", "points", -1, 10), /selection/);
  await assert.rejects(readWorldsimTelemetryPage(db, "run", "macro", "points", 0, 101), /limit/);
  await assert.rejects(readWorldsimTelemetryPage(db, "run", "invalid", "points", 0, 10), /selection/);
});

const uri = process.env.WORLDSIM_REPORT_TEST_MONGO_URI;
test("actual Mongo restores samples, exact coverage and paged evidence without fetching the full report", { skip: !uri }, async () => {
  const url = new URL(uri);
  assert.equal(url.protocol, "mongodb:");
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  const client = new MongoClient(uri, { monitorCommands: true, serverSelectionTimeoutMS: 5000 });
  let commands = 0, requestBytes = 0, replyBytes = 0;
  client.on("commandStarted", event => { commands++; requestBytes += BSON.calculateObjectSize(event.command); });
  client.on("commandSucceeded", event => { replyBytes += BSON.calculateObjectSize({ reply: event.reply }) - 12; });
  await client.connect();
  const db = client.db(`ahd_test_worldsim_reports_${new ObjectId().toHexString()}`);
  try {
    const hello = await client.db("admin").command({ hello: 1 });
    assert.ok(hello.setName && hello.isWritablePrimary);
    const seats = Array.from({ length: 103 }, (_, turn) => ({ turn }));
    const points = Array.from({ length: 30 }, (_, turn) => ({ turn, value: turn / 10, payload: "x".repeat(20000) }));
    const coverage = [{ expectedPoints: 31, observedPoints: 30, missingTurns: [31] }];
    const chunks = [
      { field: "seatsTimeline", sequence: 0, points: seats.slice(0, 37) },
      { field: "seatsTimeline", sequence: 1, points: seats.slice(37) },
      { field: "longHorizonTelemetry.approval.points", sequence: 0, points: points.slice(0, 17) },
      { field: "longHorizonTelemetry.approval.points", sequence: 1, points: points.slice(17) },
      { field: "longHorizonTelemetry.approval.series", sequence: 0, points: coverage },
    ];
    const generation = "fixture-v2";
    await db.collection("simExperimentReportChunks").insertMany(chunks.map(row => ({ ...row, runId: "chunked", generation })));
    await db.collection("simExperimentReports").insertOne({ _id: "chunked", turn: 480,
      runConfig: { source: { requestedCommit: "simulation", executedCommit: "simulation", collectorCommit: "collector", executedPath: "unrequested" } },
      longHorizonTelemetry: { availability: "observed-partial", approval: { points: [], series: [] }, macro: { points: [], series: [] } },
      timelineStorage: { version: 2, generation, chunkCount: chunks.length, fields: [
        { path: "seatsTimeline", pointCount: 103, chunkCount: 2 },
        { path: "longHorizonTelemetry.approval.points", pointCount: 30, chunkCount: 2 },
        { path: "longHorizonTelemetry.approval.series", pointCount: 1, chunkCount: 1 },
      ] },
    });
    commands = requestBytes = replyBytes = 0;
    const report = await readWorldsimExperimentReport(db, "chunked", 10);
    const measured = { commands, requestBytes, replyBytes };
    assert.deepEqual(report.seatsTimeline, Array.from({ length: 10 }, (_, index) => seats[Math.floor(index * (103 / 10))]));
    assert.deepEqual(report.longHorizonTelemetry.approval.series, coverage);
    assert.equal("points" in report.longHorizonTelemetry.approval, false);
    assert.equal(report.longHorizonTelemetry.approval.pointsCount, 30);
    assert.equal(report.longHorizonTelemetry.source.executedCommit, "simulation");
    assert.equal("executedPath" in report.longHorizonTelemetry.source, false);
    assert.ok(measured.replyBytes < 10000);
    process.stdout.write(JSON.stringify({ fixture: "node-worldsim-chunk-summary", ...measured }) + "\n");
    const collected = [];
    let offset = 0;
    do {
      const page = await readWorldsimTelemetryPage(db, "chunked", "approval", "points", offset, 11, generation);
      assert.equal(page.total, 30);
      collected.push(...page.points);
      offset = page.nextOffset;
    } while (offset !== null);
    assert.deepEqual(collected, points);
    assert.deepEqual((await readWorldsimTelemetryPage(db, "chunked", "approval", "series", 0, 10, generation)).points, coverage);
    await assert.rejects(readWorldsimTelemetryPage(db, "chunked", "approval", "points", 0, 10, "different"), /generation changed/);
    await db.collection("simExperimentReports").insertOne({ _id: "inline", seatsTimeline: seats, longHorizonTelemetry: { approval: { points, series: coverage } } });
    assert.deepEqual((await readWorldsimExperimentReport(db, "inline", 10)).longHorizonTelemetry.approval.points, points);
    await db.collection("simExperimentReportChunks").insertOne({ runId: "v1", generation: "old", field: "seatsTimeline", sequence: 0, points: seats });
    await db.collection("simExperimentReports").insertOne({ _id: "v1", timelineStorage: { version: 1, generation: "old", chunkCount: 1 } });
    assert.equal((await readWorldsimExperimentReport(db, "v1", 10)).seatsTimeline.length, 10);
    assert.equal(await readWorldsimExperimentReport(db, "missing", 10), null);
    await db.collection("simExperimentReportChunks").deleteOne({ runId: "chunked", field: "longHorizonTelemetry.approval.points", sequence: 1 });
    await assert.rejects(readWorldsimExperimentReport(db, "chunked", 10), /Incomplete/);
  } finally {
    await db.dropDatabase();
    await client.close();
  }
});
