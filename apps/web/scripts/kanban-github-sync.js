#!/usr/bin/env node
"use strict";

// Pull GitHub issues into the ops kanban. Run by ops-kanban-github-sync.timer
// every 15 minutes; agents can also trigger it with the kanban_github_sync MCP
// tool. Uses the `gh` CLI (GH_BIN, default "gh") with the caller's auth.
//
//   OPS_KANBAN_DB=/path/kanban.db node scripts/kanban-github-sync.js [--repo owner/name]

const { openKanban } = require("../kanban-store");

const i = process.argv.indexOf("--repo");
const repo = i > -1 ? process.argv[i + 1] : null;
const kanban = openKanban();

kanban.syncGithub({ repo })
  .then((results) => {
    console.log(JSON.stringify({ db: kanban.path, synced: results }));
    if (results.some((result) => !result.ok)) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(`[kanban-sync] ${error.stack || error}`);
    process.exitCode = 1;
  })
  .finally(() => kanban.close());
