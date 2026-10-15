// Automatic knowledge review pass. Consumes the review queue (entries an agent
// read while stale, >7d since update) and assesses each:
//   • docs / skills → "verify" (confirm still correct & needed) unless well-used
//   • memory        → "keep" (used/maintained) | "ditch" (cold & unused) | "verify"
//
// Default run assesses, records the recommendation, and clears the flag (so it
// won't re-fire until the entry goes stale again). With --prune it also
// soft-deletes clear-cut dead MEMORY entries (never docs/skills). With --dry it
// only reports. Intended to run daily from cron.
//
// Usage:  node knowledge-review-pass.js [--dry] [--prune]
require("dotenv").config();
const store = require("./knowledge-store");

const DRY = process.argv.includes("--dry");
const PRUNE = process.argv.includes("--prune");

(async () => {
  const db = await store.getDb();
  const queue = await store.listReviewQueue(db, { limit: 1000 });
  const buckets = { keep: [], verify: [], ditch: [] };

  for (const e of queue) {
    const a = store.assessEntry(e);
    buckets[a.recommendation].push({ kind: e.kind, name: e.name, title: e.title, ...a.signals, reason: a.reason });
    if (DRY) continue;
    await store.markReviewed(db, e.kind, e.name, { recommendation: a.recommendation, note: a.reason });
    // Only prune clear-cut cold MEMORY; docs/skills are never auto-deleted.
    if (PRUNE && a.recommendation === "ditch" && e.kind === "memory") {
      await store.remove(db, "memory", e.name, { actor: "review-pass" });
    }
  }

  const line = (b) => `${b.kind}/${b.name}  (hits ${b.hits}, edits ${b.edits}, ${b.sinceRetrieved}d since read) — ${b.reason}`;
  const report = [
    `Knowledge review pass ${DRY ? "(DRY RUN)" : ""}— ${queue.length} flagged entries assessed`,
    ``,
    `KEEP (${buckets.keep.length}) — used/maintained, flag cleared`,
    ...buckets.keep.map((b) => "  · " + line(b)),
    ``,
    `VERIFY (${buckets.verify.length}) — confirm still correct & needed`,
    ...buckets.verify.map((b) => "  · " + line(b)),
    ``,
    `DITCH (${buckets.ditch.length}) — cold & unused${PRUNE ? " (memory soft-deleted)" : " (recommend deletion)"}`,
    ...buckets.ditch.map((b) => "  · " + line(b)),
  ].join("\n");

  console.log(report);
  console.log(`\n${DRY ? "DRY — nothing written." : "Flags cleared; recommendations recorded on each entry." + (PRUNE ? " Cold memories pruned." : "")}`);
  process.exit(0);
})();
