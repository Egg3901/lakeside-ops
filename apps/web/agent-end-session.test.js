"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  END_READY_MARKER,
  END_SESSION_WRAPUP_PROMPT,
  detectEndReady,
} = require("./agent-end-session");

test("wrap-up prompt asks for commit, ops knowledge, and END_READY", () => {
  assert.match(END_SESSION_WRAPUP_PROMPT, /END SESSION/i);
  assert.match(END_SESSION_WRAPUP_PROMPT, /knowledge_save|ops-knowledge/i);
  assert.match(END_SESSION_WRAPUP_PROMPT, /commit/i);
  assert.match(END_SESSION_WRAPUP_PROMPT, /ahd-git-workflow|pipeline/i);
  assert.match(END_SESSION_WRAPUP_PROMPT, /worktree_fleet_status/);
  assert.match(END_SESSION_WRAPUP_PROMPT, /PR URL|recovery handoff/i);
  assert.ok(END_SESSION_WRAPUP_PROMPT.includes(END_READY_MARKER));
});

test("detectEndReady finds the marker with optional whitespace", () => {
  assert.equal(detectEndReady("done\n<!--END_READY-->\n"), true);
  assert.equal(detectEndReady("<!-- END_READY -->"), true);
  assert.equal(detectEndReady("still working"), false);
});
