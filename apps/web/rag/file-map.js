"use strict";

// File map: one plain-language line per indexed file and per directory,
// stored INSIDE the index database so it ships with the index (R2, Ask).
//
// Ask's file-picker stage (pro and deep tiers) shows a model the candidate
// files with these lines and asks it to choose. Measured on the dev gold
// split it raised "right file delivered to the model" from 68% to 85%; the
// lines are what let the picker find files hybrid search never ranked.
//
// Tables (read by ask-site retrieve.js, keep the shape stable):
//   file_map(path TEXT PRIMARY KEY, kind TEXT, hash TEXT, line TEXT, model TEXT, updated_at INTEGER)
//   dir_map(dir TEXT PRIMARY KEY, line TEXT, updated_at INTEGER)
// `hash` is a digest of the file's chunk hashes, so a line is regenerated
// only when the file's indexed text changed. The index is rebuilt from
// scratch every pass, so the previous index's tables are carried over first,
// then the prototype jsonl caches seed anything still missing, and only then
// does the model see the remainder, under a per-pass call budget so a
// 15-minute reindex pass stays short and a full backfill converges over
// passes. Failures are never cached: a missing line is simply absent.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Database = require("better-sqlite3");

const FILES_PER_CALL = Math.max(1, parseInt(process.env.RAG_FILE_MAP_PER_CALL || "45", 10));
const DIRS_PER_CALL = 30;
const DEFAULT_MAX_CALLS = Math.max(0, parseInt(process.env.RAG_FILE_MAP_MAX_CALLS || "40", 10));
const CONCURRENCY = Math.max(1, parseInt(process.env.RAG_FILE_MAP_CONCURRENCY || "4", 10));
const CALL_TIMEOUT_MS = Math.max(10000, parseInt(process.env.RAG_FILE_MAP_TIMEOUT_MS || "120000", 10));
const MIN_DIR_FILES = 3;
const EXCERPT_LINES = 30;
const EXCERPT_CHARS = 2200;
const LINE_MAX = 240;
const DIR_LINE_MAX = 300;

const isTestPath = p => /__tests__|\.test\.|\/tests?\//.test(p);
const sha = value => crypto.createHash("sha1").update(value).digest("hex");

function schema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_map(
      path TEXT PRIMARY KEY, kind TEXT, hash TEXT, line TEXT, model TEXT, updated_at INTEGER);
    CREATE TABLE IF NOT EXISTS dir_map(
      dir TEXT PRIMARY KEY, line TEXT, updated_at INTEGER);
  `);
}

function hasTable(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function readJsonl(file) {
  if (!file || !fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

const dirOf = p => p.split("/").slice(0, -1).join("/");

function filePrompt(batch) {
  return `You are documenting the source of "A House Divided", a multiplayer political and economic simulation game. For each file below, write ONE line (max 25 words) in plain player-facing words saying what the file implements or decides in the game (which mechanic, rule, number, screen or data). Do not describe code structure or imports. Name the game concepts and any key constants a player might ask about.
Return ONLY a JSON object mapping each path to its line, all ${batch.length} paths, no prose.

` + batch.map(file => `=== ${file.path}\n${file.excerpt}\n`).join("\n");
}

function dirPrompt(batch) {
  return `Source directories of "A House Divided" (political and economic simulation game), each with the one-line descriptions of its files. For each directory write ONE line (max 30 words) in player words summarising which game systems, rules or screens live there. Return ONLY a JSON object mapping each directory path to its line, all ${batch.length} directories.\n\n` +
    batch.map(({ dir, files }) => `=== ${dir}/ (${files.length} files)\n` + files.slice(0, 40).map(f => `- ${f.path.split("/").pop()}: ${f.line}`).join("\n") + "\n").join("\n");
}

function cleanLine(raw, max) {
  const line = String(raw || "").replace(/\s+/g, " ").trim();
  return line ? line.slice(0, max) : "";
}

async function pMap(items, fn, concurrency) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try { out[i] = await fn(items[i], i); } catch (error) { out[i] = { error: String(error && error.message || error) }; }
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Build or refresh the map inside `dbPath`.
 *
 * generate(prompt) -> Promise<{ ok, text, error }> is the model call (the muse
 * CLI in production, a stub in tests). previousDbPath is the index this
 * build replaced (its tables are carried over); seed is { linesPath, dirsPath }
 * for the prototype jsonl caches. maxCalls bounds model calls for this pass,
 * files and directories together. disabled=true skips every model call but
 * still carries over and seeds.
 */
async function buildFileMap({
  dbPath, generate, previousDbPath = null, seed = null, maxCalls = DEFAULT_MAX_CALLS,
  disabled = process.env.RAG_FILE_MAP_DISABLE === "1", model = "unknown", log = () => {}, now = () => Date.now(),
}) {
  if (!dbPath) throw new Error("dbPath required");
  if (!disabled && typeof generate !== "function") throw new Error("generate required");
  const db = new Database(dbPath);
  const stats = { files: 0, mapped: 0, carried: 0, seeded: 0, generated: 0, failed: 0, pruned: 0, dirs: 0, dirsGenerated: 0, dirsFailed: 0, calls: 0, unmapped: 0, disabled };
  try {
    db.pragma("journal_mode = WAL");
    schema(db);

    // 1. Every mapped file in the index, with a digest of its chunk hashes.
    const files = new Map();
    for (const row of db.prepare("SELECT source_kind kind, path, hash, ord FROM chunks ORDER BY path, ord").iterate()) {
      if (isTestPath(row.path)) continue;
      let f = files.get(row.path);
      if (!f) { f = { path: row.path, kind: row.kind, hashes: [] }; files.set(row.path, f); }
      f.hashes.push(row.hash);
    }
    for (const f of files.values()) { f.hash = sha(f.hashes.join("\n")); delete f.hashes; }
    stats.files = files.size;

    const upsertFile = db.prepare(`INSERT INTO file_map(path,kind,hash,line,model,updated_at) VALUES(@path,@kind,@hash,@line,@model,@updatedAt)
      ON CONFLICT(path) DO UPDATE SET kind=excluded.kind, hash=excluded.hash, line=excluded.line, model=excluded.model, updated_at=excluded.updated_at`);
    const upsertDir = db.prepare(`INSERT INTO dir_map(dir,line,updated_at) VALUES(?,?,?)
      ON CONFLICT(dir) DO UPDATE SET line=excluded.line, updated_at=excluded.updated_at`);
    const current = () => new Map(db.prepare("SELECT path,hash,line,updated_at FROM file_map").all().map(r => [r.path, r]));

    // 2. Carry over the previous index's tables (this index was built fresh).
    let have = current();
    if (previousDbPath && previousDbPath !== dbPath && fs.existsSync(previousDbPath)) {
      try {
        const prev = new Database(previousDbPath, { readonly: true, fileMustExist: true });
        try {
          if (hasTable(prev, "file_map")) {
            const rows = prev.prepare("SELECT path,kind,hash,line,model,updated_at FROM file_map").all();
            db.transaction(() => {
              for (const r of rows) {
                const f = files.get(r.path);
                if (!f || !r.line) continue;
                const mine = have.get(r.path);
                if (mine && mine.hash === f.hash) continue;
                if (r.hash !== f.hash) continue; // content changed since that line was written
                upsertFile.run({ path: r.path, kind: r.kind || f.kind, hash: r.hash, line: r.line, model: r.model || "carried", updatedAt: r.updated_at || now() });
                stats.carried++;
              }
            })();
          }
          if (hasTable(prev, "dir_map")) {
            const rows = prev.prepare("SELECT dir,line,updated_at FROM dir_map").all();
            db.transaction(() => { for (const r of rows) if (r.line) upsertDir.run(r.dir, r.line, r.updated_at || now()); })();
          }
        } finally { prev.close(); }
      } catch (error) {
        log(`[file-map] carry-over from ${previousDbPath} failed: ${String(error.message || error).slice(0, 160)}`);
      }
      have = current();
    }

    // 3. Seed from the prototype jsonl caches: a line for any file still
    // unmapped is taken as describing its current content. Seed lines are
    // not re-hashed, so a file that changed later will be regenerated when
    // its digest moves.
    if (seed && (seed.linesPath || seed.dirsPath)) {
      const lines = readJsonl(seed.linesPath);
      db.transaction(() => {
        for (const r of lines) {
          const f = r && files.get(r.path);
          if (!f || !r.line || have.has(r.path)) continue;
          upsertFile.run({ path: r.path, kind: f.kind, hash: f.hash, line: cleanLine(r.line, LINE_MAX), model: "seed", updatedAt: now() });
          stats.seeded++;
        }
      })();
      const dirs = readJsonl(seed.dirsPath);
      const haveDirs = new Set(db.prepare("SELECT dir FROM dir_map").all().map(r => r.dir));
      db.transaction(() => { for (const r of dirs) if (r && r.dir && r.line && !haveDirs.has(r.dir)) upsertDir.run(r.dir, cleanLine(r.line, DIR_LINE_MAX), now()); })();
      have = current();
    }

    // 4. Prune rows for files that left the index.
    const prune = db.prepare("DELETE FROM file_map WHERE path=?");
    db.transaction(() => { for (const p of have.keys()) if (!files.has(p)) { prune.run(p); stats.pruned++; } })();
    have = current();

    // 5. Generate for files with no line or a stale hash, within budget.
    const todo = [...files.values()].filter(f => { const h = have.get(f.path); return !h || h.hash !== f.hash; })
      .sort((a, b) => (a.kind === "code") - (b.kind === "code") || a.path.localeCompare(b.path));
    let callsLeft = disabled ? 0 : Math.max(0, maxCalls);
    if (todo.length && callsLeft > 0) {
      const firstChunk = db.prepare("SELECT text FROM chunks WHERE path=? AND ord=0 LIMIT 1");
      const excerpt = p => {
        const t = String(firstChunk.get(p)?.text || "");
        const body = t.startsWith("[") && t.includes("\n") ? t.slice(t.indexOf("\n") + 1) : t;
        return body.split("\n").slice(0, EXCERPT_LINES).join("\n").slice(0, EXCERPT_CHARS);
      };
      const batches = [];
      for (let i = 0; i < todo.length && batches.length < callsLeft; i += FILES_PER_CALL) {
        batches.push(todo.slice(i, i + FILES_PER_CALL).map(f => ({ ...f, excerpt: excerpt(f.path) })));
      }
      callsLeft -= batches.length;
      const results = await pMap(batches, async batch => {
        stats.calls++;
        const res = await generate(filePrompt(batch), { timeoutMs: CALL_TIMEOUT_MS });
        const json = res && res.ok ? parseLoose(res.text) : null;
        if (!json || typeof json !== "object" || Array.isArray(json)) {
          log(`[file-map] batch of ${batch.length} (${batch[0].path}) failed: ${String(res && res.error || "unparseable reply").slice(0, 160)}`);
          return { got: 0, failed: batch.length };
        }
        let got = 0;
        db.transaction(() => {
          for (const f of batch) {
            const line = cleanLine(json[f.path], LINE_MAX);
            if (!line) continue;
            upsertFile.run({ path: f.path, kind: f.kind, hash: f.hash, line, model, updatedAt: now() });
            got++;
          }
        })();
        return { got, failed: batch.length - got };
      }, CONCURRENCY);
      for (const r of results) { stats.generated += r.got || 0; stats.failed += r.failed || 0; }
      have = current();
    }
    stats.mapped = have.size;
    stats.unmapped = files.size - have.size;

    // 6. Directories with >= 3 mapped files: generate a line when missing or
    // when any file line in it is newer than the directory line.
    const byDir = new Map();
    for (const r of have.values()) {
      const d = dirOf(r.path);
      if (!byDir.has(d)) byDir.set(d, []);
      byDir.get(d).push(r);
    }
    const dirRows = new Map(db.prepare("SELECT dir,line,updated_at FROM dir_map").all().map(r => [r.dir, r]));
    const dirTodo = [];
    for (const [dir, list] of byDir) {
      if (list.length < MIN_DIR_FILES) continue;
      const row = dirRows.get(dir);
      const newest = Math.max(...list.map(r => Number(r.updated_at) || 0));
      if (!row || (row.updated_at || 0) < newest) dirTodo.push({ dir, files: list });
    }
    if (dirTodo.length && callsLeft > 0) {
      const batches = [];
      for (let i = 0; i < dirTodo.length && batches.length < callsLeft; i += DIRS_PER_CALL) batches.push(dirTodo.slice(i, i + DIRS_PER_CALL));
      callsLeft -= batches.length;
      const results = await pMap(batches, async batch => {
        stats.calls++;
        const res = await generate(dirPrompt(batch), { timeoutMs: CALL_TIMEOUT_MS });
        const json = res && res.ok ? parseLoose(res.text) : null;
        if (!json || typeof json !== "object" || Array.isArray(json)) {
          log(`[file-map] dir batch of ${batch.length} (${batch[0].dir}) failed: ${String(res && res.error || "unparseable reply").slice(0, 160)}`);
          return { got: 0, failed: batch.length };
        }
        let got = 0;
        const at = now();
        db.transaction(() => {
          for (const { dir } of batch) {
            const line = cleanLine(json[dir] || json[dir + "/"], DIR_LINE_MAX);
            if (!line) continue;
            upsertDir.run(dir, line, at);
            got++;
          }
        })();
        return { got, failed: batch.length - got };
      }, CONCURRENCY);
      for (const r of results) { stats.dirsGenerated += r.got || 0; stats.dirsFailed += r.failed || 0; }
    }
    const pruneDir = db.prepare("DELETE FROM dir_map WHERE dir=?");
    db.transaction(() => { for (const d of dirRows.keys()) if (!byDir.has(d)) pruneDir.run(d); })();
    stats.dirs = db.prepare("SELECT COUNT(*) c FROM dir_map").get().c;

    // The index file is uploaded as one file: fold the WAL back in.
    db.pragma("wal_checkpoint(TRUNCATE)");
    log(`[file-map] files=${stats.files} mapped=${stats.mapped} unmapped=${stats.unmapped} carried=${stats.carried} seeded=${stats.seeded} generated=${stats.generated} failed=${stats.failed} pruned=${stats.pruned} dirs=${stats.dirs} (+${stats.dirsGenerated}) calls=${stats.calls}${disabled ? " (generation disabled)" : ""}`);
    return stats;
  } finally {
    try { db.close(); } catch {}
  }
}

function parseLoose(text) {
  return require("./muse-cli").parseJsonLoose(text);
}

/** Model call for production: the muse CLI on the box. */
function museGenerate() {
  const { museCall, MODEL } = require("./muse-cli");
  const fn = (prompt, opts) => museCall(prompt, opts);
  fn.model = MODEL;
  return fn;
}

module.exports = { buildFileMap, museGenerate, filePrompt, dirPrompt, isTestPath, FILES_PER_CALL, DIRS_PER_CALL, DEFAULT_MAX_CALLS };
