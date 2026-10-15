"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSourceIndex, classifyGamePath, includeEngineeringDoc } = require("./source-index");

function embedding(text) {
  const value = String(text).toLowerCase();
  const vector = [
    (value.match(/cloture|vote|senate/g) || []).length,
    (value.match(/corporation|market|share/g) || []).length,
    (value.match(/guide|click|screen/g) || []).length,
  ];
  const norm = Math.hypot(...vector) || 1;
  return vector.map(number => number / norm);
}

function fixture(dbPath) {
  return createSourceIndex({
    dbPath,
    embedDocuments: async texts => texts.map(embedding),
    embedQuery: async text => embedding(text),
    now: () => new Date("2026-08-23T20:00:00.000Z"),
  });
}

const sources = [
  {
    kind: "code", repository: "AHDGame", revision: "code123",
    documents: [{ path: "src/lib/elections/cloture.ts", text: "Cloture requires three fifths of votes cast." }],
  },
  {
    kind: "docs", repository: "ahd-docs", revision: "docs456",
    documents: [{ path: "design/bills-legislation.md", text: "Engineering design for Senate cloture votes." }],
  },
  {
    kind: "wiki", repository: "AHDGame", revision: "code123",
    documents: [{ path: "src/lib/seeds/wiki/content/senate.md", text: "Player guide: cloture used to require 60 votes." }],
  },
];

test("publishes code, docs, and wiki as independently revisioned sources", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-source-index-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const index = fixture(path.join(dir, "index.db"));

  await index.build(sources);
  const stats = index.stats();

  assert.deepEqual(Object.keys(stats.sources).sort(), ["code", "docs", "wiki"]);
  assert.deepEqual(stats.sources.code, {
    repository: "AHDGame", revision: "code123",
    indexedAt: "2026-08-23T20:00:00.000Z", files: 1, chunks: 1,
  });
  assert.equal(stats.sources.docs.revision, "docs456");
  assert.equal(stats.sources.wiki.revision, "code123");
});

test("mechanics retrieval keeps source identity and ranks code above a stale wiki claim", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-source-search-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const index = fixture(path.join(dir, "index.db"));
  await index.build(sources);

  const result = await index.search("How many votes does cloture require?", { claimType: "mechanic", topK: 3 });

  assert.equal(result.hits[0].source, "code");
  assert.deepEqual(new Set(result.hits.map(hit => hit.source)), new Set(["code", "docs", "wiki"]));
  assert.match(result.context, /SOURCE code @ code123/);
  assert.match(result.context, /SOURCE docs @ docs456/);
  assert.match(result.context, /SOURCE wiki @ code123/);
});

test("a failed build preserves the previously published generation", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-source-atomic-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const index = fixture(path.join(dir, "index.db"));
  await index.build(sources);

  await assert.rejects(
    index.build(sources.filter(source => source.kind !== "docs")),
    /exactly code, docs, and wiki/,
  );
  assert.equal(index.stats().sources.docs.revision, "docs456");
});

test("reuses unchanged legacy embeddings and batches only new chunks", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-source-reuse-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const legacyPath = path.join(dir, "legacy.db");
  const Database = require("better-sqlite3");
  const legacy = new Database(legacyPath);
  legacy.exec("CREATE TABLE chunks(hash TEXT, vec BLOB, dims INTEGER)");
  const oldVector = Float32Array.from(embedding(`search_document: ${sources[0].documents[0].text}`));
  const crypto = require("node:crypto");
  const oldHash = crypto.createHash("sha1").update(sources[0].documents[0].text).digest("hex");
  legacy.prepare("INSERT INTO chunks VALUES(?,?,?)").run(oldHash, Buffer.from(oldVector.buffer), oldVector.length);
  legacy.close();

  const batches = [];
  const index = createSourceIndex({
    dbPath: path.join(dir, "index.db"),
    embeddingBatchSize: 1,
    embedDocuments: async texts => {
      batches.push(texts);
      return texts.map(embedding);
    },
    embedQuery: async text => embedding(text),
  });
  await index.build(sources, { reuseDbPath: legacyPath });

  assert.equal(batches.length, 2);
  assert.equal(batches.flat().some(text => text.includes("three fifths")), false);
});

test("classifies shipped player prose separately from executable code", () => {
  assert.equal(classifyGamePath("src/lib/seeds/wiki/content/senate.ts"), "wiki");
  assert.equal(classifyGamePath("src/lib/seeds/wiki/pages/legislatures.ts"), "wiki");
  assert.equal(classifyGamePath("src/app/guides/elections/page.tsx"), "wiki");
  assert.equal(classifyGamePath("src/lib/seeds/wiki/content/playerGuides.test.ts"), "code");
  assert.equal(classifyGamePath("src/lib/elections/cloture.ts"), "code");
});

test("engineering coverage excludes stale and generated document trees", () => {
  assert.equal(includeEngineeringDoc("engineering/repo-operating-map.md"), true);
  assert.equal(includeEngineeringDoc("design/corporations.md"), true);
  assert.equal(includeEngineeringDoc("api/public-v1.md"), true);
  assert.equal(includeEngineeringDoc("architecture/system.md"), true);
  assert.equal(includeEngineeringDoc("design/wiki.md"), false);
  assert.equal(includeEngineeringDoc("design/legislation-system-completion-audit.md"), false);
  assert.equal(includeEngineeringDoc("engineering/documentation-accuracy-audit-2026-08-21.md"), false);
  assert.equal(includeEngineeringDoc("archive/wiki-content/elections.md"), false);
  assert.equal(includeEngineeringDoc("plans/future-redesign.md"), false);
  assert.equal(includeEngineeringDoc("generated/README.md"), false);
  assert.equal(includeEngineeringDoc("worktrees/branch/design/foo.md"), false);
});

test("build with chunkContext prepends situating headers into stored and searchable text", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "source-index-ctx-"));
  const dbPath = path.join(dir, "index.db");
  const index = fixture(dbPath);
  const chunkContext = {
    annotate: async items => {
      for (const item of items) {
        item.contextHeader = `[${item.source}] ${item.path} (part ${item.ord + 1}/${item.total}): Senate cloture vote mechanic.`;
      }
    },
  };
  await index.build(sources, { chunkContext });
  const Database = require("better-sqlite3");
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare("SELECT text FROM chunks WHERE source_kind='code' LIMIT 1").get();
  assert.match(row.text, /^\[code\] .+ \(part 1\/1\): Senate cloture vote mechanic\.\n/);
  const fts = db.prepare("SELECT COUNT(*) n FROM chunks_fts WHERE chunks_fts MATCH 'cloture'").get();
  assert.ok(fts.n >= 1);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("chunker option: default v1 keeps blind slices, v2 emits boundary-aware chunks and records itself", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-source-chunker-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const Database = require("better-sqlite3");
  const body = Array.from({ length: 6 }, (_, i) => `/** doc ${i} */\nexport function fn${i}() {\n${"  const x = 1; // pad\n".repeat(60)}}\n`).join("\n");
  const long = [{
    kind: "code", repository: "AHDGame", revision: "code123",
    documents: [{ path: "src/lib/long.ts", text: body }],
  }, sources[1], sources[2]];

  const v1Path = path.join(dir, "v1.db");
  await fixture(v1Path).build(long);
  const v1 = new Database(v1Path, { readonly: true });
  const v1Rows = v1.prepare("SELECT text FROM chunks WHERE path='src/lib/long.ts' ORDER BY ord").all();
  assert.equal(v1.prepare("SELECT v FROM meta WHERE k='chunker'").get().v, "v1");
  assert.ok(v1Rows.some(row => row.text.length > 3500), "v1 keeps 6000-char slices");
  v1.close();

  const v2Path = path.join(dir, "v2.db");
  const v2Index = createSourceIndex({
    dbPath: v2Path, chunker: "v2",
    embedDocuments: async texts => texts.map(embedding), embedQuery: async text => embedding(text),
  });
  await v2Index.build(long);
  const v2 = new Database(v2Path, { readonly: true });
  const v2Rows = v2.prepare("SELECT text FROM chunks WHERE path='src/lib/long.ts' ORDER BY ord").all();
  assert.equal(v2.prepare("SELECT v FROM meta WHERE k='chunker'").get().v, "v2");
  assert.equal(v2Rows.map(row => row.text).join(""), body, "v2 chunks tile the document with no overlap");
  assert.ok(v2Rows.every(row => row.text.length <= 3500));
  assert.ok(v2Rows.length > v1Rows.length);
  for (const row of v2Rows) assert.match(row.text, /^\/\*\* doc \d+ \*\//, "every v2 chunk starts on a declaration");
  v2.close();
  assert.throws(() => createSourceIndex({ dbPath: v2Path, chunker: "v9", embedDocuments: async () => [], embedQuery: async () => [] }), /unknown chunker/);
});

