// Throwaway integration test for the living-brain store upgrades. Runs against
// the real Mongo, uses zzz-brain-test-* names, and hard-cleans up at the end.
require("dotenv").config();
const store = require("./knowledge-store");

const A = "zzz-brain-test-a";
const B = "zzz-brain-test-b";
const KIND = "memory";

// Deterministic 384-dim unit vectors. vA·vB = 0 → cosine 0 (< 0.6 conflict thr).
function vec(hotIndex) {
  const v = new Array(store.EMBED_DIM).fill(0);
  v[hotIndex] = 1;
  return v;
}

async function hardDelete(db, name) {
  await db.collection(store.COLLECTION).deleteOne({ kind: KIND, name });
}

(async () => {
  const db = await store.getDb();
  await store.ensureIndexes(db);
  const results = [];
  const check = (label, cond, detail = "") =>
    results.push(`${cond ? "✓" : "✗ FAIL"}  ${label}${detail ? "  — " + detail : ""}`);

  try {
    // clean slate
    await hardDelete(db, A);
    await hardDelete(db, B);

    // 1. create A (links to B) as alice
    const a1 = await store.save(db, KIND, {
      name: A, title: "Test A", description: "first", body: "A body linking [[zzz-brain-test-b]].",
      embedding: vec(0),
    }, { actor: "alice" });
    check("create returns action=created", a1._action === "created");
    check("links parsed from body", (a1.links || []).includes(B), JSON.stringify(a1.links));
    check("version starts at 1", a1.version === 1, "v=" + a1.version);
    check("hits initialized to 0", a1.hits === 0);

    // 2. create B
    await store.save(db, KIND, { name: B, title: "Test B", body: "B body.", embedding: vec(5) }, { actor: "alice" });

    // 3. neighbors: A→B outbound, B←A backlink
    const nA = await store.neighbors(db, KIND, A);
    check("A outbound includes B", nA.outbound.some((o) => o.name === B));
    const nB = await store.neighbors(db, KIND, B);
    check("B backlinks include A", nB.backlinks.some((o) => o.name === A));

    // 4. conflicting overwrite by a DIFFERENT author with dissimilar embedding
    const a2 = await store.save(db, KIND, {
      name: A, title: "Test A", body: "Completely different content now.", embedding: vec(300),
    }, { actor: "bob" });
    check("update returns action=updated", a2._action === "updated");
    check("conflict flagged (diff author + dissimilar)", a2._conflict === true, "sim=" + a2._similarityToPrev);
    check("prev author recorded", a2._prevAuthor === "alice", a2._prevAuthor);
    check("prior version snapshotted to history", Array.isArray(a2.history) && a2.history.length >= 1, "hist=" + (a2.history || []).length);
    check("version incremented to 2", a2.version === 2, "v=" + a2.version);

    // 5. optimistic lock: stale expectedVersion is refused
    let locked = false;
    try {
      await store.save(db, KIND, { name: A, body: "x", embedding: vec(1) }, { actor: "carol", expectedVersion: 1 });
    } catch (e) { locked = e.code === "VERSION_CONFLICT"; }
    check("stale expectedVersion refused (VERSION_CONFLICT)", locked);

    // 6. correct expectedVersion succeeds
    const a3 = await store.save(db, KIND, { name: A, body: "merged [[zzz-brain-test-b]]", embedding: vec(2) }, { actor: "carol", expectedVersion: 2 });
    check("correct expectedVersion accepted", a3.version === 3, "v=" + a3.version);

    // 7. feedback
    await store.feedback(db, KIND, A, "up", { actor: "alice" });
    const fb = await store.feedback(db, KIND, A, "up", { actor: "bob" });
    check("feedback increments up", fb.feedback.up === 2, JSON.stringify(fb.feedback));

    // 8. query + recordHits reinforcement
    const q = await store.query(db, { kind: KIND, text: "merged", limit: 5 });
    const hitA = q.find((r) => r.name === A);
    check("query returns A with id + reinforceScore field", !!hitA && !!hitA.id && "reinforceScore" in hitA);
    await store.recordHits(db, q.map((r) => r.id));
    const aAfter = await store.get(db, KIND, A);
    check("recordHits bumped hit counter", (aAfter.hits || 0) >= 1, "hits=" + aAfter.hits);

    // 9. shared-tag graph axis: two entries sharing a tag (but not [[linked]])
    //    surface as sharedTag neighbors. (No expectedVersion — order-independent.)
    await store.save(db, KIND, { name: A, title: "Test A", body: "A body, no link now.", tags: ["zzz-shared-tag"], embedding: vec(0) }, { actor: "alice" });
    await store.save(db, KIND, { name: B, title: "Test B", body: "B body.", tags: ["zzz-shared-tag"], embedding: vec(5) }, { actor: "alice" });
    const nB9 = await store.neighbors(db, KIND, B);
    check("shared-tag neighbor surfaced", nB9.sharedTag.some((o) => o.name === A), JSON.stringify(nB9.sharedTag.map((s) => s.name)));

    // 10. curation: reading a >7d-stale entry flags it; fresh one doesn't.
    const col = db.collection(store.COLLECTION);
    const aDoc = await store.get(db, KIND, A);
    await col.updateOne({ _id: aDoc._id }, { $set: { updatedAt: new Date(Date.now() - 10 * 86400000) }, $unset: { reviewPending: "", lastReviewedAt: "" } });
    await store.flagStaleOnRead(db, [aDoc._id]);
    const aFlagged = await store.get(db, KIND, A);
    check("stale read flags entry for review", aFlagged.reviewPending === true);
    const bDoc = await store.get(db, KIND, B); // freshly updated in step 9
    await store.flagStaleOnRead(db, [bDoc._id]);
    const bFresh = await store.get(db, KIND, B);
    check("fresh entry NOT flagged", bFresh.reviewPending !== true);
    const queue = await store.listReviewQueue(db);
    check("review queue includes flagged entry", queue.some((q) => q.name === A));
    const rec = store.assessEntry(aFlagged);
    check("assessEntry returns a recommendation", ["keep", "verify", "ditch"].includes(rec.recommendation), rec.recommendation);
    await store.markReviewed(db, KIND, A, { recommendation: rec.recommendation });
    const aReviewed = await store.get(db, KIND, A);
    check("markReviewed clears the flag", aReviewed.reviewPending === false && !!aReviewed.lastReviewedAt);

    // 11. version history + line diff (works for all kinds)
    const hist = await store.history(db, KIND, A);
    check("history returns multiple versions", hist && hist.versions.length >= 2, "n=" + (hist ? hist.versions.length : 0));
    check("newest version marked current", hist.versions[hist.versions.length - 1].current === true);
    const patch = store.diffLines("alpha\nshared\nold", "alpha\nshared\nnew");
    check("diffLines marks -/+ and keeps context", patch.includes("- old") && patch.includes("+ new") && patch.includes("  shared"), JSON.stringify(patch));
  } catch (e) {
    results.push("✗ THREW: " + e.stack);
  } finally {
    await hardDelete(db, A);
    await hardDelete(db, B);
    console.log(results.join("\n"));
    const failed = results.filter((r) => r.startsWith("✗")).length;
    console.log(`\n${failed === 0 ? "ALL PASS" : failed + " FAILED"} (${results.length} checks); test entries cleaned up.`);
    process.exit(failed === 0 ? 0 : 1);
  }
})();
