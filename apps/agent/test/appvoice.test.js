"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { createSpeech } = require("../lib/operator/appvoice");
test("speech uses a private input file, returns audio, and removes request files", async t => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-fixture-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
 const binary = path.join(dir, "voice");
 fs.writeFileSync(binary, `#!/usr/bin/env node\nconst fs=require('node:fs'),args=process.argv.slice(2);const input=args[args.indexOf('--file')+1];if(fs.statSync(input).mode%512!==384)process.exit(2);fs.writeFileSync(${JSON.stringify(path.join(dir,"input-path"))},input);fs.writeFileSync(args[args.indexOf('--write-media')+1],Buffer.from('ID3'+fs.readFileSync(input,'utf8')));`, { mode: 0o700 });
 const speech = createSpeech({ env: { KEIR_SPEECH_BIN: binary } });
 assert.equal((await speech.synthesize("A private reply")).toString(), "ID3A private reply");
 assert.equal(fs.existsSync(fs.readFileSync(path.join(dir,"input-path"),"utf8")), false);
 await assert.rejects(speech.synthesize(""), /1 to 6000/);
 await assert.rejects(speech.synthesize("x".repeat(6001)), /1 to 6000/);
});
test("missing voice installation reports service unavailability without child output", async () => {
 const speech = createSpeech({ env: { KEIR_SPEECH_BIN: "/does-not-exist/voice" } });
 await assert.rejects(speech.synthesize("Hello"), error => error.status === 503 && !error.message.includes("ENOENT"));
});
