"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLedger } = require("../lib/operator/store");

test("idle ledger saves avoid disk sync while changed receipts remain durable", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keir-store-"));
  const original = fs.fsyncSync; let syncs = 0;
  const perSave = process.platform === "win32" ? 1 : 2;
  fs.fsyncSync = fd => { syncs++; return original(fd); };
  try {
    const file = path.join(dir, "ledger.json"), ledger = createLedger(file);
    ledger.save(); assert.equal(syncs, perSave);
    ledger.save(); ledger.save();
    assert.equal(syncs, perSave, "idle drain ticks must not fsync the unchanged ledger");
    ledger.data.receipt = { state: "started" }; ledger.save(); assert.equal(syncs, 2 * perSave);
    assert.equal(JSON.parse(fs.readFileSync(file)).receipt.state, "started");
    ledger.data.receipt.state = "done"; ledger.save(); assert.equal(syncs, 3 * perSave);
    assert.equal(JSON.parse(fs.readFileSync(file)).receipt.state, "done");
  } finally { fs.fsyncSync = original; fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a failed durable write is retried even when state has not changed again", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keir-store-"));
  const original = fs.fsyncSync;
  try {
    const file = path.join(dir, "ledger.json"), ledger = createLedger(file);
    ledger.save(); ledger.data.receipt = { state: "started" };
    fs.fsyncSync = () => { throw new Error("disk sync failed"); };
    assert.throws(() => ledger.save(), /disk sync failed/);
    assert.equal(JSON.parse(fs.readFileSync(file)).receipt, undefined);
    fs.fsyncSync = original; ledger.save();
    assert.equal(JSON.parse(fs.readFileSync(file)).receipt.state, "started");
  } finally { fs.fsyncSync = original; fs.rmSync(dir, { recursive: true, force: true }); }
});
