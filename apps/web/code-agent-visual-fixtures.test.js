"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fixtures = require("./code-agent-visual-fixtures");

describe("code agent visual fixtures", () => {
  it("covers attention, working, ready, active chat, and completed chat states", () => {
    const sessions = fixtures.sessions;
    assert.ok(sessions.some((session) => session.needsInput));
    assert.ok(sessions.some((session) => session.activity === "working"));
    assert.ok(sessions.some((session) => session.activity === "ready"));
    assert.ok(sessions.some((session) => session.status === "active"));
    assert.ok(sessions.some((session) => session.status === "completed"));
  });

  it("includes a busy transcript with prose, thinking, completed tools, and a running tool", () => {
    const blocks = fixtures.transcript.turns.flatMap((turn) => turn.blocks);
    assert.equal(fixtures.transcript.busy, true);
    assert.ok(blocks.some((block) => block.type === "text"));
    assert.ok(blocks.some((block) => block.type === "thinking"));
    assert.ok(blocks.some((block) => block.type === "tools"));
    assert.ok(blocks.some((block) => block.items?.some((item) => item.running)));
    assert.ok(blocks.some((block) => block.items?.some((item) => !item.running)));
  });
});
