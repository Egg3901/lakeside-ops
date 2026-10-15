// One-off migration: populate the `links` graph field on existing entries by
// parsing [[wiki-links]] out of each body. Deterministic and idempotent — does
// NOT re-embed, bump version, or touch tags (already present on the corpus).
// Run:  node backfill-links.js [--apply]
require("dotenv").config();
const store = require("./knowledge-store");

const APPLY = process.argv.includes("--apply");

(async () => {
  const db = await store.getDb();
  const col = db.collection(store.COLLECTION);
  const cursor = col.find({ deletedAt: null }, { projection: { body: 1, links: 1, kind: 1, name: 1 } });

  let scanned = 0, withLinks = 0, changed = 0;
  const sampleEdges = [];
  const bulk = [];
  for await (const e of cursor) {
    scanned++;
    const links = store.parseLinks(e.body || "");
    if (links.length) withLinks++;
    const prev = Array.isArray(e.links) ? e.links : null;
    const same = prev && prev.length === links.length && prev.every((l, i) => l === links[i]);
    if (!same) {
      changed++;
      if (links.length && sampleEdges.length < 8) sampleEdges.push(`${e.kind}/${e.name} → [${links.join(", ")}]`);
      bulk.push({ updateOne: { filter: { _id: e._id }, update: { $set: { links } } } });
    }
  }

  console.log(`scanned ${scanned} · ${withLinks} have wiki-links · ${changed} need the links field set`);
  if (sampleEdges.length) console.log("sample edges:\n  " + sampleEdges.join("\n  "));

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to write.");
    process.exit(0);
  }
  if (bulk.length) {
    const res = await col.bulkWrite(bulk, { ordered: false });
    console.log(`\nAPPLIED — modified ${res.modifiedCount} entries.`);
  } else {
    console.log("\nnothing to change.");
  }
  process.exit(0);
})();
