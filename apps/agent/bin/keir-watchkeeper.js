#!/usr/bin/env node
"use strict";
const { createWatchkeeper } = require("../lib/operator/watchkeeper");
const env = process.env;
// systemd also enforces the wall-clock bound if a filesystem syscall hangs.
const deadline = setTimeout(() => { console.error("watchkeeper hard deadline exceeded"); process.exit(1); }, 44000);
try {
  createWatchkeeper({
    stateFile: env.KEIR_WATCHKEEPER_STATE_FILE || "/var/lib/keir-watchkeeper/state.json",
    operatorUrl: env.KEIR_WATCHKEEPER_OPERATOR_URL || "http://127.0.0.1:9765",
    gamestateUrl: env.KEIR_WATCHKEEPER_GAMESTATE_URL || "http://127.0.0.1:9730/mcp",
    turndiagUrl: env.KEIR_WATCHKEEPER_TURNDIAG_URL || "http://127.0.0.1:9736/mcp",
    token: env.KEIR_WATCHKEEPER_TOKEN,
    readToken: env.KEIR_WATCHKEEPER_READ_TOKEN,
  }).run().then(result => { clearTimeout(deadline); process.exitCode = result.healthy ? 0 : 1; }).catch(error => { clearTimeout(deadline); console.error(`watchkeeper failed: ${error.message}`); process.exitCode = 1; });
} catch (error) { clearTimeout(deadline); console.error(`watchkeeper configuration failed: ${error.message}`); process.exitCode = 1; }
