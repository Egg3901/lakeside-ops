"use strict";
const fs = require("node:fs");
// Read-only MCP token for Keir's reads, from /etc/keir-agent.env.
function readAgentToken(file) {
  try {
    const line = fs.readFileSync(file, "utf8").split("\n").find((s) => /^KEIR_AGENT_MCP_TOKEN=/.test(s));
    return line ? line.slice(line.indexOf("=") + 1).trim().replace(/^(['"])(.*)\1$/, "$2") : "";
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    return "";
  }
}
module.exports = { readAgentToken };
