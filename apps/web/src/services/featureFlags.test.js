"use strict";

const { describe, it, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadConfig, resetConfigCache } = require("../core/config");
const { isEnabled, listFlags } = require("./featureFlags");
const { featureDisabledResponse } = require("../routes/featureGate");

function writeTempYaml(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-ff-"));
  const file = path.join(dir, "dashboard.yaml");
  fs.writeFileSync(file, body);
  return file;
}

describe("featureFlags", () => {
  after(() => resetConfigCache());

  beforeEach(() => {
    delete process.env.ENABLE_CODE_AGENT;
    delete process.env.ENABLE_TICKETS;
    resetConfigCache();
  });

  it("respects YAML feature defaults", () => {
    const file = writeTempYaml(`
tenant: { name: T, shortName: T, dashboardTitle: T }
primaryProject: p
projects: [{ key: p, name: P, type: game }]
features: { codeAgent: false, tickets: true }
`);
    loadConfig({ configPath: file, force: true });
    assert.equal(isEnabled("codeAgent"), false);
    assert.equal(isEnabled("tickets"), true);
    assert.deepEqual(listFlags().tickets, true);
  });

  it("env ENABLE_* overrides YAML", () => {
    const file = writeTempYaml(`
tenant: { name: T, shortName: T, dashboardTitle: T }
primaryProject: p
projects: [{ key: p, name: P, type: game }]
features: { codeAgent: true }
`);
    process.env.ENABLE_CODE_AGENT = "0";
    loadConfig({ configPath: file, force: true });
    assert.equal(isEnabled("codeAgent"), false);
  });

  it("featureDisabledResponse returns 404 when off", () => {
    const file = writeTempYaml(`
tenant: { name: T, shortName: T, dashboardTitle: T }
primaryProject: p
projects: [{ key: p, name: P, type: game }]
features: { ideas: false }
`);
    loadConfig({ configPath: file, force: true });
    let status = 0;
    let body = "";
    const res = {
      writeHead(code) { status = code; },
      end(b) { body = b; },
    };
    assert.equal(featureDisabledResponse(res, "ideas"), true);
    assert.equal(status, 404);
    assert.match(body, /Feature disabled/);
  });
});
