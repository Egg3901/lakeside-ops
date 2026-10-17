"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { options, selectRelease, verify } = require("./update");
test("update options accept configurable channels and reject unexpected input", () => {
  assert.deepEqual(options(["--check", "--channel", "stable", "--repo", "example/terminal"], {}), { check: true, channel: "stable", repo: "example/terminal" });
  assert.equal(options([], { LAKESIDE_CODE_UPDATE_REPO: "other/fork" }).repo, "other/fork");
  for (const input of [["--channel", "nightly"], ["--repo", "--evil"], ["--tag", "../bad"], ["--yes"]]) assert.throws(() => options(input, {}));
});
test("terminal releases exclude server releases, drafts and previews on stable", () => {
  const release = (tag_name, prerelease, published_at = "2026-10-17") => ({ tag_name, prerelease, published_at });
  const rows = [release("keir-v5.8.3", false), { ...release("code-v9.0.0", false), draft: true }, release("code-v0.1.4-preview.1", true), release("code-v0.1.3", false, "2026-10-16")];
  assert.equal(selectRelease(rows, "preview").tag_name, "code-v0.1.4-preview.1");
  assert.equal(selectRelease(rows, "stable").tag_name, "code-v0.1.3");
});
test("checksum requires an exact unique asset match", () => {
  const bytes = Buffer.from("package"), hash = crypto.createHash("sha256").update(bytes).digest("hex");
  verify(bytes, `${hash}  package.tgz\n`, "package.tgz");
  assert.throws(() => verify(Buffer.from("tampered"), `${hash}  package.tgz`, "package.tgz"));
  assert.throws(() => verify(bytes, `${hash}  other.tgz`, "package.tgz"));
  assert.throws(() => verify(bytes, `${hash}  package.tgz\n${hash}  package.tgz`, "package.tgz"));
});
for (const corrupt of [false, true]) test(`packaged update ${corrupt ? "rejects corruption without npm" : "downloads, verifies and installs using argument arrays"}`, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "keir update test "));
  try {
    const moduleDir = path.join(directory, "package"); fs.mkdirSync(moduleDir);
    for (const name of ["update.js", "config.mjs", "package.json"]) fs.copyFileSync(path.join(__dirname, name), path.join(moduleDir, name));
    const archive = "lakesidegamedev-code-0.1.4.tgz", bytes = Buffer.from("fixture package");
    const hash = crypto.createHash("sha256").update(bytes).digest("hex"), calls = [], downloads = [];
    const run = (command, args) => {
      calls.push([command, args]);
      if (command === "gh" && args[0] === "api") return { status: 0, stdout: JSON.stringify([{ tag_name: "code-v0.1.4-preview.1", published_at: "2026-10-17", assets: [{ name: archive }, { name: "SHA256SUMS" }] }]) };
      if (command === "gh" && args[0] === "release") {
        const name = args[args.indexOf("--pattern") + 1], target = args[args.indexOf("--dir") + 1]; downloads.push(target);
        fs.writeFileSync(path.join(target, name), name === archive ? (corrupt ? "bad" : bytes) : `${hash}  ${archive}\n`);
      }
      return { status: 0 };
    };
    const update = require(path.join(moduleDir, "update.js"));
    const action = update.main([], { LAKESIDE_CODE_STATE_DIR: path.join(directory, "state") }, { run });
    if (corrupt) await assert.rejects(action, /checksum/); else await action;
    assert.equal(calls.filter(([name]) => name === "npm").length, corrupt ? 0 : 1);
    assert.ok(downloads.every(target => !fs.existsSync(target)));
    if (!corrupt) assert.equal(JSON.parse(fs.readFileSync(path.join(directory, "state/update.json"))).tag, "code-v0.1.4-preview.1");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test("check mode performs no download or install even from source", async () => {
  const calls = [];
  await require("./update").main(["--check"], {}, { run(command, args) {
    calls.push([command, args]); return { status: 0, stdout: JSON.stringify([{ tag_name: "code-v0.1.3-preview.1", assets: [{ name: "lakesidegamedev-code-0.1.3.tgz" }, { name: "SHA256SUMS" }] }]) };
  } });
  assert.equal(calls.length, 2);
});

test("a signed-out GitHub CLI falls back to anonymous HTTPS for public releases", async (t) => {
  const realFetch = global.fetch; const fetched = [];
  t.after(() => { global.fetch = realFetch; });
  global.fetch = async (url) => { fetched.push(String(url)); return { ok: true, json: async () => [{ tag_name: "code-v0.1.5-preview.1", prerelease: true, assets: [{ name: "lakesidegamedev-code-0.1.5-preview.1.tgz" }, { name: "SHA256SUMS" }] }] }; };
  const calls = [];
  await require("./update").main(["--check"], {}, { run(command, args) { calls.push(args[0]); return args[0] === "--version" ? { status: 0 } : { status: 1, stdout: "", stderr: "not logged in" }; } });
  assert.deepEqual(calls, ["--version", "api"]);
  assert.equal(fetched.length, 1);
  assert.match(fetched[0], /^https:\/\/api\.github\.com\/repos\/lakesidegamedev\/lakeside-ops\/releases/);
});
