"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { renderWorldsimTimeline, readWorldsimQueue } = require("./worldsim-run-timeline");
const { buildWorldsimDashboard } = require("./worldsim-dashboard");

const jobs = Array.from({ length: 8 }, (_, index) => ({
  _id: `run-${index}`, seed: `World ${index}`, preset: "1991-default",
  createdAt: `2026-09-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
  status: index === 0 ? "running" : "queued", currentTurn: index === 0 ? 154 : 0, turns: 480,
}));

test("queue timeline shows six recent jobs before collapsed history, regardless of report publication", () => {
  const html = renderWorldsimTimeline(jobs, [
    { category: "World Simulations", slug: "old-report", runId: "run-0", publishedAt: "2026-10-01" },
  ]);
  const beforeMore = html.split('<details class="sim-more">')[0];
  assert.equal((beforeMore.match(/class="sim-event"/g) || []).length, 6);
  assert.equal((html.match(/class="sim-event"/g) || []).length, 8);
  assert.ok(html.indexOf('data-run-id="run-7"') < html.indexOf('data-run-id="run-6"'));
  assert.ok(html.indexOf('data-run-id="run-1"') > html.indexOf('<details'));
  assert.match(html, /Show more \(2\)/);
  assert.doesNotMatch(html, /<details[^>]* open/);
  assert.match(beforeMore, /Running now/);
  assert.match(beforeMore, /World 0 · raw turn 154/);
  assert.match(html, /href="\/reports\/worldsim-run-run-0"/);
});

test("queued, stopped and triggered runs retain their actual timing without invented zero progress", () => {
  const html = renderWorldsimTimeline([
    { _id: "queued", seed: "Awaiting window", status: "queued", currentTurn: 0, createdAt: "2026-09-30T11:00:00Z" },
    { _id: "stopped", seed: "Stopped world", status: "failed", currentTurn: 125, createdAt: "2026-09-29T10:00:00Z", workerStartedAt: "2026-09-30T08:00:00Z", ownerStoppedAt: "2026-09-30T13:21:21Z" },
    { _id: "triggered", seed: "Triggered world", status: "failed", currentTurn: 0, triggeredAt: "2026-09-30T12:00:00Z" },
  ]);
  assert.ok(html.indexOf('data-run-id="triggered"') < html.indexOf('data-run-id="queued"'));
  assert.match(html, /Not started/);
  assert.match(html, /No completed turn recorded/);
  assert.match(html, />Stopped<\/span>/);
  assert.match(html, /Raw turn 125/);
  assert.match(html, /Started <time datetime="2026-09-30T08:00:00.000Z"/);
  assert.match(html, /Triggered <time datetime="2026-09-30T12:00:00.000Z"/);
  assert.doesNotMatch(html, /0\.0%|width:0|Show more/);
});

test("report links require exact run identity and queue details are escaped", () => {
  const html = renderWorldsimTimeline([
    { _id: "new-run", seed: '<script>alert("seed")</script>', status: "failed", error: "secret connection string", dbName: "private-db" },
  ], [{ runId: "old-run", category: "World Simulations", seed: '<script>alert("seed")</script>', slug: "old-run-report" }]);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script|secret connection|private-db|old-run-report/);
});

test("dashboard puts the queue timeline above statistics", () => {
  const { html } = buildWorldsimDashboard({ manifest: [], jobs, artifacts: { live: {}, singleplayer: {} } });
  assert.ok(html.indexOf('class="sim-timeline"') < html.indexOf('class="kpis"'));
  assert.doesNotMatch(html, /<h2>Runs<\/h2>/);
});

test("queue reader includes unpublished jobs and only projects safe timeline fields", async () => {
  let projection;
  const db = { collection(name) {
    assert.equal(name, "simJobs");
    return { find(filter, options) {
      assert.deepEqual(filter, {});
      projection = options.projection;
      return { sort() { return { toArray: async () => jobs }; } };
    } };
  } };
  assert.equal((await readWorldsimQueue(db)).length, 8);
  assert.equal(projection.workerStartedAt, 1);
  for (const field of ["error", "dbName", "sourceRepoDir", "workerArguments", "metrics"])
    assert.equal(projection[field], undefined);
});

const fs = require("fs");
const os = require("os");
const path = require("path");
const { renderWorldsimRun, writeWorldsimRunPages } = require("./worldsim-run-pages");

test("every card opens its run and statuses have distinct styles", () => {
  const states = ["queued", "running", "completed", "failed", "cancelled"];
  const html = renderWorldsimTimeline(states.map((status, index) => ({ _id: `run-${index}`, status })));
  assert.equal((html.match(/class="sim-card sim-card-/g) || []).length, 5);
  for (const status of ["queued", "running", "completed", "failed", "stopped"])
    assert.match(html, new RegExp(`class="sim-status sim-status-${status}"`));
  assert.match(html, /one at a time/);
});

test("detail pages link only exact reports, escape values and explain stopped jobs", () => {
  const job = { _id: "run-1", seed: "<unsafe>", status: "failed", ownerStoppedAt: "2026-09-30", error: "secret" };
  const manifest = [{ category: "World Simulations", runId: "run-2", seed: "<unsafe>", slug: "other-report" }];
  let html = renderWorldsimRun(job, manifest);
  assert.match(html, /Stopped at the owner's request/);
  assert.match(html, /&lt;unsafe&gt;/);
  assert.doesNotMatch(html, /other-report|<unsafe>|secret/);
  manifest.push({ category: "World Simulations", runId: "run-1", slug: "correct-report" });
  html = renderWorldsimRun(job, manifest);
  assert.match(html, /href="\/reports\/correct-report"/);
});

test("page writer creates all destinations, skips unchanged files and rejects unsafe IDs", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "worldsim-pages-"));
  try {
    assert.equal(writeWorldsimRunPages(directory, jobs, []), 8);
    assert.equal(writeWorldsimRunPages(directory, jobs, []), 0);
    assert.match(fs.readFileSync(path.join(directory, "worldsim-run-run-0.html"), "utf8"), /Raw turn 154/);
    assert.throws(() => writeWorldsimRunPages(directory, [{ _id: "../escape" }], []), /Invalid/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("legacy report attachment uses its explicit footer ID without changing the manifest", () => {
  const { reportsWithRunIds } = require("./worldsim-run-pages");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "worldsim-legacy-"));
  const manifest = [{ category: "World Simulations", slug: "old-report", seed: "reused" }];
  try {
    fs.writeFileSync(path.join(directory, "old-report.html"), "x".repeat(65530) + "Run ID <code>run-0</code>");
    assert.equal(reportsWithRunIds(directory, manifest)[0].runId, "run-0");
    assert.equal(manifest[0].runId, undefined);
    writeWorldsimRunPages(directory, jobs, manifest);
    assert.match(fs.readFileSync(path.join(directory, "worldsim-run-run-0.html"), "utf8"), /href="\/reports\/old-report"/);
    assert.doesNotMatch(fs.readFileSync(path.join(directory, "worldsim-run-run-1.html"), "utf8"), /href="\/reports\/old-report"/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
