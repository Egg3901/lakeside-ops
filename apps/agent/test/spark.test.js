"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { EventEmitter } = require("node:events");
const { makeSpark, MODEL } = require("../lib/operator/spark");
const { makeDistiller, makeCurator } = require("../lib/operator/knowledge");
const { createClassifier } = require("../lib/operator/classify");
const { makeTldr, firstSentence } = require("../lib/operator/decisions");

function fake(output, { code = 0, inspect = () => {}, hang = false } = {}) {
  return (bin, args, opts) => {
    inspect(bin, args, opts);
    const child = new EventEmitter(); child.stdout = new EventEmitter();
    child.stdin = { end() { if (!hang) setImmediate(() => { child.stdout.emit("data", output); child.emit("close", code); }); } };
    return child;
  };
}

test("Spark uses the exact Meta contributor model and isolated configuration, then removes scratch files", async () => {
  let workspace, config;
  const spark = makeSpark({ spawnImpl: fake("A short answer", { inspect(bin, args, opts) {
    assert.equal(bin, "/root/.local/bin/muse");
    assert.equal(args[args.indexOf("--model") + 1], MODEL);
    assert.equal(args[args.indexOf("--provider") + 1], "meta");
    assert.equal(args[args.indexOf("--contributor-mode") + 1], "on");
    for (const flag of ["--disable-shell", "--disable-write", "--disable-web-tools", "--disable-reminders", "--no-session-log", "--no-foreign-personal-context"]) assert.ok(args.includes(flag));
    assert.ok(!args.includes("--trust-workspace"));
    workspace = opts.cwd; config = opts.env.XDG_CONFIG_HOME;
    assert.deepEqual(fs.readdirSync(workspace), []);
    assert.deepEqual(fs.readdirSync(`${config}/muse`), ["auth.json"]);
    assert.equal(fs.readlinkSync(`${config}/muse/auth.json`), "/root/.config/muse/auth.json");
    const prompt = fs.readFileSync(args[args.indexOf("--prompt-file") + 1], "utf8");
    assert.match(prompt, /System instruction[\s\S]*Task input/);
  } }) });
  assert.equal(await spark("System instruction", "Task input"), "A short answer");
  assert.equal(fs.existsSync(workspace), false); assert.equal(fs.existsSync(config), false);
});

test("structured helpers accept Muse's plain output, including fenced JSON", async () => {
  const notes = [{ text: "Corporations pay taxes on their profits.", path: null }];
  assert.deepEqual(await makeDistiller({ spawnImpl: fake('```json\n' + JSON.stringify({ notes }) + '\n```') })({ title: "Taxes", body: "Game rules" }), notes);
  const actions = [{ op: "drop", id: "old", reason: "Duplicate" }];
  assert.deepEqual(await makeCurator({ spawnImpl: fake(JSON.stringify({ actions })) })([{ id: "old", kind: "knowledge", text: "A duplicate note" }]), actions);
  assert.deepEqual(await makeDistiller({ spawnImpl: fake('{"notes":{}}') })({ body: "Rules" }), []);
  assert.deepEqual(await makeCurator({ spawnImpl: fake('{"actions":"oops"}') })([]), []);
});

test("provider failure preserves the quiet classifier, original summary and empty learning fallbacks", async () => {
  const spawnImpl = fake('{"forKeir":true}', { code: 1 });
  assert.equal(await createClassifier({ spawnImpl, jev: async () => null })({ transcript: [], message: { content: "Question" } }), false);
  const question = "Approve this specific fix. It repairs the broken action.";
  assert.equal(await makeTldr({ spawnImpl })(question), firstSentence(question));
  assert.deepEqual(await makeDistiller({ spawnImpl })({ body: "Rules" }), []);
  assert.deepEqual(await makeCurator({ spawnImpl })([]), []);
});

test("a stalled helper resolves at its deadline even if the process never closes", async () => {
  let workspace;
  const spark = makeSpark({ timeoutMs: 10, spawnImpl: fake("", { hang: true, inspect(_bin, _args, opts) { workspace = opts.cwd; } }) });
  assert.equal(await spark("Instructions", "Input"), "");
  assert.equal(fs.existsSync(workspace), false);
});

test("spawn errors and excessive output also finish safely", async () => {
  assert.equal(await makeSpark({ spawnImpl() { throw new Error("missing binary"); } })("System", "Input"), "");
  assert.equal(await makeSpark({ spawnImpl: fake("x".repeat(64001)) })("System", "Input"), "");
});
