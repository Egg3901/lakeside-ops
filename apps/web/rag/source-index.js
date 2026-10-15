"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Database = require("better-sqlite3");

const SOURCE_KINDS = ["code", "docs", "wiki"];
const AUTHORITY = {
  mechanic: { code: 1.3, docs: 1, wiki: 0.72 },
  intent: { code: 1, docs: 1.3, wiki: 0.75 },
  player_help: { code: 1, docs: 1.05, wiki: 1.15 },
  general: { code: 1.12, docs: 1, wiki: 0.88 },
};
// Document-side prompt prefix. nomic-embed-text needs "search_document: ";
// Qwen3-Embedding wants documents bare. Set RAG_DOC_PREFIX="" for the latter.
const docPrefix = process.env.RAG_DOC_PREFIX ?? "search_document: ";
const CHUNK_SIZE = 6000;
const CHUNK_OVERLAP = 400;
const ENGINEERING_ROOTS = new Set(["api", "architecture", "design", "engineering"]);
const ENGINEERING_ROOT_FILES = new Set(["CODEBASE_INDEX.md", "reset-and-seed-contract.md"]);
const EXCLUDED_DOC_PARTS = new Set(["archive", "generated", "node_modules", "plans", "site-build", "superpowers", "worktrees"]);
const STOP = new Set("a an and are as at be by can did do does for from how i in is it its of on or that the this to was were what when where which who why with you your".split(" "));

function classifyGamePath(file) {
  const normalized = String(file || "").replace(/\\/g, "/");
  if (/\.test\.[jt]sx?$/.test(normalized)) return "code";
  if (/^src\/lib\/seeds\/wiki\/content\//.test(normalized)) return "wiki";
  if (/^src\/lib\/seeds\/wiki\/pages(?:\/|\.ts$)/.test(normalized)) return "wiki";
  if (/^src\/app\/guides\//.test(normalized)) return "wiki";
  return "code";
}

function includeEngineeringDoc(file) {
  const normalized = String(file || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!/\.mdx?$/i.test(normalized)) return false;
  if (/(^|\/)[^/]*audit[^/]*\.mdx?$/i.test(normalized)) return false;
  if (normalized === "design/wiki.md") return false;
  const parts = normalized.split("/");
  if (parts.some(part => EXCLUDED_DOC_PARTS.has(part))) return false;
  if (parts.length === 1) return ENGINEERING_ROOT_FILES.has(parts[0]);
  return ENGINEERING_ROOTS.has(parts[0]);
}

function chunksOf(text) {
  const value = String(text || "");
  if (!value.trim()) return [];
  const chunks = [];
  const step = CHUNK_SIZE - CHUNK_OVERLAP;
  for (let offset = 0; offset < value.length; offset += step) {
    chunks.push(value.slice(offset, offset + CHUNK_SIZE));
    if (offset + CHUNK_SIZE >= value.length) break;
  }
  return chunks;
}

function hash(value) {
  return crypto.createHash("sha1").update(value).digest("hex");
}

function validateSources(sources) {
  const kinds = (sources || []).map(source => source?.kind).sort();
  if (JSON.stringify(kinds) !== JSON.stringify(SOURCE_KINDS)) {
    throw new Error("a publish requires exactly code, docs, and wiki sources");
  }
  for (const source of sources) {
    if (!source.repository || !source.revision) throw new Error(`${source.kind} requires repository and revision`);
    if (!Array.isArray(source.documents) || source.documents.length === 0) {
      throw new Error(`${source.kind} must contain at least one document`);
    }
    if (source.documents.some(document => !document.path || !String(document.text || "").trim())) {
      throw new Error(`${source.kind} contains an empty document`);
    }
  }
}

function schema(db) {
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE chunks(
      id INTEGER PRIMARY KEY,
      source_kind TEXT NOT NULL CHECK(source_kind IN ('code','docs','wiki')),
      repository TEXT NOT NULL,
      revision TEXT NOT NULL,
      path TEXT NOT NULL,
      ord INTEGER NOT NULL,
      hash TEXT NOT NULL,
      text TEXT NOT NULL,
      vec BLOB NOT NULL,
      dims INTEGER NOT NULL,
      indexed_at TEXT NOT NULL,
      UNIQUE(source_kind, path, ord)
    );
    CREATE INDEX idx_chunks_source_path ON chunks(source_kind, path);
    CREATE INDEX idx_chunks_hash ON chunks(hash);
    CREATE TABLE source_revisions(
      kind TEXT PRIMARY KEY CHECK(kind IN ('code','docs','wiki')),
      repository TEXT NOT NULL,
      revision TEXT NOT NULL,
      indexed_at TEXT NOT NULL,
      files INTEGER NOT NULL,
      chunks INTEGER NOT NULL
    );
    CREATE TABLE meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
  `);
}

function normalizedVector(vector) {
  const values = Array.from(vector || [], Number);
  if (!values.length || values.some(value => !Number.isFinite(value))) throw new Error("embedding adapter returned an invalid vector");
  const norm = Math.hypot(...values) || 1;
  return Float32Array.from(values.map(value => value / norm));
}

function terms(value) {
  return [...new Set((String(value || "").toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || [])
    .filter(term => !STOP.has(term)))];
}

function lexicalScore(question, text) {
  const wanted = terms(question);
  if (!wanted.length) return 0;
  const haystack = String(text || "").toLowerCase();
  return wanted.filter(term => haystack.includes(term)).length / wanted.length;
}

function cosine(query, vector) {
  if (query.length !== vector.length) return 0;
  let score = 0;
  for (let index = 0; index < query.length; index++) score += query[index] * vector[index];
  return score;
}

function candidateRows(db, question, perSourceLimit = 400) {
  const wanted = terms(question);
  const columns = "c.id,c.source_kind,c.repository,c.revision,c.path,c.ord,c.text,c.vec,c.dims";
  if (wanted.length) {
    const expression = wanted.map(term => `"${term.replace(/"/g, '""')}"`).join(" OR ");
    const statement = db.prepare(`SELECT ${columns}
      FROM chunks_fts f JOIN chunks c ON c.id=f.rowid
      WHERE chunks_fts MATCH ? AND c.source_kind=?
      ORDER BY bm25(chunks_fts) LIMIT ?`);
    const rows = SOURCE_KINDS.flatMap(source => statement.all(expression, source, perSourceLimit));
    if (rows.length) return rows;
  }
  return db.prepare(`SELECT ${columns} FROM chunks c`).all();
}

// Chunker selection. v1 (blind 6000-char slices with overlap) stays the
// default so the pinned builder's output is unchanged; v2 is the
// boundary-aware chunker in ./chunker-v2 and is opted into per build.
function resolveChunker(chunker) {
  if (!chunker || chunker === "v1") return { name: "v1", split: (text) => chunksOf(text) };
  if (chunker === "v2") {
    const v2 = require("./chunker-v2");
    return { name: "v2", split: (text, meta) => v2.chunksOf(text, meta).map(chunk => chunk.text) };
  }
  if (typeof chunker === "function") return { name: "custom", split: (text, meta) => chunker(text, meta).map(chunk => chunk.text) };
  throw new Error(`unknown chunker: ${chunker}`);
}

function createSourceIndex({ dbPath, embedDocuments, embedQuery, now = () => new Date(), embeddingBatchSize = 8, chunker = "v1" }) {
  if (!dbPath || typeof embedDocuments !== "function" || typeof embedQuery !== "function") {
    throw new Error("dbPath, embedDocuments, and embedQuery are required");
  }
  const splitter = resolveChunker(chunker);

  async function build(sources, { reuseDbPath, chunkContext = null } = {}) {
    validateSources(sources);
    const indexedAt = now().toISOString();
    const building = `${dbPath}.building`;
    const previous = `${dbPath}.previous`;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.rmSync(building, { force: true });
    let db;
    let reuseDb;
    try {
      if (reuseDbPath && fs.existsSync(reuseDbPath)) {
        reuseDb = new Database(reuseDbPath, { readonly: true, fileMustExist: true });
      }
      db = new Database(building);
      schema(db);
      const insertChunk = db.prepare(`INSERT INTO chunks
        (source_kind,repository,revision,path,ord,hash,text,vec,dims,indexed_at)
        VALUES (@source,@repository,@revision,@path,@ord,@hash,@text,@vec,@dims,@indexedAt)`);
      const insertSource = db.prepare(`INSERT INTO source_revisions
        (kind,repository,revision,indexed_at,files,chunks) VALUES (?,?,?,?,?,?)`);
      const reusable = reuseDb?.prepare("SELECT vec,dims FROM chunks WHERE hash=? LIMIT 1");
      const reuse = {};

      for (const source of sources) {
        const pending = [];
        for (const document of source.documents) {
          const parts = splitter.split(document.text, { path: document.path, kind: source.kind });
          parts.forEach((text, ord) => pending.push({
            document, text, ord,
            source: source.kind, path: document.path, total: parts.length,
            docText: document.text.slice(0, 1200),
          }));
        }
        // Contextual headers: situate every chunk (source kind, path, and a
        // cached model one-liner naming the mechanic) before embedding, so
        // both the vector and the FTS row carry what an anonymous mid-file
        // slice otherwise loses. The composed text is what gets hashed, so
        // embedding reuse still works run to run.
        if (chunkContext) {
          await chunkContext.annotate(pending);
          for (const item of pending) {
            if (item.contextHeader) item.text = `${item.contextHeader}\n${item.text}`;
          }
        }
        for (let offset = 0; offset < pending.length; offset += embeddingBatchSize) {
          const batch = pending.slice(offset, offset + embeddingBatchSize);
          const reused = batch.map(item => reusable?.get(hash(item.text)) || null);
          const missing = batch.filter((item, index) => !reused[index]);
          reuse[source.kind] = (reuse[source.kind] || 0) + (batch.length - missing.length);
          const embedded = missing.length
            ? await embedDocuments(missing.map(item => `${docPrefix}${item.text}`))
            : [];
          if (!Array.isArray(embedded) || embedded.length !== missing.length) {
            throw new Error(`embedding count mismatch for ${source.kind}`);
          }
          let embeddedIndex = 0;
          db.transaction(() => batch.forEach((item, index) => {
            const prior = reused[index];
            const vector = prior ? null : normalizedVector(embedded[embeddedIndex++]);
            insertChunk.run({
              source: source.kind,
              repository: source.repository,
              revision: source.revision,
              path: item.document.path,
              ord: item.ord,
              hash: hash(item.text),
              text: item.text,
              vec: prior ? Buffer.from(prior.vec) : Buffer.from(vector.buffer),
              dims: prior ? prior.dims : vector.length,
              indexedAt,
            });
          }))();
        }
        insertSource.run(source.kind, source.repository, source.revision, indexedAt, source.documents.length, pending.length);
      }
      db.exec(`CREATE VIRTUAL TABLE chunks_fts USING fts5(
        text, source_kind UNINDEXED, path UNINDEXED,
        content='chunks', content_rowid='id', tokenize='unicode61');
        INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild');`);
      db.prepare("INSERT INTO meta(k,v) VALUES('generation',?)").run(crypto.randomUUID());
      db.prepare("INSERT INTO meta(k,v) VALUES('published_at',?)").run(indexedAt);
      db.prepare("INSERT INTO meta(k,v) VALUES('chunker',?)").run(splitter.name);
      const sourceCount = db.prepare("SELECT COUNT(*) count FROM source_revisions").get().count;
      const chunkCount = db.prepare("SELECT COUNT(*) count FROM chunks").get().count;
      if (sourceCount !== 3 || chunkCount < 3) throw new Error("staging index failed coverage validation");
      db.pragma("wal_checkpoint(TRUNCATE)");
      db.close();
      db = null;
      reuseDb?.close();
      reuseDb = null;

      if (fs.existsSync(dbPath)) {
        fs.rmSync(previous, { force: true });
        const current = new Database(dbPath, { readonly: true, fileMustExist: true });
        await current.backup(previous);
        current.close();
      }
      fs.renameSync(building, dbPath);
      return { ...stats(), reused: reuse };
    } catch (error) {
      try { db?.close(); } catch {}
      try { reuseDb?.close(); } catch {}
      // Keep what was embedded. A run that dies at chunk 42,800 of 43,500 (a
      // rate-limited hosted embedder, 2026-09-05) must not throw away an
      // hour of vectors: the partial is kept as <db>.partial so the next run
      // can pass it as RAG_REUSE_DB and embed only what is missing.
      const partial = `${dbPath}.partial`;
      try { fs.rmSync(partial, { force: true }); fs.renameSync(building, partial); } catch { fs.rmSync(building, { force: true }); }
      for (const suffix of ["-wal", "-shm"]) fs.rmSync(`${building}${suffix}`, { force: true });
      throw error;
    }
  }

  function stats() {
    if (!fs.existsSync(dbPath)) return { ready: false, chunks: 0, sources: {} };
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const rows = db.prepare("SELECT * FROM source_revisions ORDER BY kind").all();
      const sources = Object.fromEntries(rows.map(row => [row.kind, {
        repository: row.repository,
        revision: row.revision,
        indexedAt: row.indexed_at,
        files: row.files,
        chunks: row.chunks,
      }]));
      const chunks = db.prepare("SELECT COUNT(*) count FROM chunks").get().count;
      const generation = db.prepare("SELECT v FROM meta WHERE k='generation'").get()?.v || null;
      return { ready: rows.length === 3 && chunks > 0, chunks, generation, sources };
    } finally {
      db.close();
    }
  }

  async function search(question, { topK = 8, claimType = "general" } = {}) {
    if (!fs.existsSync(dbPath)) return null;
    const query = normalizedVector(await embedQuery(`search_query: ${question}`));
    const weights = AUTHORITY[claimType] || AUTHORITY.general;
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const rows = candidateRows(db, question);
      const scored = rows.map(row => {
        const vector = new Float32Array(row.vec.buffer, row.vec.byteOffset, row.dims);
        const semantic = cosine(query, vector);
        const lexical = lexicalScore(question, row.text);
        return {
          source: row.source_kind,
          repository: row.repository,
          revision: row.revision,
          path: row.path,
          ord: row.ord,
          text: row.text,
          score: (semantic * 0.72 + lexical * 0.28) * (weights[row.source_kind] || 1),
        };
      }).sort((left, right) => right.score - left.score);

      const perFile = new Map();
      const hits = [];
      for (const row of scored) {
        const key = `${row.source}:${row.path}`;
        const count = perFile.get(key) || 0;
        if (count >= 2) continue;
        perFile.set(key, count + 1);
        hits.push(row);
        if (hits.length >= Math.max(1, Math.min(30, topK))) break;
      }
      if (!hits.length) return null;
      const context = hits.map(hit =>
        `--- SOURCE ${hit.source} @ ${hit.revision} | ${hit.path} (part ${hit.ord + 1}, relevance ${hit.score.toFixed(3)}) ---\n${hit.text}`
      ).join("\n\n");
      return { context, hits, files: [...new Set(hits.map(hit => hit.path))], count: hits.length };
    } finally {
      db.close();
    }
  }

  return { build, search, stats };
}

module.exports = { createSourceIndex, classifyGamePath, includeEngineeringDoc };
