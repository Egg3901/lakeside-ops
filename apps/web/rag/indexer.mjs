// Semantic index over the AHDGame tree.
// Chunks at 6000 chars (fits nomic's 8192-token window whole, no truncation),
// embeds in batches of 8, and skips any chunk whose content hash is unchanged.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";

const REPO = process.env.RAG_REPO || "/root/projects/LSGD-ops-dash/ahd-sandbox";
const DB_PATH = process.env.RAG_DB || "/root/projects/LSGD-ops-dash/rag/index.db";
const MODEL = "nomic-ai/nomic-embed-text-v1.5";
const DOC_PREFIX = "search_document: ";      // nomic requires task prefixes
const CHUNK = 6000, OVERLAP = 400, BATCH = 8;
// Overridable per game. A satellite's .json is almost always generated data —
// Grand Century ships 8MB of province geometry under src/data/generated — and
// embedding geometry burns the pass budget before ever reaching the sim code.
const EXT = new Set((process.env.RAG_EXT || ".ts .tsx .js .jsx .json .md .rs").split(/\s+/).filter(Boolean));
const SKIP = /(^|\/)(node_modules|\.next|dist|build|coverage|\.git|worktrees|target|target-local|release-artifacts|dist-sidecar|promo-shots|\.claude)(\/|$)/;
// Extra per-game exclusions, as a regex against the repo-relative path.
const EXTRA_SKIP = process.env.RAG_SKIP ? new RegExp(process.env.RAG_SKIP) : null;
// Which top-level directories to walk. Defaults to "src" so the A House Divided
// index this script was written for is byte-for-byte unchanged; the satellite
// games pass their own (e.g. "crates sim docs") because their code and prose do
// not both live under src.
const DIRS = (process.env.RAG_DIRS || "src").split(/\s+/).filter(Boolean);
// Recorded in meta so a DB can say which game it holds without inferring it.
const GAME = process.env.RAG_GAME || "ahd";

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS chunks(
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL, ord INTEGER NOT NULL,
  hash TEXT NOT NULL, text TEXT NOT NULL,
  vec BLOB NOT NULL, dims INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(path, ord));
CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);`);

const sel = db.prepare("SELECT hash FROM chunks WHERE path=? AND ord=?");
const up = db.prepare(`INSERT INTO chunks(path,ord,hash,text,vec,dims,updated_at)
  VALUES(@path,@ord,@hash,@text,@vec,@dims,@ts)
  ON CONFLICT(path,ord) DO UPDATE SET hash=@hash,text=@text,vec=@vec,dims=@dims,updated_at=@ts`);
const delPath = db.prepare("DELETE FROM chunks WHERE path=?");
const delTail = db.prepare("DELETE FROM chunks WHERE path=? AND ord>=?");
const setMeta = db.prepare("INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v");

function listFiles() {
  const present = DIRS.filter(d => fs.existsSync(path.join(REPO, d)));
  if (!present.length) throw new Error(`none of the requested dirs exist in ${REPO}: ${DIRS.join(", ")}`);
  const out = execFileSync("rg", ["--files", ...present], { cwd: REPO, maxBuffer: 64e6 }).toString().split("\n");
  return out.filter(f => f && EXT.has(path.extname(f)) && !SKIP.test(f) && !(EXTRA_SKIP && EXTRA_SKIP.test(f)));
}
function chunkText(t) {
  const step = CHUNK - OVERLAP, out = [];
  for (let i = 0; i < t.length; i += step) { out.push(t.slice(i, i + CHUNK)); if (i + CHUNK >= t.length) break; }
  return out.length ? out : [t];
}
const sha = s => crypto.createHash("sha1").update(s).digest("hex");

// Embeddings run in ollama, NOT in-process. transformers.js/ONNX leaks an arena
// per distinct input shape here — measured 20GB RSS for 144 chunks, which took
// the box to its knees. ollama is a separate native process at a steady ~690ms
// per chunk, and any memory it churns is recycled outside this script.
const OLLAMA = process.env.OLLAMA_EMBED_URL || "http://127.0.0.1:11434/api/embed";
const OLLAMA_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
async function embedBatch(texts) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(OLLAMA, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: OLLAMA_MODEL, input: texts }),
        signal: AbortSignal.timeout(300000),
      });
      if (!r.ok) throw new Error("ollama " + r.status);
      const d = await r.json();
      if (!d.embeddings || d.embeddings.length !== texts.length) throw new Error("bad embedding count");
      return d.embeddings;
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise(res => setTimeout(res, 2000 * (attempt + 1)));
    }
  }
}

const files = listFiles();
const onDisk = new Set(files);
for (const r of db.prepare("SELECT DISTINCT path FROM chunks").all())
  if (!onDisk.has(r.path)) { delPath.run(r.path); }

const MAX_EMBED = parseInt(process.env.RAG_MAX_EMBED || "1500", 10);
let done = 0, embedded = 0, skipped = 0, capped = false;
const t0 = Date.now();
let pend = [];
const flush = async () => {
  if (!pend.length) return;
  const batch = pend; pend = [];
  const vecs = await embedBatch(batch.map(b => DOC_PREFIX + b.text));
  db.transaction(() => {
    batch.forEach((b, i) => {
      const v = Float32Array.from(vecs[i]);
      up.run({ ...b, vec: Buffer.from(v.buffer), dims: v.length, ts: Date.now() });
    });
  })();
  embedded += batch.length;
};

for (const f of files) {
  let txt = ""; try { txt = fs.readFileSync(path.join(REPO, f), "utf8"); } catch { continue; }
  if (!txt.trim() || txt.length > 400000) continue;
  const parts = chunkText(txt);
  delTail.run(f, parts.length);
  for (let i = 0; i < parts.length; i++) {
    const h = sha(parts[i]);
    const cur = sel.get(f, i);
    if (cur && cur.hash === h) { skipped++; continue; }
    pend.push({ path: f, ord: i, hash: h, text: parts[i] });
    if (pend.length >= BATCH) await flush();
    if (embedded >= MAX_EMBED) { capped = true; break; }
  }
  if (capped) break;
  if (++done % 250 === 0) {
    const el = (Date.now() - t0) / 1000;
    console.log(`[index] ${done}/${files.length} files | embedded ${embedded} | skipped ${skipped} | ${el.toFixed(0)}s`);
  }
}
await flush();
// Keyword half of hybrid retrieval. External-content FTS5 must be populated via
// the 'rebuild' command: a plain COUNT(*) on it reads the CONTENT table, so an
// empty index reports thousands of rows and any "is it built?" check lies.
try {
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    text, path UNINDEXED, content='chunks', content_rowid='id', tokenize='unicode61')`);
  if (embedded > 0) {
    db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')");
    console.log("[index] keyword index rebuilt");
  }
} catch (e) { console.error("[index] FTS rebuild failed:", e.message); }

let head = ""; try { head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO }).toString().trim(); } catch {}
setMeta.run("last_indexed_at", String(Date.now()));
setMeta.run("last_commit", head);
setMeta.run("model", MODEL);
setMeta.run("game", GAME);
setMeta.run("dirs", DIRS.join(" "));
const total = db.prepare("SELECT COUNT(*) c FROM chunks").get().c;
if (capped) { console.log(`[index] PASS embedded=${embedded} skipped=${skipped} — more remaining`); process.exit(75); }
console.log(`[index] DONE files=${files.length} embedded=${embedded} skipped=${skipped} chunks=${total} commit=${head.slice(0,8)} elapsed=${((Date.now()-t0)/1000/60).toFixed(1)}min`);
