"use strict";

const path = require("node:path");

function runtimePaths(rootDir, env = process.env) {
  return {
    sessionsFile: path.resolve(env.OPS_SESSIONS_FILE || path.join(rootDir, ".sessions.json")),
    publishedReportsDir: path.resolve(env.PUBLISHED_REPORTS_DIR || path.join(rootDir, "reports", "published")),
  };
}

module.exports = { runtimePaths };
