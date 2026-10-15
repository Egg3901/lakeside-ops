"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isGeneratedNoise } = require("./clean-worktree-noise");

test("recognizes only disposable build and agent log paths", () => {
  for (const file of ["muse.log", "muse-review.log", "phase1-run.old.log", "node_modules", "apps/web/node_modules/a.js", "target-local/debug/a", "scripts/__pycache__/x.pyc", ".muse-tmp/result"]) {
    assert.equal(isGeneratedNoise(file), true, file);
  }
  for (const file of ["src/app.ts", "OUT_CHANGES.md", "package-lock.json", "review.md", ".env"]) {
    assert.equal(isGeneratedNoise(file), false, file);
  }
});
