// Generate today's Daily Operations Report and store it. Run by the recurring
// Kimi-code job (or manually). Equivalent to POST /api/daily-reports.
//   node mcp/gen-daily-report.js
require("dotenv").config({ quiet: true, path: require("path").join(__dirname, "..", ".env") });
const store = require("../knowledge-store");
const dailyReport = require("../daily-report");
(async () => {
  const db = await store.getDb(process.env.MONGODB_URI);
  const doc = await dailyReport.buildAndSave(db);
  console.log(`daily report saved: ${doc.date} [${doc.mood}] — ${doc.headline}`);
  console.log(`sections: ${(doc.sections || []).map((s) => s.title).join(", ")}`);
  process.exit(0);
})().catch((e) => { console.error("daily report failed:", e.message); process.exit(1); });
