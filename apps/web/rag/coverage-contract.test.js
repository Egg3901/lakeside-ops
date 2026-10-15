"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { auditCoverage } = require("./coverage-contract");

test("reports a required source gap without conflating source kinds", () => {
  const sources = [
    { kind: "code", documents: [{ path: "src/bills.ts", text: "cloture" }] },
    { kind: "docs", documents: [{ path: "design/bills.md", text: "legislation" }] },
    { kind: "wiki", documents: [] },
  ];
  const result = auditCoverage(sources, [
    { id: "legislation", pattern: /bill|cloture|legislation/i, required: ["code", "docs", "wiki"] },
  ]);
  assert.equal(result.ready, false);
  assert.deepEqual(result.gaps, [{ domain: "legislation", source: "wiki" }]);
  assert.deepEqual(result.domains.legislation, { code: 1, docs: 1, wiki: 0 });
});
