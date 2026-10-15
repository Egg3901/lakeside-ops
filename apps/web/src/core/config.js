"use strict";

/**
 * Load & merge tenant config from config/dashboard.yaml (+ optional local override)
 * and environment variables. Env always wins over YAML for identity / feature flags / paths.
 */

const fs = require("fs");
const path = require("path");
const YAML = require("yaml");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_CONFIG_PATH = path.join(ROOT, "config", "dashboard.yaml");
const LOCAL_CONFIG_PATH = path.join(ROOT, "config", "dashboard.local.yaml");
const EXAMPLE_CONFIG_PATH = path.join(ROOT, "config", "dashboard.example.yaml");

// Ensure .env is visible even when this module is required before server.js dotenv.
try {
  const dotenvPath = path.join(ROOT, ".env");
  if (fs.existsSync(dotenvPath)) {
    require("dotenv").config({ path: dotenvPath, quiet: true });
  }
} catch { /* optional */ }

const FEATURE_ENV_MAP = Object.freeze({
  statusPage: "ENABLE_STATUS_PAGE",
  codeAgent: "ENABLE_CODE_AGENT",
  discordInsights: "ENABLE_DISCORD_INSIGHTS",
  tickets: "ENABLE_TICKETS",
  wikiExport: "ENABLE_WIKI_EXPORT",
  backups: "ENABLE_BACKUPS",
  dbBrowser: "ENABLE_DB_BROWSER",
  ideas: "ENABLE_IDEAS",
  agentsPage: "ENABLE_AGENTS_PAGE",
  sso: "ENABLE_SSO",
});

const DEFAULT_FEATURES = Object.freeze({
  statusPage: true,
  codeAgent: true,
  discordInsights: true,
  tickets: true,
  wikiExport: true,
  backups: true,
  dbBrowser: true,
  ideas: true,
  agentsPage: true,
  sso: false,
});

let _cache = null;

function parseBool(raw, fallback) {
  if (raw == null || raw === "") return fallback;
  const v = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

function readYamlFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) return null;
  return YAML.parse(raw) || {};
}

function deepMerge(base, overlay) {
  if (!overlay || typeof overlay !== "object") return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(overlay)) {
    if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function validateConfig(cfg) {
  const errors = [];
  if (!cfg || typeof cfg !== "object") {
    errors.push("config root must be an object");
    return errors;
  }
  if (!cfg.tenant || typeof cfg.tenant !== "object") {
    errors.push("tenant: object required");
  } else {
    if (!cfg.tenant.name) errors.push("tenant.name required");
    if (!cfg.tenant.dashboardTitle && !cfg.tenant.shortName) {
      errors.push("tenant.dashboardTitle or tenant.shortName required");
    }
  }
  if (!Array.isArray(cfg.projects)) {
    errors.push("projects: array required");
  } else {
    const keys = new Set();
    for (const [i, p] of cfg.projects.entries()) {
      if (!p || typeof p !== "object") {
        errors.push(`projects[${i}]: object required`);
        continue;
      }
      if (!p.key) errors.push(`projects[${i}].key required`);
      else if (keys.has(p.key)) errors.push(`projects[${i}].key duplicate: ${p.key}`);
      else keys.add(p.key);
      if (!p.name) errors.push(`projects[${i}].name required`);
    }
    if (cfg.primaryProject && !keys.has(cfg.primaryProject)) {
      errors.push(`primaryProject "${cfg.primaryProject}" not in projects`);
    }
  }
  if (cfg.statusServices && !Array.isArray(cfg.statusServices)) {
    errors.push("statusServices: must be an array when set");
  }
  if (cfg.auth?.mode && !["password", "sso"].includes(cfg.auth.mode)) {
    errors.push("auth.mode: must be password or sso");
  }
  return errors;
}

function applyEnvOverrides(cfg) {
  const tenant = { ...(cfg.tenant || {}) };
  if (process.env.TENANT_NAME) tenant.name = process.env.TENANT_NAME;
  if (process.env.TENANT_SHORT_NAME) tenant.shortName = process.env.TENANT_SHORT_NAME;
  if (process.env.DASHBOARD_TITLE) tenant.dashboardTitle = process.env.DASHBOARD_TITLE;
  if (process.env.TENANT_HOME_URL) tenant.homeUrl = process.env.TENANT_HOME_URL;
  if (process.env.TENANT_LOGO_URL) tenant.logoUrl = process.env.TENANT_LOGO_URL;
  if (!tenant.dashboardTitle) {
    tenant.dashboardTitle = tenant.shortName ? `${tenant.shortName} Ops` : "Ops Dashboard";
  }
  if (!tenant.logoUrl) tenant.logoUrl = "/logo.svg";

  const features = { ...DEFAULT_FEATURES, ...(cfg.features || {}) };
  // Backward-compat: lakesideAuth → sso
  if (features.lakesideAuth != null && features.sso == null) {
    features.sso = !!features.lakesideAuth;
  }
  delete features.lakesideAuth;
  for (const [feat, envKey] of Object.entries(FEATURE_ENV_MAP)) {
    if (process.env[envKey] != null && process.env[envKey] !== "") {
      features[feat] = parseBool(process.env[envKey], features[feat]);
    }
  }
  // Alias for one release cycle
  if (process.env.ENABLE_LAKESIDE_AUTH != null && process.env.ENABLE_LAKESIDE_AUTH !== "" && process.env.ENABLE_SSO == null) {
    features.sso = parseBool(process.env.ENABLE_LAKESIDE_AUTH, features.sso);
  }

  let primaryProject = process.env.PRIMARY_PROJECT_KEY || cfg.primaryProject || null;
  if (!primaryProject && Array.isArray(cfg.projects) && cfg.projects.length) {
    primaryProject = cfg.projects[0].key;
  }

  const paths = {
    projectsRoot: process.env.PROJECTS_ROOT || cfg.paths?.projectsRoot || "",
    projectsManifest: process.env.PROJECTS_MANIFEST || cfg.paths?.projectsManifest || "",
    backupDir: process.env.BACKUP_DIR || cfg.paths?.backupDir || path.join(ROOT, "data", "backups"),
    uploadsDir: process.env.UPLOADS_DIR || cfg.paths?.uploadsDir || path.join(ROOT, "data", "uploads"),
    skillsDir: process.env.SKILLS_DIR || cfg.paths?.skillsDir || "",
    hermesSkillsDir: process.env.HERMES_SKILLS_DIR || cfg.paths?.hermesSkillsDir || "",
    hermesHomeDir: process.env.HERMES_HOME_DIR || cfg.paths?.hermesHomeDir || "",
    sandboxDir: process.env.SANDBOX_DIR || cfg.paths?.sandboxDir || path.join(ROOT, "ahd-sandbox"),
    // The branch codebase Q&A answers from. The AHD repo's default branch is
    // `master` — released code — so a clone left on the default answers
    // questions about what shipped while the asker means what they just merged.
    sandboxBranch: process.env.SANDBOX_BRANCH || cfg.paths?.sandboxBranch || "development",
  };

  let ssoHosts = cfg.ssoHosts;
  if (process.env.OPS_SSO_HOSTS) {
    ssoHosts = process.env.OPS_SSO_HOSTS.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (!Array.isArray(ssoHosts)) ssoHosts = [];

  // SSO env: prefer generic names, fall back to legacy LAKESIDE_AUTH_* aliases
  const sso = {
    baseUrl: process.env.SSO_BASE_URL || process.env.LAKESIDE_AUTH_BASE_URL || "",
    internalToken: process.env.SSO_INTERNAL_TOKEN || process.env.LAKESIDE_AUTH_INTERNAL_TOKEN || "",
    ahdOrigin: process.env.SSO_AHD_ORIGIN || process.env.LAKESIDE_AUTH_AHD_ORIGIN || "",
  };

  return {
    ...cfg,
    tenant,
    primaryProject,
    features,
    paths,
    ssoHosts,
    sso,
    mongodb: {
      uri: process.env.MONGODB_URI || "",
      dbName: process.env.MONGODB_DB_NAME || cfg.mongodb?.dbName || "",
      directConnection: parseBool(process.env.MONGODB_DIRECT_CONNECTION, true),
    },
    publicBase: (process.env.PUBLIC_BASE || cfg.publicBase || "").replace(/\/+$/, ""),
    port: parseInt(process.env.PORT || String(cfg.port || 9724), 10),
  };
}

function loadRawFiles(configPath = DEFAULT_CONFIG_PATH) {
  let base = readYamlFile(configPath);
  if (!base) {
    base = readYamlFile(EXAMPLE_CONFIG_PATH) || {
      tenant: { name: "Ops", shortName: "Ops", dashboardTitle: "Ops Dashboard" },
      projects: [],
      features: { ...DEFAULT_FEATURES },
    };
  }
  const local = readYamlFile(LOCAL_CONFIG_PATH);
  return local ? deepMerge(base, local) : base;
}

/**
 * @param {{ configPath?: string, force?: boolean }} [opts]
 */
function loadConfig(opts = {}) {
  if (_cache && !opts.force && !opts.configPath) return _cache;

  const raw = loadRawFiles(opts.configPath || DEFAULT_CONFIG_PATH);
  const merged = applyEnvOverrides(raw);
  const errors = validateConfig(merged);
  if (errors.length) {
    const err = new Error(`Invalid dashboard config:\n  - ${errors.join("\n  - ")}`);
    err.code = "CONFIG_INVALID";
    err.errors = errors;
    throw err;
  }
  _cache = Object.freeze(merged);
  return _cache;
}

function getConfig() {
  return loadConfig();
}

function resetConfigCache() {
  _cache = null;
}

module.exports = {
  loadConfig,
  getConfig,
  resetConfigCache,
  validateConfig,
  FEATURE_ENV_MAP,
  DEFAULT_FEATURES,
  DEFAULT_CONFIG_PATH,
  LOCAL_CONFIG_PATH,
  EXAMPLE_CONFIG_PATH,
  ROOT,
};
