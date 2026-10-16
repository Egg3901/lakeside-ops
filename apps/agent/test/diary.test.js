"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createDiary, reflect, INTERVAL_MS, RETRY_MS } = require("../lib/operator/diary");

function fixture(t) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "keir-diary-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  let at = 1800000000000;
  const ledger = { data: { jobs: {} } };
  const opts = { stateDir, ledger, now: () => at };
  return { opts, advance: n => { at += n; }, read: () => JSON.parse(fs.readFileSync(path.join(stateDir, "private/diary.json"))),
    mode: () => fs.statSync(path.join(stateDir, "private/diary.json")).mode & 0o777 };
}

test("private diary survives restart, retains history and writes once per twelve hours", async t => {
  const f = fixture(t), contexts = [];
  const generate = async c => { contexts.push(c); return "I learned to check the receipt."; };
  let diary = createDiary({ ...f.opts, generate });
  await diary.tick();
  assert.equal(f.mode(), 0o600);
  assert.equal(f.read().entries.length, 1);
  assert.equal(f.opts.ledger.data.entries, undefined);
  diary = createDiary({ ...f.opts, generate });
  f.advance(INTERVAL_MS - 1); await diary.tick();
  assert.equal(contexts.length, 1);
  f.advance(1); await diary.tick();
  assert.equal(contexts.length, 2);
  assert.equal(contexts[1].previousEntries[0].text, "I learned to check the receipt.");
  assert.equal(f.read().entries.length, 2);
});

test("failure backs off across restart without recording an entry", async t => {
  const f = fixture(t);
  await assert.rejects(createDiary({ ...f.opts, generate: async () => { throw Error("offline"); } }).tick());
  let calls = 0;
  const diary = createDiary({ ...f.opts, generate: async () => { calls++; return "Quiet day."; } });
  await diary.tick(); assert.equal(calls, 0);
  f.advance(RETRY_MS); await diary.tick();
  assert.equal(calls, 1); assert.equal(f.read().entries.length, 1);
});

test("concurrent ticks cannot duplicate entries, and pause suppresses generation", async t => {
  const f = fixture(t); let finish, calls = 0;
  const diary = createDiary({ ...f.opts, generate: () => { calls++; return new Promise(r => { finish = r; }); } });
  f.opts.ledger.data.paused = true; await diary.tick(); assert.equal(calls, 0);
  f.opts.ledger.data.paused = false;
  const pending = diary.tick(); await diary.tick(); assert.equal(calls, 1);
  finish("I checked my work."); await pending;
  assert.equal(f.read().entries.length, 1);
});

test("reflection receives bounded recent summaries without raw conversations or credentials", async t => {
  const f = fixture(t); let context;
  f.opts.ledger.data.jobs.old = { at: 1, summary: "stale" };
  for (let i = 0; i < 90; i++) f.opts.ledger.data.jobs[i] = {
    updatedAt: f.opts.now(), kind: "ticket", state: "done",
    summary: "Fixed. OLLAMA_API_KEY=secret-value", source: { content: "private raw message" },
  };
  await createDiary({ ...f.opts, generate: async c => { context = c; return "A quiet reflection."; } }).tick();
  assert.equal(context.workCount, 90); assert.equal(context.work.length, 80);
  assert.doesNotMatch(JSON.stringify(context), /secret-value|private raw message|stale/);
});

test("empty model output does not become a diary entry", async t => {
  const f = fixture(t);
  await assert.rejects(createDiary({ ...f.opts, generate: async () => " " }).tick(), /invalid/);
  assert.equal(f.read().entries, undefined);
});

test("DeepSeek reflection uses the common CLI with no tools and rejects incomplete output", async () => {
  let request;
  const invoke = async input => { request = input; return { result: "I learned something.", usage: {} }; };
  assert.equal(await reflect({ work: [] }, { invoke }), "I learned something.");
  assert.equal(request.runner, "ollama");
  assert.equal(request.model, "deepseek-v4.1-flash");
  assert.deepEqual(request.tools, []); assert.equal(request.maxOutputTokens, 1600);
  assert.equal(request.kind, "generation");
  assert.ok(request.stateDir.endsWith("private"));
  await assert.rejects(reflect({}, { invoke: async () => ({ is_error: true }) }), /incomplete/);
  await assert.rejects(reflect({}, { invoke: async () => ({ result: "" }) }), /invalid/);
});
test("reflection usage records counts without private text or completion claims", async t => {
  const f=fixture(t);
  await createDiary({...f.opts,generate:async(c,{onUsage})=>{onUsage({input:100,output:20});return "PRIVATE_DIARY_TEXT";}}).tick();
  const raw=fs.readFileSync(path.join(f.opts.stateDir,"usage.jsonl"),"utf8"), row=JSON.parse(raw.trim());
  assert.doesNotMatch(raw,/PRIVATE_DIARY_TEXT|previousEntries/);
  assert.equal(row.tokens.input,100);assert.equal(row.tokens.output,20);assert.equal(row.taskState,undefined);
});
