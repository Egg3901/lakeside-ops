"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TtlCache,
  compactUnchangedSnapshot,
  fingerprintOutput,
} = require("./live-agent-cache");

test("TTL cache reuses expensive values inside its freshness window", () => {
  const cache = new TtlCache(1000);
  let builds = 0;
  assert.equal(cache.get("agent", () => ++builds), 1);
  assert.equal(cache.get("agent", () => ++builds), 1);
  assert.equal(builds, 1);
});

test("unchanged live snapshots omit the large transcript payload", () => {
  const output = "long terminal output".repeat(1000);
  const version = fingerprintOutput(output);
  const compact = compactUnchangedSnapshot({
    version,
    output,
    transcript: { blocks: [{ type: "text", text: output }] },
    userAttachments: [{ images: [] }],
    queue: [],
    model: "gpt-5.6-sol",
  }, version);

  assert.equal(compact.unchanged, true);
  assert.equal(compact.output, undefined);
  assert.equal(compact.transcript, undefined);
  assert.equal(compact.userAttachments, undefined);
  assert.equal(compact.model, "gpt-5.6-sol");
});

test("changed snapshots retain the full transcript", () => {
  const snapshot = { version: "new", output: "answer", transcript: { turns: [] } };
  assert.equal(compactUnchangedSnapshot(snapshot, "old"), snapshot);
});

test("fingerprint is stable for identical input and differs for changes", () => {
  const a = "line1\nline2\nline3\n";
  assert.equal(fingerprintOutput(a), fingerprintOutput(a));
  assert.notEqual(fingerprintOutput(a), fingerprintOutput(a + "line4\n"));
  assert.notEqual(fingerprintOutput(""), fingerprintOutput("x"));
  assert.ok(fingerprintOutput("x").length <= 12);
});
