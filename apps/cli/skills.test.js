"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { skillRoot, readSkill, listSkills, skillCommands, defaultInstructions } = require("./skills");

test("Keir workflows have readable instructions, pinned provenance and supporting references", () => {
  const rows = listSkills();
  assert.deepEqual(rows.map(row => row.name), ["ponytail", "ponytail-review", "systematic-debugging", "verification-before-completion", "test-driven-development", "frontend-design", "design-system", "ux-design", "accessible-design", "terminal-design", "design-review"]);
  for (const row of rows) {
    assert.match(row.revision, row.source === "Lakeside Games" ? /^1$/ : /^[a-f0-9]{40}$/);
    assert.ok(readSkill(row.name).length > 500);
    const text = readSkill(row.name);
    // Keep native skill reads usable instead of shipping dangling local links.
    for (const match of text.matchAll(/`([a-z][a-z-]*\.md)`|\]\(([a-z][a-z-]*\.md)\)/g)) {
      const file = match[1] || match[2];
      if (file) assert.ok(fs.existsSync(path.join(skillRoot(), "vendor", row.name, file)), `${row.name}/${file}`);
    }
    assert.match(skillCommands()[row.name].template, new RegExp(row.name));
  }
  assert.match(defaultInstructions(), /smallest|Smallest/);
  assert.match(defaultInstructions(), /verification-before-completion/);
  assert.throws(() => readSkill("../unknown"), /Unknown built-in/);
});

test("default workflows are configurable without removing available skills", t => {
  const os = require("node:os"), { configureDefaultSkills, defaultSkills } = require("./skills");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "custom-skills-")), env = { LAKESIDE_CODE_CONFIG_DIR: root };
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  configureDefaultSkills([], env);
  assert.deepEqual(defaultSkills(env), []);
  assert.match(defaultInstructions(env), /No built-in skill is enabled by default/);
  assert.ok(listSkills(env).every(row => !row.default));
  configureDefaultSkills(["systematic-debugging"], env);
  assert.match(defaultInstructions(env), /Configured default skills: systematic-debugging/);
  assert.doesNotMatch(defaultInstructions(env), /Ponytail full.*active by default/);
  assert.equal(listSkills(env).find(row => row.name === "systematic-debugging").default, true);
  assert.throws(() => configureDefaultSkills(["unknown"], env), /installed/);
});
