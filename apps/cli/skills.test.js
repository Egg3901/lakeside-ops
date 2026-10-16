"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { skillRoot, readSkill, listSkills, skillCommands, defaultInstructions } = require("./skills");

test("Keir workflows have readable instructions, pinned provenance and supporting references", () => {
  const rows = listSkills();
  assert.deepEqual(rows.map(row => row.name), ["ponytail", "ponytail-review", "systematic-debugging", "verification-before-completion", "test-driven-development", "frontend-design"]);
  for (const row of rows) {
    assert.match(row.revision, /^[a-f0-9]{40}$/);
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
