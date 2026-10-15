"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { includeGameFile, summarizeCoverage } = require("./source-corpus");

test("game discovery is limited to searchable shipped source", () => {
  assert.equal(includeGameFile("src/lib/elections/cloture.ts"), true);
  assert.equal(includeGameFile("src/lib/seeds/wiki/content/senate.ts"), true);
  assert.equal(includeGameFile("scripts/import.ts"), false);
  assert.equal(includeGameFile("src/generated/schema.ts"), true);
  assert.equal(includeGameFile("src/assets/logo.png"), false);
});

test("coverage summaries retain independent revisions and areas", () => {
  const report = summarizeCoverage([
    { kind: "code", repository: "game", revision: "a", documents: [{ path: "src/lib/a.ts", text: "one" }] },
    { kind: "docs", repository: "docs", revision: "b", documents: [{ path: "design/a.md", text: "two" }] },
    { kind: "wiki", repository: "game", revision: "a", documents: [{ path: "src/lib/seeds/wiki/content/a.ts", text: "three" }] },
  ]);
  assert.equal(report.code.revision, "a");
  assert.equal(report.docs.revision, "b");
  assert.equal(report.wiki.files, 1);
});
