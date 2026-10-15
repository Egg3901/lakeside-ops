// Issue a scoped agent token and write ONLY the raw token to a file (no stdout
// noise). Usage: node mcp/issue-token.js <outfile> <name> [collections] [write]
require("dotenv").config({ quiet: true, path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const t = require("../agent-tokens"), s = require("../knowledge-store");
(async () => {
  const db = await s.getDb(process.env.MONGODB_URI);
  await t.ensureIndexes(db);
  const cols = (process.argv[4] || "docs,skills,memory").split(",");
  const { raw } = await t.issue(db, { name: process.argv[3] || "agent", collections: cols, write: process.argv[5] === "write", actor: "system" });
  fs.writeFileSync(process.argv[2], raw);
  process.exit(0);
})();
