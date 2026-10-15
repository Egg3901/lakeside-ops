"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { classifyReport, annotateReport, publishReadinessInventory } = require("./readiness-inventory");
const acceptedSlug = "worldsim-audit-europe-control-1991-0929";
const html = (gate) => `<html><body><h1>Complete</h1>${gate ? `<script id="qualification-data" type="application/json">${JSON.stringify(gate)}</script>` : ""}</body></html>`;
const passing = { passing: true, provenance: { runId: "24fa81d5-db2d-4349-8cc0-145e1e99dd73" } };
test("completed historical pages and an arbitrary passing run do not become accepted evidence", () => {
  assert.equal(classifyReport("worldsim-old", html()).disposition, "unreviewed-for-readiness");
  assert.equal(classifyReport("worldsim-other", html(passing)).disposition, "unreviewed-for-readiness");
  assert.equal(classifyReport(acceptedSlug, html({ national: passing, regional: { passing: false } })).disposition, "rejected-telemetry");
  const row = classifyReport(acceptedSlug, html({ national: passing, regional: passing }));
  assert.equal(row.disposition, "accepted-scoped-telemetry");
  assert.equal(row.acceptedForOverallReadiness, false);
});
test("inventory preserves old findings, visibly labels all historical pages, and is repeatable", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "readiness-inventory-"));
  try {
    const manifest = [{ slug: acceptedSlug }, { slug: "worldsim-old" }, { slug: "worldsim-missing" }];
    fs.writeFileSync(path.join(directory, `${acceptedSlug}.html`), html({ national: passing, regional: passing }));
    fs.writeFileSync(path.join(directory, "worldsim-old.html"), html());
    const result = publishReadinessInventory(directory, manifest);
    assert.equal(result.reports.length, 3);
    assert.equal(result.overallReadinessAcceptedReports, 0);
    assert.equal(result.reports[2].disposition, "missing-artifact");
    const old = fs.readFileSync(path.join(directory, "worldsim-old.html"), "utf8");
    assert.match(old, /Not accepted as #2159/);
    assert.match(old, /<h1>Complete<\/h1>/);
    assert.equal(annotateReport(old, result.reports[1]), old);
    publishReadinessInventory(directory, manifest);
    assert.equal(manifest.filter((r) => r.slug === "worldsim-readiness-inventory").length, 1);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
