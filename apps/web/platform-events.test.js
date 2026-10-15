const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { normalizeEvent, parseStreamRows, platformEventToken, publishEvent } = require("./platform-events");

test("normalizes an allowed platform event", () => {
  const event = normalizeEvent({ type: "turn:completed", source: "ahd", occurredAt: "2026-09-22T00:00:00Z", payload: { turn: 42 } });
  assert.equal(event.type, "turn:completed");
  assert.equal(event.occurredAt, "2026-09-22T00:00:00.000Z");
  assert.equal(event.payload, '{"turn":42}');
});

test("refuses unknown event types and oversized payloads", () => {
  assert.throws(() => normalizeEvent({ type: "anything", source: "test" }), /Unsupported/);
  assert.throws(() => normalizeEvent({ type: "turn:failed", source: "test", payload: { text: "x".repeat(70_000) } }), /64 KiB/);
});

test("parses Redis stream rows into dashboard events", () => {
  assert.deepEqual(parseStreamRows([["1-0", ["type", "turn:completed", "source", "ahd", "payload", "{\"turn\":44}"]]]), [{
    streamId: "1-0", type: "turn:completed", source: "ahd", payload: { turn: 44 },
  }]);
});

test("reads a systemd credential without exposing it in process environment", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "platform-event-credential-"));
  fs.writeFileSync(path.join(directory, "platform-event-token"), "secret-value\n", { mode: 0o600 });
  try {
    assert.equal(platformEventToken({ CREDENTIALS_DIRECTORY: directory }), "secret-value");
    assert.equal(platformEventToken({ PLATFORM_EVENT_TOKEN: "env-value", CREDENTIALS_DIRECTORY: directory }), "env-value");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("publishes idempotently using the caller's stable event id", async () => {
  let command;
  const event = await publishEvent(
    { id: "ahd:turn:42:completed", type: "turn:completed", source: "ahd", payload: { turn: 42 } },
    { redisJson: async (args) => { command = args; return ["123-0", "0"]; } }
  );
  assert.equal(command[0], "EVAL");
  assert.equal(command[3], "lakeside:events");
  assert.equal(command[4], "lakeside:events:dedupe:ahd:turn:42:completed");
  assert.equal(event.streamId, "123-0");
  assert.equal(event.duplicate, false);
});

test("reports a retry as a duplicate without adding another stream row", async () => {
  const event = await publishEvent(
    { id: "stable-id", type: "turn:completed", source: "ahd" },
    { redisJson: async () => ["123-0", "1"] }
  );
  assert.equal(event.streamId, "123-0");
  assert.equal(event.duplicate, true);
});
