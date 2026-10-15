// Force-regenerate triage assessments for ALL unresolved suggestions & tickets
// (grounded). No Discord notifications. Run once after the grounding upgrade so
// the old guessed-path assessments are replaced. Resumable + safe (the worker's
// atomic claim prevents double-processing if the live worker also runs).
//   TRIAGE_SUPPRESS_NOTIFY=1 node mcp/bulk-retriage.js
process.env.TRIAGE_SUPPRESS_NOTIFY = "1";
require("dotenv").config({ quiet: true, path: require("path").join(__dirname, "..", ".env") });
const { MongoClient } = require("mongodb");
const { runTriageTick } = require("../triage-worker");

const SUG_DONE = ["closed", "rejected", "done", "completed", "implemented"];
const TIX_DONE = ["closed", "resolved", "rejected"];

(async () => {
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const d = c.db("a-house-divided");
  const getDb = async () => d;

  // 1. Flag every unresolved item for re-assessment (reset triage bookkeeping).
  const sres = await d.collection("suggestions").updateMany(
    { status: { $nin: SUG_DONE } },
    { $set: { triageStatus: "pending" }, $unset: { assessmentId: "", assessedAt: "", lastTriageAttempt: "", lastTriageError: "" } }
  );
  const tres = await d.collection("tickets").updateMany(
    { status: { $nin: TIX_DONE } },
    { $set: { status: "open", triageStatus: "pending", reviewAfter: new Date() }, $unset: { assessmentId: "", assessedAt: "", lastTriageAttempt: "", lastTriageError: "" } }
  );
  console.log(`flagged ${sres.modifiedCount} suggestions + ${tres.modifiedCount} tickets for re-triage (Discord suppressed)`);

  // 2. Grind ticks until nothing is left pending.
  let processed = 0, idle = 0;
  for (let i = 0; i < 500; i++) {
    const r = await runTriageTick(getDb);
    const did = (r && r.processed) || (r && Array.isArray(r.results) ? r.results.length : 0);
    if (did) { processed += did; idle = 0; (r.results || []).forEach((x) => console.log("  ", x.assessed ? `assessed #${x.displayNumber}` : x.error ? `error #${x.displayNumber}: ${x.error}` : JSON.stringify(x).slice(0, 80))); }
    else idle++;
    const pend = await d.collection("suggestions").countDocuments({ triageStatus: "pending" }) + await d.collection("tickets").countDocuments({ triageStatus: "pending" });
    if (pend === 0) break;
    if (idle >= 3) { console.log(`stalled with ${pend} still pending (likely in backoff) — stopping`); break; }
  }
  const remaining = await d.collection("suggestions").countDocuments({ triageStatus: "pending" }) + await d.collection("tickets").countDocuments({ triageStatus: "pending" });
  console.log(`done — ${processed} assessments regenerated, ${remaining} still pending`);
  process.exit(0);
})().catch((e) => { console.error("bulk-retriage failed:", e.message); process.exit(1); });
