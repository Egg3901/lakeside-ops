"use strict";

// Apply a code audit to the suggestions themselves (see planAuditUpdates in
// suggestion-swipe-audit.js): append the staff note, and for confirmed
// high-confidence verdicts move the status (implemented -> completed, built
// on development -> in_progress). Writes the database directly, so players
// are not notified. Status moves are recorded as swipe outcomes decided by
// "code-audit", so the Decided list can reopen them.
//
//   node suggestion-swipe-apply-audit.js            dry run, prints the plan
//   node suggestion-swipe-apply-audit.js --apply    writes
//
// Needs MONGODB_URI; reads OPS_SWIPE_AUDIT and OPS_SWIPE_DB like the dashboard.

require("dotenv").config({ quiet: true });
const { MongoClient } = require("mongodb");
const { loadAudit, planAuditUpdates } = require("./suggestion-swipe-audit");
const { openSwipeStore } = require("./suggestion-swipe-store");

const APPLY = process.argv.includes("--apply");

(async () => {
  const audit = loadAudit();
  if (!audit) throw new Error("no audit file at OPS_SWIPE_AUDIT");
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const coll = client.db("a-house-divided").collection("suggestions");
    const numbers = Object.keys(audit.items).map(Number);
    const docs = await coll.find({ issueNumber: { $in: numbers } }, { projection: { issueNumber: 1, status: 1, adminNotes: 1 } }).toArray();
    const plan = planAuditUpdates(audit, docs);
    const moves = plan.filter((p) => p.status);
    console.log(`${plan.length} suggestions to update: ${moves.filter((p) => p.status === "completed").length} to completed, ${moves.filter((p) => p.status === "in_progress").length} to in_progress, ${plan.length - moves.length} note only`);
    for (const p of moves) console.log(`  S#${p.issueNumber} -> ${p.status}`);
    if (!APPLY) { console.log("dry run; pass --apply to write"); return; }
    const store = openSwipeStore();
    const now = new Date();
    let written = 0;
    for (const p of plan) {
      const set = { updatedAt: now };
      if (p.adminNotes) set.adminNotes = p.adminNotes;
      const update = { $set: set };
      if (p.status) {
        Object.assign(set, { status: p.status, statusChangedAt: now });
        update.$push = { statusHistory: { status: p.status, at: now, by: "code-audit", source: "ops-code-audit", note: `code check: ${p.verdict}` } };
      }
      const r = await coll.updateOne({ issueNumber: p.issueNumber, status: "not_reviewed" }, update);
      if (r.modifiedCount !== 1) { console.warn(`  S#${p.issueNumber} changed since the plan, skipped`); continue; }
      written++;
      if (p.status) store.recordOutcome(p.issueNumber, { outcome: p.status, appliedStatus: p.status, decidedBy: "code-audit" });
    }
    store.close();
    console.log(`wrote ${written}`);
  } finally {
    await client.close();
  }
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
