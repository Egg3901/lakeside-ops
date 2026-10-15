"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { canonicalRepository, canonicalGithubUrl, repositoryName } = require("../lib/operator/github");

test("legacy Keir identifiers publish new work to the canonical monorepo", () => {
  for (const owner of ["Egg3901", "lakesidegamedev"]) {
    assert.equal(canonicalRepository(`${owner}/lakeside-operator`), "lakesidegamedev/lakeside-operator");
    assert.equal(canonicalGithubUrl(`https://github.com/${owner}/lakeside-operator/pull/169`), "https://github.com/lakesidegamedev/lakeside-operator/pull/169");
    assert.equal(canonicalRepository(`${owner}/AHDGame`), "lakesidegamedev/AHDGame");
  }
  assert.equal(repositoryName("lakeside-operator"), "lakesidegamedev/lakeside-ops");
  assert.equal(canonicalRepository("another/stack"), "another/stack");
  assert.equal(canonicalGithubUrl("https://example.com/Egg3901/lakeside-operator/pull/1"), "https://example.com/Egg3901/lakeside-operator/pull/1");
});
