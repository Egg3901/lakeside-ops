// One-off seeder: import the local Claude memory store into the `memory`
// collection of ops_knowledge, with embeddings. Idempotent (upsert by name).
//   node mcp/seed-memory.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const store = require("../knowledge-store");

const MEM_DIR = "/root/.claude/projects/-root/memory";

let _pipe = null;
async function embed(text) {
  if (!_pipe) {
    const { pipeline } = await import("@xenova/transformers");
    _pipe = await pipeline("feature-extraction", "Xenova/bge-small-en-v1.5");
  }
  const out = await _pipe(String(text).slice(0, 7500), { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

// Minimal frontmatter parser for the `--- ... ---\n<body>` memory format.
function parse(raw) {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(raw);
  if (!m) return { meta: {}, body: raw.trim() };
  const meta = {};
  let curKey = null;
  for (const line of m[1].split("\n")) {
    const top = /^(\w[\w-]*):\s*(.*)$/.exec(line);
    if (top && !/^\s/.test(line)) {
      curKey = top[1];
      meta[curKey] = top[2].replace(/^["']|["']$/g, "").trim();
    } else if (/^\s+(\w[\w-]*):\s*(.*)$/.test(line)) {
      const sub = /^\s+(\w[\w-]*):\s*(.*)$/.exec(line);
      meta[sub[1]] = sub[2].replace(/^["']|["']$/g, "").trim();
    }
  }
  return { meta, body: m[2].trim() };
}

(async () => {
  const db = await store.getDb();
  await store.ensureIndexes(db);

  const files = fs.readdirSync(MEM_DIR).filter((f) => f.endsWith(".md") && f !== "MEMORY.md");
  let n = 0;
  for (const f of files) {
    const raw = fs.readFileSync(path.join(MEM_DIR, f), "utf8");
    const { meta, body } = parse(raw);
    const name = meta.name || path.basename(f, ".md");
    const title = name.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const description = meta.description || "";
    const embedding = await embed(`${title}\n${description}\n${body}`);
    await store.save(
      db,
      "memory",
      {
        name,
        title,
        description,
        body,
        tags: meta.type ? [meta.type] : [],
        metadata: { type: meta.type || "project", source: "claude-memory", file: f },
        embedding,
      },
      { actor: "seed-import" }
    );
    n++;
    process.stdout.write(`  ✓ ${name}\n`);
  }
  console.log(`\nSeeded ${n} memory entries.`);
  process.exit(0);
})().catch((e) => {
  console.error("SEED ERROR:", e);
  process.exit(1);
});
