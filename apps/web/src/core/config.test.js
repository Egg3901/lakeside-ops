"use strict";

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  loadConfig,
  resetConfigCache,
  validateConfig,
  FEATURE_ENV_MAP,
} = require("./config");
const registry = require("../services/projectRegistry");
const { isEnabled, listFlags } = require("../services/featureFlags");
const { escapeHtml } = require("../ui/safeDom");

function writeTempYaml(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-cfg-"));
  const file = path.join(dir, "dashboard.yaml");
  fs.writeFileSync(file, body);
  return { dir, file };
}

const ENV_KEYS = [
  "TENANT_NAME",
  "DASHBOARD_TITLE",
  "PRIMARY_PROJECT_KEY",
  "ENABLE_CODE_AGENT",
  "ENABLE_SSO",
  "BACKUP_DIR",
  "FINDER_ROOTS",
  "OPS_SSO_HOSTS",
  "SSO_BASE_URL",
  "LAKESIDE_AUTH_BASE_URL",
];

describe("config + registry", () => {
  const saved = {};

  before(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
  });

  after(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetConfigCache();
  });

  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
    resetConfigCache();
  });

  it("loads the public example without a studio tenant file", () => {
    const cfg = loadConfig({ force: true });
    assert.ok(cfg.tenant.shortName);
    assert.ok(cfg.primaryProject);
    assert.ok(cfg.projects.some((p) => p.key === cfg.primaryProject));
    assert.equal(cfg.features.codeAgent, true);
  });

  it("validateConfig catches missing projects", () => {
    const errors = validateConfig({ tenant: { name: "X" }, projects: "nope" });
    assert.ok(errors.some((e) => e.includes("projects")));
  });

  it("validateConfig rejects unsupported auth modes", () => {
    const errors = validateConfig({ tenant: { name: "X", dashboardTitle: "X" }, projects: [], auth: { mode: "mixed" } });
    assert.ok(errors.some((error) => error.includes("auth.mode")));
  });

  it("env overrides tenant + feature flags", () => {
    const { file } = writeTempYaml(`
tenant:
  name: "Yaml Studio"
  shortName: "Yaml"
  dashboardTitle: "Yaml Ops"
primaryProject: g1
projects:
  - key: g1
    name: "Game One"
    type: game
features:
  codeAgent: true
  tickets: true
`);
    process.env.TENANT_NAME = "Env Studio";
    process.env.ENABLE_CODE_AGENT = "false";
    const cfg = loadConfig({ configPath: file, force: true });
    assert.equal(cfg.tenant.name, "Env Studio");
    assert.equal(cfg.features.codeAgent, false);
    assert.equal(cfg.features.tickets, true);
  });

  it("projectRegistry lists games and status services", () => {
    loadConfig({ force: true });
    const games = registry.listGames();
    assert.equal(games.length, 1);
    assert.ok(games.every((g) => g.key && g.name));
    const primary = registry.getPrimaryProject();
    assert.equal(primary.key, "nova-game");
    const status = registry.listStatusServices();
    assert.ok(status.some((s) => s.id === "nova-game"));
    assert.ok(status.some((s) => s.id === "ops"));
    assert.ok(!games.some((g) => g.key === "ahd"));
    assert.ok(!status.some((s) => s.id === "accounts"));
  });

  it("featureFlags.isEnabled mirrors config", () => {
    loadConfig({ force: true });
    assert.equal(isEnabled("codeAgent"), true);
    assert.equal(isEnabled("noSuchFeature"), false);
    const flags = listFlags();
    assert.ok(Object.keys(FEATURE_ENV_MAP).every((k) => k in flags || k === "sso"));
  });

  it("SSO_BASE_URL preferred over LAKESIDE_AUTH_BASE_URL", () => {
    process.env.LAKESIDE_AUTH_BASE_URL = "https://legacy.example";
    process.env.SSO_BASE_URL = "https://sso.example";
    const cfg = loadConfig({ force: true });
    assert.equal(cfg.sso.baseUrl, "https://sso.example");
  });

  it("FINDER_ROOTS CSV overrides yaml roots", () => {
    process.env.FINDER_ROOTS = "/tmp,/var/tmp";
    loadConfig({ force: true });
    const roots = registry.listFinderRoots();
    assert.equal(roots.length, 2);
    assert.equal(roots[0].path, "/tmp");
  });

  it("BACKUP_DIR env wins over yaml paths.backupDir", () => {
    const { file } = writeTempYaml(`
tenant:
  name: "Yaml Studio"
  shortName: "Yaml"
  dashboardTitle: "Yaml Ops"
primaryProject: g1
projects:
  - key: g1
    name: "Game One"
    type: game
paths:
  backupDir: /from/yaml/backups
`);
    process.env.BACKUP_DIR = "/from/env/backups";
    const cfg = loadConfig({ configPath: file, force: true });
    assert.equal(cfg.paths.backupDir, "/from/env/backups");
  });

  it("BACKUP_DIR falls back to data/backups when unset in env and yaml", () => {
    const { file } = writeTempYaml(`
tenant:
  name: "Yaml Studio"
  shortName: "Yaml"
  dashboardTitle: "Yaml Ops"
primaryProject: g1
projects:
  - key: g1
    name: "Game One"
    type: game
`);
    delete process.env.BACKUP_DIR;
    const cfg = loadConfig({ configPath: file, force: true });
    assert.match(cfg.paths.backupDir, /data[/\\]backups$/);
  });
});

describe("safeDom", () => {
  it("escapeHtml encodes markup", () => {
    assert.equal(escapeHtml(`<img src=x onerror="alert(1)">`), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});
