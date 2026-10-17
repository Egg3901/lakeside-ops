"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { leaked } = require("../lib/operator/toolmarkup");

test("printed tool calls are recognised and never treated as an answer", () => {
  assert.equal(leaked('I will check.\n<tool_calls>\n<invoke name="mcp__keir__github">\n<parameter name="action">status</parameter>\n</invoke>\n</tool_calls>'), true);
  assert.equal(leaked("<｜DSML｜function_calls>"), true);
  assert.equal(leaked("PR #4404 is green and merged; the fix is live on the main server."), false);
  assert.equal(leaked("Use the invoke button in settings."), false);
});
