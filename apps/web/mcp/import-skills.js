// Importer: Hermes SKILL.md files -> `skills` collection in ops_knowledge.
// Defaults to the project-specific `a-house-divided` category; pass other
// category names as args to include them (e.g. node mcp/import-skills.js
// a-house-divided software-development github). Idempotent (upsert by name).
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const store = require("../knowledge-store");
const { hermesSkillsDir } = require("../src/core/paths");

const SKILLS_ROOT = hermesSkillsDir();
const CATEGORIES = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const DEFAULT_CATEGORIES = ["a-house-divided"];

let _pipe = null;
async function embed(text) {
  if (!_pipe) {
    const { pipeline } = await import("@xenova/transformers");
    _pipe = await pipeline("feature-extraction", "Xenova/bge-small-en-v1.5");
  }
  const out = await _pipe(String(text).slice(0, 7500), { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

// Parse the leading --- frontmatter --- block (name/description/tags) + body.
function parseSkill(raw, dirName) {
  let name = "", description = "", tags = [], body = raw;
  const fm = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(raw);
  if (fm) {
    body = fm[2];
    for (const line of fm[1].split("\n")) {
      const m = /^(\w+):\s*(.*)$/.exec(line.trim());
      if (!m) continue;
      const key = m[1].toLowerCase();
      let val = m[2].trim();
      if (key === "name") name = val;
      else if (key === "description") description = val;
      else if (key === "tags") {
        val = val.replace(/^\[|\]$/g, "");
        tags = val.split(",").map((t) => t.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      }
    }
  }
  if (!name) name = dirName;
  if (!description) {
    // fall back to first non-heading paragraph
    for (const l of body.split("\n")) {
      const t = l.trim();
      if (!t || t.startsWith("#") || t.startsWith("```")) continue;
      description = t.replace(/[*_`>#]/g, "").slice(0, 240); break;
    }
  }
  return { name, description, tags, body };
}

function findSkillFiles(categoryDir) {
  const out = [];
  (function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (e.name === "SKILL.md") out.push(path.join(dir, e.name));
    }
  })(categoryDir);
  return out;
}

(async () => {
  const cats = CATEGORIES.length ? CATEGORIES : DEFAULT_CATEGORIES;
  const db = await store.getDb();
  await store.ensureIndexes(db);
  let n = 0;
  const imported = [];
  for (const cat of cats) {
    const files = findSkillFiles(path.join(SKILLS_ROOT, cat));
    for (const file of files) {
      const raw = fs.readFileSync(file, "utf8");
      if (!raw.trim()) continue;
      const dirName = path.basename(path.dirname(file));
      const { name, description, tags, body } = parseSkill(raw, dirName);
      const slug = store.slugify(name);
      const embedding = await embed(`${name}\n${description}\n${body}`);
      await store.save(
        db,
        "skills",
        {
          name: slug,
          title: name,
          description,
          body,
          tags: tags.length ? tags : [cat],
          metadata: { category: cat, path: path.relative(SKILLS_ROOT, file), source: "hermes-skills" },
          embedding,
        },
        { actor: "skills-import" }
      );
      imported.push(slug);
      n++;
    }
  }
  console.log(`Imported ${n} skills from [${cats.join(", ")}]:`);
  console.log("  " + imported.join(", "));
  process.exit(0);
})().catch((e) => { console.error("IMPORT ERROR:", e); process.exit(1); });
