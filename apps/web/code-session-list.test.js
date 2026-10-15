"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { collectPersistedSessions } = require("./code-session-list");

test("session overview still succeeds while persisted chat storage connects", async () => {
  const result = await collectPersistedSessions(null);
  assert.deepEqual(result.sessions, []);
  assert.match(result.warning, /still connecting/i);
});

test("session overview degrades gracefully when persisted chat storage fails", async () => {
  const result = await collectPersistedSessions({
    listSessions: async () => { throw new Error("Topology is closed"); },
  });
  assert.deepEqual(result.sessions, []);
  assert.match(result.warning, /Topology is closed/);
});

test("session overview returns persisted chats when storage is healthy", async () => {
  const sessions = [{ sessionId: "chat-1" }];
  const result = await collectPersistedSessions({ listSessions: async () => sessions });
  assert.deepEqual(result, { sessions, warning: null });
});
