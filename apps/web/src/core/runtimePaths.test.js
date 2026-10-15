"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runtimePaths } = require("./runtimePaths");

test("configured runtime data survives a release-directory change", () => {
  const env = {
    OPS_SESSIONS_FILE: "/var/lib/ops-dashboard/sessions.json",
    PUBLISHED_REPORTS_DIR: "/var/lib/ops-dashboard/reports/published",
  };
  assert.deepEqual(runtimePaths("/deploy/release-a", env), runtimePaths("/deploy/release-b", env));
});

test("local runs keep runtime data beside their checkout", () => {
  const paths = runtimePaths("/projects/ops-dashboard", {});
  assert.equal(paths.sessionsFile, "/projects/ops-dashboard/.sessions.json");
  assert.equal(paths.publishedReportsDir, "/projects/ops-dashboard/reports/published");
});
