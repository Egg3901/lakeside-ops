"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { launchSettings, prepare } = require("./launch");

test("coding flags preserve OpenCode project, resume and model arguments", () => {
  assert.deepEqual(launchSettings(["/work/project", "--name", "Lakeside Code", "--continue", "--model", "provider/model"], {}), {
    args: ["/work/project", "--continue", "--model", "provider/model"], preview: false, name: "Lakeside Code", binary: "opencode",
  });
  assert.throws(() => launchSettings(["--name"], {}), /display name/);
  assert.throws(() => launchSettings(["--name", "bad\x1bname"], {}), /printable/);
  assert.throws(() => launchSettings(["--preview", "--prompt", "edit files"], {}), /runs by itself/);
});

test("launch config adds the client without replacing user providers, plugins or permissions", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lakeside-code-launch-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const original = { plugin: ["user-plugin"], permission: { bash: "ask" }, model: "my/model" };
  const env = { LAKESIDE_CODE_CONFIG_DIR: dir, OPENCODE_CONFIG_CONTENT: JSON.stringify(original), OTHER_SETTING: "kept" };
  const launch = prepare(launchSettings(["--preview"], env), env);
  const config = JSON.parse(launch.env.OPENCODE_CONFIG_CONTENT);
  assert.deepEqual(config.permission, { ...original.permission, agent_handoff: "ask" });
  assert.equal(config.model, original.model);
  assert.equal(config.plugin[0], "user-plugin");
  assert.match(config.plugin[1], /coordination-plugin\.mjs$/);
  assert.equal(launch.env.OTHER_SETTING, "kept");
  assert.equal(JSON.parse(launch.env.OPENCODE_ROUTE).id, "lakeside.preview");
  const tui = JSON.parse(fs.readFileSync(launch.env.OPENCODE_TUI_CONFIG));
  assert.equal(tui.plugin[0][1].name, "Lakeside Code");
  assert.equal(env.OPENCODE_CONFIG_CONTENT, JSON.stringify(original));
});
