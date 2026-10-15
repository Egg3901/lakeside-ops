"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { selfInfo } = require("../lib/operator/selfinfo");
const { createLedger } = require("../lib/operator/store");
const { createGateway } = require("../lib/operator/gateway");

const live = { quickProvider: "codex:gpt-6.1-sol@medium", workerProvider: "codex:gpt-6.1-sol@medium", dynamicEffort: false };

test("the running-on sentence names the version, release, models and effort", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "keir-self-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "3.0.0" }));
  fs.writeFileSync(path.join(root, "RELEASE"), "41e3878dc7d6abcdef 3.0.0\n");
  const info = selfInfo(live, root);
  assert.equal(info.sentence, "Keir is running on lakeside-operator 3.0.0 (release 41e3878), with GPT 6.1 SOL at medium effort for conversations and tickets, and Muse Wonder Full 1.0 at medium effort for coding fixes.");
  const rotating = selfInfo({ ...live, quickProvider: "codex:gpt-6.1-sol@medium,muse:muse-wonder-full-1.0@medium,claude:claude-sonnet-5-5@medium" }, root);
  assert.equal(rotating.sentence, "Keir is running on lakeside-operator 3.0.0 (release 41e3878), with conversations alternating between GPT 6.1 SOL, Muse Wonder Full 1.0 and Claude Sonnet 5.5 at medium effort, GPT 6.1 SOL at medium effort for tickets and other work, and Muse Wonder Full 1.0 at medium effort for coding fixes.");
  // a source checkout has no RELEASE file; lanes on different models are named separately
  fs.rmSync(path.join(root, "RELEASE"));
  const split = selfInfo({ ...live, quickProvider: "codex:gpt-6-luna@low", workerProvider: "codex:gpt-6.1-sol", dynamicEffort: true }, root);
  assert.match(split.sentence, /^Keir is running on lakeside-operator 3\.0\.0, with GPT 6 Luna at effort chosen per task for conversations, GPT 6\.1 SOL at effort chosen per task for tickets/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("'/keir status' and 'Keir status' both answer with what Keir is running on", () => {
  for (const content of ["/keir status", "Keir status"]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keir-self-gw-"));
    const ledger = createLedger(path.join(dir, "ledger.json"));
    const config = { ...live, ownerId: "111111111111111111", staffIds: [], botId: "333333333333333333", taskLifetimeMs: 86400000, watched: () => false };
    const g = createGateway({ ledger, config });
    g.ingest({ id: "444444444444444444", name: "owner-dm", type: 1 },
      { id: "666666666666666666", author: { id: config.ownerId, username: "o" }, content, timestamp: new Date().toISOString(), mentions: [], attachments: [] });
    const reply = ledger.data.outbox["discord:666666666666666666"];
    assert.ok(reply, content);
    assert.match(reply.content, /^Keir is running on lakeside-operator \d+\.\d+\.\d+.*GPT 6\.1 SOL at medium effort.*Muse Wonder Full 1\.0 at medium effort/);
    assert.match(reply.content, /Operator (active|paused)\. \d+ open tasks/);
    assert.equal(Object.keys(ledger.data.jobs).length, 0); // a status question starts no task
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
