// Curated importer: ahd-docs repo -> `docs` collection in ops_knowledge.
// Skips stale/low-signal trees (plans, archive, generated, design-handoffs).
// Idempotent (upsert by name). The store becomes the source of truth; the repo
// stays as an export mirror.  Run: node mcp/import-docs.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const store = require("../knowledge-store");

const DOCS_DIR = "/root/projects/ahd-docs";
const SKIP_DIRS = new Set(["plans", "archive", "generated", "design-handoffs", ".git", "node_modules"]);

let _pipe = null;
async function embed(text) {
  if (!_pipe) {
    const { pipeline } = await import("@xenova/transformers");
    _pipe = await pipeline("feature-extraction", "Xenova/bge-small-en-v1.5");
  }
  const out = await _pipe(String(text).slice(0, 7500), { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), base, out);
    } else if (e.isFile() && e.name.endsWith(".md")) {
      out.push(path.relative(base, path.join(dir, e.name)));
    }
  }
  return out;
}

// Plain-markdown docs: title = first H1, description = first real paragraph.
function meta(raw, rel) {
  const lines = raw.split("\n");
  let title = "";
  for (const l of lines) { const m = /^#\s+(.+)/.exec(l); if (m) { title = m[1].trim(); break; } }
  if (!title) title = path.basename(rel, ".md").replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  let desc = "";
  for (const l of lines) {
    const t = l.trim();
    if (!t || t.startsWith("#") || t.startsWith("---") || t.startsWith("|") || t.startsWith("```")) continue;
    desc = t.replace(/[*_`>#]/g, "").slice(0, 240);
    break;
  }
  return { title, desc };
}

(async () => {
  const db = await store.getDb();
  await store.ensureIndexes(db);
  const files = walk(DOCS_DIR);
  let n = 0;
  for (const rel of files) {
    const raw = fs.readFileSync(path.join(DOCS_DIR, rel), "utf8");
    if (!raw.trim()) continue;
    const section = rel.includes("/") ? rel.split("/")[0] : "general";
    const name = store.slugify(rel.replace(/\.md$/, "").replace(/\//g, "-"));
    const { title, desc } = meta(raw, rel);
    const embedding = await embed(`${title}\n${desc}\n${raw}`);
    await store.save(
      db,
      "docs",
      { name, title, description: desc, body: raw, tags: [section],
        metadata: { section, path: rel, source: "ahd-docs" }, embedding },
      { actor: "docs-import" }
    );
    n++;
    if (n % 25 === 0) process.stdout.write(`  …${n}/${files.length}\n`);
  }
  console.log(`\nImported ${n} docs across sections.`);
  const sections = await db.collection("ops_knowledge").distinct("metadata.section", { kind: "docs", deletedAt: null });
  console.log("Sections:", sections.sort().join(", "));
  process.exit(0);
})().catch((e) => { console.error("IMPORT ERROR:", e); process.exit(1); });
