"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const { buildFileMap, isTestPath, FILES_PER_CALL } = require("./file-map");

function tempIndex(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-map-"));
  const dbPath = path.join(dir, "index.db");
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE chunks(id INTEGER PRIMARY KEY, source_kind TEXT, repository TEXT, revision TEXT, path TEXT, ord INTEGER, hash TEXT, text TEXT, vec BLOB, dims INTEGER, indexed_at TEXT)`);
  const ins = db.prepare("INSERT INTO chunks(source_kind,repository,revision,path,ord,hash,text,vec,dims,indexed_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
  for (const f of files) {
    const parts = Array.isArray(f.text) ? f.text : [f.text];
    parts.forEach((t, ord) => ins.run(f.kind || "code", "r", "v", f.path, ord, `h:${f.path}:${t}`, `[${f.kind || "code"}] ${f.path} (part ${ord + 1}/${parts.length})\n${t}`, Buffer.alloc(4), 1, "now"));
  }
  db.close();
  return { dir, dbPath };
}

function rows(dbPath, table) {
  const db = new Database(dbPath, { readonly: true });
  try { return db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(); } finally { db.close(); }
}

// A stub model that answers every path in the prompt with a line derived from it.
function stubGenerate(record = []) {
  return async prompt => {
    record.push(prompt);
    const paths = [...prompt.matchAll(/^=== (.+?)(?:\/ \(\d+ files\))?$/gm)].map(m => m[1]);
    return { ok: true, text: JSON.stringify(Object.fromEntries(paths.map(p => [p, `Describes ${p}.`]))) };
  };
}

test("generates one line per non-test file and per directory with three files, in batches", async () => {
  const { dir, dbPath } = tempIndex([
    { path: "src/lib/a.ts", text: "export const A = 1;" },
    { path: "src/lib/b.ts", text: ["export const B = 2;", "more"] },
    { path: "src/lib/c.ts", text: "export const C = 3;" },
    { path: "src/lib/__tests__/c.test.ts", text: "test" },
    { path: "docs/design/x.md", kind: "docs", text: "# X" },
  ]);
  const prompts = [];
  const stats = await buildFileMap({ dbPath, generate: stubGenerate(prompts), model: "stub", maxCalls: 10 });
  assert.equal(stats.files, 4);
  assert.equal(stats.generated, 4);
  assert.equal(stats.unmapped, 0);
  assert.equal(stats.calls, 2); // one file batch, one directory batch
  const map = rows(dbPath, "file_map");
  assert.deepEqual(map.map(r => r.path), ["docs/design/x.md", "src/lib/a.ts", "src/lib/b.ts", "src/lib/c.ts"]);
  assert.equal(map[1].line, "Describes src/lib/a.ts.");
  assert.equal(map[1].model, "stub");
  assert.ok(map[1].hash && map[1].updated_at > 0);
  const dirs = rows(dbPath, "dir_map");
  assert.deepEqual(dirs.map(r => r.dir), ["src/lib"]);
  assert.match(prompts[0], /=== src\/lib\/a\.ts\nexport const A = 1;/);
  assert.doesNotMatch(prompts[0], /\(part 1\/1\)/); // the chunk header is not part of the excerpt
  assert.ok(isTestPath("src/lib/__tests__/c.test.ts"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("unchanged files are not regenerated; a changed file is; a removed file is pruned", async () => {
  const { dir, dbPath } = tempIndex([
    { path: "src/lib/a.ts", text: "one" },
    { path: "src/lib/b.ts", text: "two" },
  ]);
  const first = [];
  await buildFileMap({ dbPath, generate: stubGenerate(first), model: "stub" });
  assert.equal(first.length, 1);
  // Same index again: no calls at all.
  const second = [];
  const again = await buildFileMap({ dbPath, generate: stubGenerate(second), model: "stub" });
  assert.equal(second.length, 0);
  assert.equal(again.generated, 0);
  // b changes, a is removed.
  const db = new Database(dbPath);
  db.prepare("DELETE FROM chunks WHERE path='src/lib/a.ts'").run();
  db.prepare("UPDATE chunks SET hash='h:changed', text='[code] src/lib/b.ts (part 1/1)\nchanged' WHERE path='src/lib/b.ts'").run();
  db.close();
  const third = [];
  const stats = await buildFileMap({ dbPath, generate: stubGenerate(third), model: "stub" });
  assert.equal(third.length, 1);
  assert.match(third[0], /=== src\/lib\/b\.ts\nchanged/);
  assert.doesNotMatch(third[0], /a\.ts/);
  assert.equal(stats.pruned, 1);
  assert.deepEqual(rows(dbPath, "file_map").map(r => r.path), ["src/lib/b.ts"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a failed or unparseable call caches nothing and the pass fails open", async () => {
  const { dir, dbPath } = tempIndex([{ path: "src/lib/a.ts", text: "one" }]);
  let calls = 0;
  const flaky = async () => { calls++; return calls === 1 ? { ok: false, error: "muse down" } : { ok: true, text: "not json at all" }; };
  const logs = [];
  const s1 = await buildFileMap({ dbPath, generate: flaky, model: "stub", log: l => logs.push(l) });
  assert.equal(s1.generated, 0);
  assert.equal(s1.failed, 1);
  assert.equal(rows(dbPath, "file_map").length, 0);
  const s2 = await buildFileMap({ dbPath, generate: flaky, model: "stub", log: l => logs.push(l) });
  assert.equal(s2.failed, 1);
  assert.equal(rows(dbPath, "file_map").length, 0);
  assert.equal(calls, 2);
  assert.ok(logs.some(l => /muse down/.test(l)));
  // Third pass reaches a working model.
  const s3 = await buildFileMap({ dbPath, generate: stubGenerate(), model: "stub" });
  assert.equal(s3.generated, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the per-pass call budget leaves the remainder for the next pass, and disabled makes no call", async () => {
  const files = Array.from({ length: FILES_PER_CALL * 2 + 1 }, (_, i) => ({ path: `src/lib/f${String(i).padStart(3, "0")}.ts`, text: `x${i}` }));
  const { dir, dbPath } = tempIndex(files);
  const prompts = [];
  const s1 = await buildFileMap({ dbPath, generate: stubGenerate(prompts), model: "stub", maxCalls: 1 });
  assert.equal(prompts.length, 1);
  assert.equal(s1.generated, FILES_PER_CALL);
  assert.equal(s1.unmapped, FILES_PER_CALL + 1);
  const off = await buildFileMap({ dbPath, generate: null, disabled: true, model: "none" });
  assert.equal(off.calls, 0);
  assert.equal(off.mapped, FILES_PER_CALL);
  const s2 = await buildFileMap({ dbPath, generate: stubGenerate(prompts), model: "stub", maxCalls: 10 });
  assert.equal(s2.unmapped, 0);
  assert.equal(rows(dbPath, "dir_map").length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a fresh index carries lines over from the previous index and seeds the rest from jsonl", async () => {
  const prev = tempIndex([{ path: "src/lib/a.ts", text: "one" }, { path: "src/lib/b.ts", text: "two" }]);
  await buildFileMap({ dbPath: prev.dbPath, generate: stubGenerate(), model: "stub" });
  // The new build: a unchanged, b changed, c new (only in the seed cache).
  const next = tempIndex([{ path: "src/lib/a.ts", text: "one" }, { path: "src/lib/b.ts", text: "two changed" }, { path: "src/lib/c.ts", text: "three" }]);
  const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-map-seed-"));
  fs.writeFileSync(path.join(seedDir, "lines.jsonl"), [
    JSON.stringify({ path: "src/lib/c.ts", kind: "code", line: "Seeded line for c." }),
    JSON.stringify({ path: "src/lib/a.ts", kind: "code", line: "Seed must not override a carried line." }),
    JSON.stringify({ path: "src/lib/gone.ts", kind: "code", line: "Not in the index." }),
  ].join("\n") + "\n");
  fs.writeFileSync(path.join(seedDir, "dirs.jsonl"), JSON.stringify({ dir: "src/lib", line: "Seeded dir line." }) + "\n");
  const prompts = [];
  const stats = await buildFileMap({
    dbPath: next.dbPath, generate: stubGenerate(prompts), model: "stub", previousDbPath: prev.dbPath,
    seed: { linesPath: path.join(seedDir, "lines.jsonl"), dirsPath: path.join(seedDir, "dirs.jsonl") },
  });
  assert.equal(stats.carried, 1);
  assert.equal(stats.seeded, 1);
  assert.equal(stats.generated, 1);
  const map = Object.fromEntries(rows(next.dbPath, "file_map").map(r => [r.path, r]));
  assert.equal(map["src/lib/a.ts"].line, "Describes src/lib/a.ts.");
  assert.equal(map["src/lib/b.ts"].line, "Describes src/lib/b.ts.");
  assert.equal(map["src/lib/c.ts"].line, "Seeded line for c.");
  assert.equal(map["src/lib/c.ts"].model, "seed");
  assert.match(prompts[0], /=== src\/lib\/b\.ts/);
  assert.doesNotMatch(prompts[0], /a\.ts|c\.ts/);
  for (const d of [prev.dir, next.dir, seedDir]) fs.rmSync(d, { recursive: true, force: true });
});
