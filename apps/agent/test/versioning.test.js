"use strict";
// Feature PRs add under ## Unreleased and never bump; bin/keir-cut.js bumps
// once per train. The 5.0.x series bumped on every PR (ten patch versions in
// three hours), which left no open release to collect later fixes.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { cut } = require("../bin/keir-cut");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("package, Cargo and the newest CHANGELOG version agree", () => {
  const version = JSON.parse(read("package.json")).version;
  assert.equal(/^version = "([^"]+)"/m.exec(read("rust/Cargo.toml"))[1], version);
  const changelog = read("CHANGELOG.md");
  const first = /^## (\d+\.\d+\.\d+) \(/m.exec(changelog)[1];
  assert.equal(first, version, "a version heading above package.json's version means a PR cut a release; put the lines under ## Unreleased");
  assert.ok(changelog.indexOf("## Unreleased") < changelog.indexOf(`## ${version} (`));
});

test("cut moves Unreleased under the new version and bumps every manifest once", () => {
  const files = {
    changelog: "# Changelog\n\n## Unreleased\n\n<!-- open -->\n\n- fixed a\n- fixed b\n\n## 5.1.0 (2026-10-15)\n\n- older\n",
    pkg: '{\n  "name": "x",\n  "version": "5.1.0"\n}\n',
    lock: '{\n  "version": "5.1.0",\n  "packages": { "": { "version": "5.1.0" }, "node_modules/d": { "version": "5.1.0" } }\n}\n',
    cargo: '[workspace.package]\nversion = "5.1.0"\n',
    cargoLock: 'name = "lakeside"\nversion = "5.1.0"\n\nname = "serde"\nversion = "5.1.0"\n',
  };
  const out = cut(files, "5.1.1", "2026-10-16");
  assert.match(out.changelog, /## Unreleased\n\n## 5\.1\.1 \(2026-10-16\)\n\n- fixed a\n- fixed b\n\n## 5\.1\.0/);
  assert.doesNotMatch(out.changelog, /<!-- open -->/);
  assert.match(out.pkg, /"version": "5\.1\.1"/);
  assert.equal((out.lock.match(/5\.1\.1/g) || []).length, 2, "the dependency pinned at the same number is untouched");
  assert.match(out.cargo, /version = "5\.1\.1"/);
  assert.match(out.cargoLock, /name = "lakeside"\nversion = "5\.1\.1"/);
  assert.match(out.cargoLock, /name = "serde"\nversion = "5\.1\.0"/);
  assert.throws(() => cut(files, "5.1.0", "d"), /not newer/);
  assert.throws(() => cut({ ...files, changelog: "## Unreleased\n\n<!-- open -->\n\n## 5.1.0 (x)\n" }, "5.1.1", "d"), /nothing under/);
});
