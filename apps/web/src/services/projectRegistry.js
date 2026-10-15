"use strict";

/**
 * Project registry — thin helpers over loadConfig().projects.
 */

const { getConfig } = require("../core/config");

let hubCache = { path: null, at: 0, products: null };

function hubProducts() {
  const cfg = getConfig();
  // portfolio.dbPath: the ops kanban database (kanban-store.js exposes a
  // `products` view). hubDbPath is the retired Lakeside Hub file, still read
  // when dbPath is unset.
  const dbPath = cfg.portfolio && (cfg.portfolio.dbPath || cfg.portfolio.hubDbPath);
  if (!dbPath) return null;
  const now = Date.now();
  if (hubCache.path === dbPath && hubCache.products && now - hubCache.at < 30_000) return hubCache.products;
  try {
    const Database = require("better-sqlite3");
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const rows = db.prepare("SELECT slug, name, mode, health, product_url AS productUrl FROM products WHERE archived = 0").all();
    db.close();
    hubCache = { path: dbPath, at: now, products: new Map(rows.map((row) => [row.slug, row])) };
    return hubCache.products;
  } catch {
    return null;
  }
}

function listProjects(filter = {}) {
  const projects = getConfig().projects || [];
  return projects.filter((p) => {
    if (filter.type && p.type !== filter.type) return false;
    if (filter.key && p.key !== filter.key) return false;
    return true;
  });
}

function getProject(key) {
  if (!key) return null;
  return listProjects().find((p) => p.key === key) || null;
}

function getPrimaryProject() {
  const cfg = getConfig();
  return getProject(cfg.primaryProject) || listProjects()[0] || null;
}

function getProjectsByType(type) {
  return listProjects({ type });
}

/** Games portfolio shape used by the legacy games-config consumers. */
function listGames() {
  const products = hubProducts();
  return listProjects({ type: "game" }).map((p) => {
    const hub = products && products.get(p.hubSlug || p.key);
    return ({
    key: p.key,
    name: hub && hub.name || p.name,
    tagline: p.tagline || "",
    publicUrl: p.publicUrl || hub && hub.productUrl || "",
    accent: p.accent || "#888888",
    checks: Array.isArray(p.checks) ? p.checks : [],
    repoUrl: p.repoUrl,
    integrations: p.integrations,
    mode: hub && hub.mode,
    health: hub && hub.health,
  });
  });
}

function listStatusServices() {
  const cfg = getConfig();
  if (Array.isArray(cfg.statusServices) && cfg.statusServices.length) {
    return cfg.statusServices.map((s) => ({
      id: s.id,
      name: s.name,
      url: s.url,
      pageUrl: s.pageUrl || s.url,
      category: s.category || "app",
    }));
  }
  // Fallback: synthesize from project checks (first check per project)
  return listProjects()
    .filter((p) => p.checks && p.checks.length)
    .map((p) => {
      const c = p.checks[0];
      return {
        id: p.key,
        name: p.name,
        url: c.url,
        pageUrl: p.publicUrl || c.url,
        category: p.type === "internal" ? "ops" : "app",
      };
    });
}

function listFinderRoots() {
  const cfg = getConfig();
  if (process.env.FINDER_ROOTS) {
    const raw = process.env.FINDER_ROOTS.trim();
    if (raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.map((r, i) => ({
            id: r.id || `root-${i}`,
            label: r.label || r.path || `Root ${i}`,
            path: r.path,
            kind: r.kind || "home",
          })).filter((r) => r.path);
        }
      } catch { /* fall through to CSV */ }
    }
    return raw.split(",").map((p, i) => {
      const abs = p.trim();
      if (!abs) return null;
      return { id: `root-${i}`, label: abs, path: abs, kind: "home" };
    }).filter(Boolean);
  }
  if (cfg.finder && Array.isArray(cfg.finder.roots)) {
    return cfg.finder.roots.filter((r) => r && r.path);
  }
  return [];
}

function getTenant() {
  return getConfig().tenant;
}

function getSsoHosts() {
  return getConfig().ssoHosts || [];
}

module.exports = {
  listProjects,
  getProject,
  getPrimaryProject,
  getProjectsByType,
  listGames,
  listStatusServices,
  listFinderRoots,
  getTenant,
  getSsoHosts,
};
