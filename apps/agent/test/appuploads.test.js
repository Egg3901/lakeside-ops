"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { createLedger } = require("../lib/operator/store");
const { createAppChannel, createAppServer } = require("../lib/operator/appchannel");
const { createUploads } = require("../lib/operator/appuploads");
function setup(t) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "keir-files-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const ledger = createLedger(path.join(stateDir, "ledger.json"));
  ledger.data.appThread = { seq: 0, messages: [], clients: {}, status: {}, threads: { other: { title: "Other" } } };
  const config = { stateDir, ownerId: "owner", botId: "keir", taskLifetimeMs: 3600000 };
  const app = createAppChannel({ ledger, config });
  return { stateDir, ledger, config, app, uploads: app.uploads };
}
test("private file grants are conversation-bound, canonical and stable across retries", async t => {
  const { ledger, app, uploads } = setup(t);
  const a = await uploads.put(Buffer.from("untrusted file evidence"), "../notes.txt", "text/plain");
  assert.equal(a.name, "notes.txt"); assert.equal(a.path, undefined);
  assert.throws(() => app.authenticatedPost("inspect", "wrong", "other", { attachments: [a] }), /unavailable/);
  assert.throws(() => app.post("inspect", "unauthed", "main", { attachments: [a] }), /Authenticated/);
  const first = app.authenticatedPost("", "retry", "main", { attachments: [{ ...a, url: "https://example.com/ignored", type: "image/fake" }] });
  assert.equal(first.message.attachments[0].type, "text/plain");
  assert.equal(app.authenticatedPost("", "retry", "main", { attachments: [a] }).duplicate, true);
  assert.throws(() => app.authenticatedPost("different", "retry", "main", { attachments: [a] }), /different message/);
  const job = ledger.data.jobs[first.jobId];
  const child = { id: "child", codingParent: job.id }; ledger.data.jobs.child = child;
  const evidence = await uploads.inspect(child, 0);
  assert.equal(evidence.text, "untrusted file evidence"); assert.equal(evidence.sourceMessageId, first.message.id); assert.equal(evidence.evidenceOnly, true);
  assert.throws(() => uploads.remove(a.id), /sent message/);
  const other = app.authenticatedPost("separate", "other-job", "other", { mode: "new" });
  await assert.rejects(uploads.inspect(ledger.data.jobs[other.jobId], 0), /source index/);
  assert.equal(Object.keys(ledger.data.jobs).length, 3);
});
test("image uploads strip metadata, retain a bounded raster and reject vector or binary files", async t => {
  const { uploads } = setup(t), sharp = require("sharp");
  const source = await sharp({ create: { width: 3000, height: 20, channels: 3, background: "red" } }).png().toBuffer();
  const ref = await uploads.put(source, "image.png", "image/png");
  const saved = uploads.lookup(ref.id), meta = await sharp(saved.bytes).metadata();
  assert.equal(meta.format, "jpeg"); assert.equal(meta.width, 2048); assert.equal(meta.exif, undefined);
  await assert.rejects(uploads.put(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'), "a.svg", "image/svg+xml"), /could not be decoded|raster/);
  await assert.rejects(uploads.put(Buffer.from([0, 1, 2]), "a.bin", "application/octet-stream"), /Binary/);
  await assert.rejects(uploads.put(Buffer.alloc(10 * 1024 * 1024 + 1), "big", "text/plain"), /10 MB/);
});
test("integrity and cleanup preserve active delegated evidence and expire unused bytes", async t => {
  const { stateDir, ledger, config, app, uploads } = setup(t);
  const used = await uploads.put(Buffer.from("evidence"), "e.txt", "text/plain");
  const unused = await uploads.put(Buffer.from("draft"), "d.txt", "text/plain");
  const sent = app.authenticatedPost("investigate", "send", "main", { attachments: [used] });
  const root = ledger.data.jobs[sent.jobId]; root.state = "done";
  ledger.data.jobs.child = { id: "child", codingParent: root.id, state: "running" };
  const later = createUploads({ ledger, config, now: () => Date.now() + 8 * 86400000 });
  assert.equal(later.cleanup(), 1); assert.equal(later.lookup(used.id).bytes.toString(), "evidence");
  assert.throws(() => later.lookup(unused.id), /unavailable/);
  fs.writeFileSync(path.join(stateDir, "uploads", used.id + ".bin"), "tampered");
  await assert.rejects(later.inspect(root, 0), /integrity/);
});
test("upload HTTP endpoints require owner auth, reject cross-origin writes and never publicly cache files", async t => {
  const { app } = setup(t);
  const server = createAppServer({ app, authenticate: async req => req.headers.authorization === "owner" ? "owner" : req.headers.authorization === "staff" ? "staff" : false });
  await new Promise(r => server.listen(0, "127.0.0.1", r)); t.after(() => new Promise(r => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}/api/keir/app`;
  const upload = headers => fetch(url + "/uploads", { method: "POST", headers: { "Content-Type": "text/plain", ...headers }, body: "saved evidence" });
  assert.equal((await upload({})).status, 401); assert.equal((await upload({ authorization: "staff" })).status, 403);
  assert.equal((await upload({ authorization: "owner", origin: "https://evil.example" })).status, 403);
  const result = await upload({ authorization: "owner", "X-Filename": "notes.txt" }); assert.equal(result.status, 201);
  const ref = await result.json();
  assert.equal((await fetch(url + "/uploads/" + ref.id)).status, 401);
  const read = await fetch(url + "/uploads/" + ref.id, { headers: { authorization: "owner" } });
  assert.equal(read.status, 200); assert.equal(read.headers.get("cache-control"), "no-store"); assert.equal(await read.text(), "saved evidence");
  const send = await fetch(url + "/messages", { method: "POST", headers: { authorization: "owner", "Content-Type": "application/json" }, body: JSON.stringify({ text: "inspect", clientId: "sent", attachments: [ref] }) });
  assert.equal(send.status, 201); assert.equal((await send.json()).message.attachments[0].id, ref.id);
});
function pdf(text) {
  const stream = text ? `BT /F1 12 Tf 20 100 Td (${text}) Tj ET` : "0 0 1 rg 20 20 40 40 re f";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let out = "%PDF-1.4\n", offsets = [0];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}
test("PDF inspection extracts one bounded page and renders a page with no text", { skip: !fs.existsSync("/usr/bin/pdftotext") || !fs.existsSync("/usr/bin/pdftoppm") }, async t => {
  const { ledger, app, uploads } = setup(t);
  const text = await uploads.put(pdf("Source evidence"), "source.pdf", "application/pdf");
  const scan = await uploads.put(pdf(null), "scan.pdf", "application/pdf");
  const sent = app.authenticatedPost("Inspect both PDFs", "pdf", "main", { attachments: [text, scan] });
  const job = ledger.data.jobs[sent.jobId];
  assert.match((await uploads.inspect(job, 0, 1)).text, /Source evidence/);
  const rendered = await uploads.inspect(job, 1, 1);
  assert.equal(rendered.image.media_type, "image/jpeg"); assert.ok(Buffer.from(rendered.image.data, "base64").length > 100);
  await assert.rejects(uploads.inspect(job, 0, 41), /1-40/);
});

test("private app files do not silently change the selected provider or become a local ping", async t => {
  const { ledger, app, uploads } = setup(t);
  const a = await uploads.put(Buffer.from("source evidence"), "note.txt", "text/plain");
  const sent = app.authenticatedPost("test", "test-file", "main", { attachments: [a] });
  const job = ledger.data.jobs[sent.jobId];
  assert.equal(job.state, "queued"); assert.equal(app.view().messages.length, 1);
  job.tags = { needsVision: true }; job.provider = { runner: "codex", model: "gpt-6.1-sol" };
  assert.equal(require("../lib/operator/agent").routeForVision(job, { visionProvider: "muse:muse-spark-1.3" }, ledger), false);
  assert.equal(job.provider.model, "gpt-6.1-sol");
});
