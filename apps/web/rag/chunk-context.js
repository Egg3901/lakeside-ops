"use strict";

// Contextual chunk headers, the highest-measured-win retrieval upgrade
// (Anthropic contextual retrieval: 35% retrieval-failure reduction from
// contextual embeddings, 49% with contextual BM25).
//
// A mid-file code slice embeds as anonymous text: nothing in the vector or
// the FTS row says which file, system, or mechanic it belongs to. Every chunk
// gets a deterministic situating header (source kind, path, part) plus an LLM
// one-liner naming the game system and what the slice does, prepended before
// embedding and FTS indexing so both retrieval halves see it.
//
// The one-liner is cached by (path, raw-chunk hash) in a sidecar SQLite, so
// the 15-minute rebuild only calls the model for chunks whose content
// actually changed. Generation fails open to the deterministic header alone,
// and a failed generation is NOT cached, so a later pass can fill it in.

const crypto = require("node:crypto");
const fs = require("node:fs");
const Database = require("better-sqlite3");

// Default is the local ollama daemon, which serializes requests (measured
// ~12 lines/min at any nominal concurrency). For bulk runs point
// RAG_CONTEXT_URL at an OpenAI-style endpoint (e.g. Ollama cloud
// https://ollama.com/v1/chat/completions) with RAG_CONTEXT_KEY set: both
// response shapes are handled below and real concurrency applies.
const OLLAMA_CHAT = process.env.RAG_CONTEXT_URL || "http://127.0.0.1:11434/api/chat";
const API_KEY = process.env.RAG_CONTEXT_KEY || "";
const OPENAI_STYLE = /\/v1\//.test(OLLAMA_CHAT);
const MODEL = process.env.RAG_CONTEXT_MODEL || (OPENAI_STYLE ? "deepseek-v4-flash" : "deepseek-v4-flash:cloud");
const CONCURRENCY = Math.max(1, parseInt(process.env.RAG_CONTEXT_CONCURRENCY || "8", 10));
const TIMEOUT_MS = Math.max(5000, parseInt(process.env.RAG_CONTEXT_TIMEOUT_MS || "30000", 10));

const SYSTEM = `You annotate source chunks for a search index over a strategy game's codebase (A House Divided: elections, parties, legislation, corporations, markets, military, turns).
Reply with ONE sentence, at most 30 words, situating the chunk: which game system or mechanic it belongs to and what it defines, computes, or explains.
Use concrete mechanic names a player or developer would search for. No preamble, no quotes, no markdown.`;

const BATCH_SYSTEM = `You annotate source chunks for a search index over a strategy game's codebase (A House Divided: elections, parties, legislation, corporations, markets, military, turns).
For EACH numbered chunk, write ONE sentence, at most 30 words, situating it: which game system or mechanic it belongs to and what it defines, computes, or explains. Use concrete mechanic names a player or developer would search for.
Reply with ONLY a JSON array of strings, one per chunk, in order. No markdown fences.`;

const BATCH_SIZE = Math.max(1, parseInt(process.env.RAG_CONTEXT_BATCH || "8", 10));
// Per-pass generation budget. The steady-state rebuild runs every 15 minutes;
// with a large backfill outstanding (the initial bulk run left ~16k chunks on
// deterministic headers when the free lane 503'd), an uncapped pass would try
// them all and blow the cadence. Chunks over budget keep their deterministic
// header and are attempted again next pass, so the backfill converges.
const MAX_GENERATE = Math.max(0, parseInt(process.env.RAG_CONTEXT_MAX_GENERATE || "0", 10)); // 0 = unlimited

// One model call annotates a whole batch: per-call latency on the cloud lane
// (~15-20s regardless of output size) made per-chunk calls the bottleneck.
async function generateBatch(items) {
  const listing = items.map((item, index) =>
    `### CHUNK ${index + 1}\nKIND: ${item.source}\nFILE: ${item.path}\nTEXT:\n${String(item.text || "").slice(0, 1800)}`
  ).join("\n\n");
  const body = {
    model: MODEL, stream: false, temperature: 0.1, max_tokens: 60 * items.length + 100,
    messages: [
      { role: "system", content: BATCH_SYSTEM },
      { role: "user", content: listing },
    ],
  };
  const response = await fetch(OLLAMA_CHAT, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS * 2),
  });
  if (!response.ok) throw new Error(`context model ${response.status}`);
  const data = await response.json();
  const content = String((OPENAI_STYLE ? data?.choices?.[0]?.message?.content : data?.message?.content) || "");
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("no JSON array in batch reply");
  const lines = JSON.parse(match[0]);
  if (!Array.isArray(lines) || lines.length !== items.length) throw new Error(`batch count mismatch: ${Array.isArray(lines) ? lines.length : "none"} for ${items.length}`);
  return lines.map(sanitizeLine);
}

const sha = value => crypto.createHash("sha1").update(value).digest("hex");

function openCache(cachePath, readOnly = false) {
  if (readOnly) {
    // Read-only lookups against another build's cache: no schema writes, no
    // journal changes, and a missing cache simply means no hits.
    if (!fs.existsSync(cachePath)) return null;
    return new Database(cachePath, { readonly: true, fileMustExist: true });
  }
  const db = new Database(cachePath);
  db.pragma("journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS chunk_context(
    key TEXT PRIMARY KEY, line TEXT NOT NULL, model TEXT, created INTEGER NOT NULL)`);
  return db;
}

function sanitizeLine(raw) {
  const line = String(raw || "").replace(/\s+/g, " ").trim().replace(/^["'`]+|["'`]+$/g, "").trim();
  if (!line || line.length < 12 || line.length > 320) return "";
  if (/^(this chunk|i |sorry|as an ai)/i.test(line)) return line.replace(/^this chunk\s*/i, "").trim();
  return line;
}

async function generateLine({ path, kind, text, head }) {
  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: `SOURCE KIND: ${kind}\nFILE: ${path}\nFILE HEAD:\n${String(head || "").slice(0, 800)}\n\nCHUNK:\n${String(text || "").slice(0, 3000)}` },
  ];
  const body = OPENAI_STYLE
    ? { model: MODEL, stream: false, temperature: 0.1, max_tokens: 80, messages }
    : { model: MODEL, stream: false, options: { temperature: 0.1, num_predict: 80 }, messages };
  const response = await fetch(OLLAMA_CHAT, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`context model ${response.status}`);
  const data = await response.json();
  return sanitizeLine(OPENAI_STYLE ? data?.choices?.[0]?.message?.content : data?.message?.content);
}

/**
 * Returns a contextFor function compatible with source-index build():
 * contextFor({ source, path, ord, total, text, docText }) -> header string.
 * The deterministic part is always present; the LLM line is best-effort.
 */
function createChunkContext({ cachePath, llm = null, llmBatch = null, log = () => {}, generate = true, readOnly = false } = {}) {
  if (!cachePath) throw new Error("cachePath required");
  const cache = openCache(cachePath, readOnly);
  const get = cache ? cache.prepare("SELECT line FROM chunk_context WHERE key=?") : { get: () => undefined };
  const put = cache && !readOnly
    ? cache.prepare(`INSERT INTO chunk_context(key,line,model,created) VALUES(?,?,?,?)
        ON CONFLICT(key) DO UPDATE SET line=excluded.line, model=excluded.model, created=excluded.created`)
    : { run: () => {} };
  let generated = 0, cached = 0, failed = 0, skipped = 0;
  // A custom per-item llm (tests) becomes a batch by mapping; production uses
  // the real batch call, since per-call latency, not output size, binds.
  const runBatch = llmBatch
    || (llm ? items => Promise.all(items.map(item => llm({ path: item.path, kind: item.source, text: item.text, head: item.docText }))) : generateBatch);

  const keyOf = item => sha(`${item.path}|${sha(item.text)}`);

  async function annotate(items) {
    const misses = [];
    for (const item of items) {
      const hit = get.get(keyOf(item));
      if (hit) { cached++; item.contextHeader = headerFor(item, hit.line); }
      else misses.push(item);
    }
    // generate=false: every miss keeps the deterministic header, no model
    // call, nothing cached. The chunk stays searchable by kind and path.
    const budgeted = !generate ? [] : MAX_GENERATE > 0 ? misses.slice(0, MAX_GENERATE) : misses;
    if (!generate) skipped += misses.length;
    for (const item of misses.slice(budgeted.length)) {
      item.contextHeader = headerFor(item, "");
    }
    const groups = [];
    for (let offset = 0; offset < budgeted.length; offset += BATCH_SIZE) {
      groups.push(budgeted.slice(offset, offset + BATCH_SIZE));
    }
    let nextGroup = 0;
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const index = nextGroup++;
        if (index >= groups.length) return;
        const group = groups[index];
        let lines = null;
        try { lines = await runBatch(group); } catch (error) {
          log(`[context] batch of ${group.length} (${group[0].path}#${group[0].ord}…): ${String(error.message || error).slice(0, 140)}`);
        }
        group.forEach((item, itemIndex) => {
          const line = lines ? sanitizeLine(lines[itemIndex]) : "";
          // Empty results are not cached: a later pass may do better, and the
          // deterministic header keeps the chunk searchable meanwhile.
          if (line) { put.run(keyOf(item), line, MODEL, Date.now()); generated++; }
          else failed++;
          item.contextHeader = headerFor(item, line);
        });
      }
    });
    await Promise.all(workers);
    return { generated, cached, failed, skipped };
  }

  function headerFor(item, line) {
    const base = `[${item.source}] ${item.path} (part ${item.ord + 1}/${item.total})`;
    return line ? `${base}: ${line}` : base;
  }

  function close() { try { cache?.close(); } catch {} }

  return { annotate, headerFor, close, stats: () => ({ generated, cached, failed, skipped }) };
}

module.exports = { createChunkContext, sanitizeLine };
