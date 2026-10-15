"use strict";

/**
 * Resolved filesystem / binary paths from config + env.
 * No box-specific absolute defaults in callers — use these helpers.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { getConfig, ROOT } = require("../core/config");

function homeDir() {
  return process.env.HOME || os.homedir() || "";
}

function paths() {
  return getConfig().paths || {};
}

function backupDir() {
  return paths().backupDir || path.join(ROOT, "data", "backups");
}

function projectsRoot() {
  return process.env.PROJECTS_ROOT || paths().projectsRoot || "";
}

function primaryRepoDir() {
  if (process.env.AHD_GAME_REPO) return process.env.AHD_GAME_REPO;
  if (process.env.PRIMARY_REPO_DIR) return process.env.PRIMARY_REPO_DIR;
  const cfg = getConfig();
  const primary = (cfg.projects || []).find((p) => p.key === cfg.primaryProject);
  if (primary?.repoDir) return primary.repoDir;
  if (primary?.integrations?.repoDir) return primary.integrations.repoDir;
  const root = projectsRoot();
  if (root && primary?.key) return path.join(root, primary.key);
  return "";
}

function worktreeBase() {
  if (process.env.CODE_AGENT_WORKTREE_BASE) return process.env.CODE_AGENT_WORKTREE_BASE;
  const repo = primaryRepoDir();
  return repo ? path.join(repo, "worktrees") : path.join(ROOT, "data", "worktrees");
}

function hermesSkillsDir() {
  return process.env.HERMES_SKILLS_DIR || paths().hermesSkillsDir || "";
}

function hermesHomeDir() {
  return process.env.HERMES_HOME_DIR || paths().hermesHomeDir || path.join(homeDir(), ".hermes");
}

function projectSkillsDir() {
  if (process.env.PROJECT_SKILLS_DIR) return process.env.PROJECT_SKILLS_DIR;
  return path.join(ROOT, "ahd-sandbox", ".claude", "skills");
}

function sandboxDir() {
  return paths().sandboxDir || path.join(ROOT, "ahd-sandbox");
}

/** Resolve a binary: env override → config agents.binaries → PATH basename → "". */
function resolveBinary(name, envKey) {
  if (envKey && process.env[envKey]) return process.env[envKey];
  const cfg = getConfig();
  const fromCfg = cfg.agents?.binaries?.[name];
  if (fromCfg) return fromCfg;
  // Common env aliases
  const aliases = {
    claude: "CLAUDE_BIN",
    codex: "CODEX_BIN",
    kimi: "KIMI_BIN",
    cursor: "CURSOR_AGENT_BIN",
    opencode: "OPENCODE_BIN",
    ollama: "OLLAMA_BIN",
    codeburn: "CODEBURN_BIN",
  };
  const alt = aliases[name];
  if (alt && process.env[alt]) return process.env[alt];
  return name; // rely on PATH
}

function agentPathExtras() {
  const cfg = getConfig();
  if (Array.isArray(cfg.agents?.pathExtras) && cfg.agents.pathExtras.length) {
    return cfg.agents.pathExtras;
  }
  const home = homeDir();
  return [
    path.join(home, ".opencode", "bin"),
    path.join(home, ".local", "bin"),
    path.join(hermesHomeDir(), "node", "bin"),
  ].filter((p) => {
    try { return fs.existsSync(p); } catch { return false; }
  });
}

function mcpPublicBase() {
  const cfg = getConfig();
  const fromCfg = cfg.mcp?.publicBase || "";
  return (process.env.MCP_PUBLIC_BASE || process.env.MCP_PUBLIC_URL || fromCfg || "")
    .replace(/\/mcp\/?$/, "")
    .replace(/\/+$/, "");
}

module.exports = {
  ROOT,
  homeDir,
  paths,
  backupDir,
  projectsRoot,
  primaryRepoDir,
  worktreeBase,
  hermesSkillsDir,
  hermesHomeDir,
  projectSkillsDir,
  sandboxDir,
  resolveBinary,
  agentPathExtras,
  mcpPublicBase,
};
