#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { createSourceIndex } = require("./source-index");
const { createChunkContext } = require("./chunk-context");
const { loadSourceCorpora, summarizeCoverage } = require("./source-corpus");
const { buildFileMap, museGenerate, DEFAULT_MAX_CALLS } = require("./file-map");

const gameRepo = process.env.RAG_GAME_REPO;
const docsRepo = process.env.RAG_DOCS_REPO;
if (!gameRepo || !docsRepo) throw new Error("Set RAG_GAME_REPO and RAG_DOCS_REPO before building the source index");
const dbPath = process.env.RAG_SOURCE_DB || path.join(__dirname, "index-v2.db");
const reuseDbPath = process.env.RAG_REUSE_DB || path.join(__dirname, "index.db");
// Contextual headers on by default; RAG_CONTEXTUAL=0 restores plain chunks.
const contextual = process.env.RAG_CONTEXTUAL !== "0";
// RAG_CONTEXT_DISABLE=1 keeps the deterministic header (and any cached
// one-liner, read-only) but never calls a model: for offline A/B builds
// when no generation lane is available.
const contextGenerate = process.env.RAG_CONTEXT_DISABLE !== "1";
// RAG_CHUNKER=v2 selects the boundary-aware chunker; default v1 is unchanged.
const chunker = process.env.RAG_CHUNKER === "v2" ? "v2" : "v1";
// Embedding batch size. ollama serves embeds serially, so a live Ask query
// waits behind one whole batch; smaller batches bound that wait.
const embeddingBatchSize = Math.max(1, parseInt(process.env.RAG_EMBED_BATCH || "8", 10));
const contextCachePath = process.env.RAG_CONTEXT_CACHE || path.join(path.dirname(dbPath), "chunk-context-cache.db");
const ollamaUrl = process.env.OLLAMA_EMBED_URL || "http://127.0.0.1:11434/api/embed";
const ollamaModel = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
// RAG_EMBED_NUM_THREAD caps the runner's compute threads for this builder's
// requests (ollama forwards options.num_thread to llama-server). A bulk
// build sharing cores with the production embedder must not run 12 threads
// on 12 cores: llama.cpp barrier stalls under oversubscription took prod
// single-embed latency from 25ms to 7-11s. Unset means ollama's default.
const embedNumThread = Math.max(0, parseInt(process.env.RAG_EMBED_NUM_THREAD || "0", 10));
const embedOptions = embedNumThread > 0 ? { num_thread: embedNumThread } : null;
// Asymmetric embedders (NVIDIA Nemotron, Voyage) want documents declared as
// such. RAG_EMBED_INPUT_TYPE=passage adds input_type to every embed request;
// ollama ignores the field, the embed proxy forwards it.
const embedInputType = process.env.RAG_EMBED_INPUT_TYPE || "";
// RAG_FILE_MAP=1 generates or refreshes the per-file and per-directory map
// inside the published index (file_map / dir_map tables, see file-map.js)
// after the chunks are published. RAG_FILE_MAP_DISABLE=1 keeps the carried
// over and seeded rows but makes no model call. RAG_FILE_MAP_MAX_CALLS bounds
// calls per pass (default 40). RAG_FILE_MAP_SEED_DIR holds the prototype
// lines.jsonl / dirs.jsonl caches used to seed a first run.
const fileMap = process.env.RAG_FILE_MAP === "1";
const fileMapDisabled = process.env.RAG_FILE_MAP_DISABLE === "1";
const fileMapSeedDir = process.env.RAG_FILE_MAP_SEED_DIR || "";

async function embed(texts) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(ollamaUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: ollamaModel, input: texts, ...(embedOptions ? { options: embedOptions } : {}), ...(embedInputType ? { input_type: embedInputType } : {}) }),
        signal: AbortSignal.timeout(300_000),
      });
      if (!response.ok) throw new Error(`ollama returned ${response.status}`);
      const body = await response.json();
      if (!Array.isArray(body.embeddings) || body.embeddings.length !== texts.length) {
        throw new Error("ollama returned an invalid embedding batch");
      }
      return body.embeddings;
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 2_000));
    }
  }
}

async function main() {
  const sources = loadSourceCorpora({ gameRepo, docsRepo });
  const coverage = summarizeCoverage(sources);
  process.stdout.write(`${JSON.stringify({ phase: "discovered", coverage }, null, 2)}\n`);
  const index = createSourceIndex({ dbPath, chunker, embeddingBatchSize, embedDocuments: embed, embedQuery: async text => (await embed([text]))[0] });
  const chunkContext = contextual
    ? createChunkContext({ cachePath: contextCachePath, generate: contextGenerate, readOnly: !contextGenerate, log: line => console.error(line) })
    : null;
  try {
    const published = await index.build(sources, { reuseDbPath, chunkContext });
    process.stdout.write(`${JSON.stringify({ phase: "published", dbPath, chunker, embedNumThread: embedNumThread || null, published, context: chunkContext?.stats() || null }, null, 2)}\n`);
  } finally {
    chunkContext?.close();
  }
  if (fileMap) {
    // Fail open: the index is already published; a map problem must not fail
    // the pass, the picker simply sees fewer lines until the next one.
    try {
      const generate = fileMapDisabled ? null : museGenerate();
      const map = await buildFileMap({
        dbPath, generate, disabled: fileMapDisabled, model: generate ? generate.model : "none",
        previousDbPath: `${dbPath}.previous`,
        seed: fileMapSeedDir ? { linesPath: path.join(fileMapSeedDir, "lines.jsonl"), dirsPath: path.join(fileMapSeedDir, "dirs.jsonl") } : null,
        maxCalls: DEFAULT_MAX_CALLS, log: line => console.error(line),
      });
      process.stdout.write(`${JSON.stringify({ phase: "file-map", ...map }, null, 2)}\n`);
    } catch (error) {
      console.error(`[file-map] failed open: ${error.stack || error.message}`);
    }
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { embed };
