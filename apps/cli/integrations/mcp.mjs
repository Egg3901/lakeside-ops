// @ts-check
import { loadVps } from "../vps-profile.mjs";
import fs from "node:fs";
import path from "node:path";
import { locations } from "../config.mjs";

/** @typedef {{id: string, url: string, tokenEnv?: string, auth?: "cookie"|"bearer", cookieName?: string}} Connection */
/** @param {unknown} value @returns {Connection} */
function validate(value) {
  if (!value || typeof value !== "object") throw new Error("Invalid MCP connection");
  const row = /** @type {Record<string, unknown>} */ (value);
  if (typeof row.id !== "string" || !/^[a-z][a-z0-9-]{0,39}$/.test(row.id) || typeof row.url !== "string") throw new Error("MCP needs a lowercase id and URL");
  const url = new URL(row.url);
  if (url.username || url.password || url.search || url.hash || !(url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("MCP URL must use HTTPS or loopback HTTP without credentials, query or fragment");
  if (row.tokenEnv !== undefined && (typeof row.tokenEnv !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(row.tokenEnv))) throw new Error("tokenEnv must name an environment variable");
  return { id: row.id, url: url.href, ...(typeof row.tokenEnv === "string" ? { tokenEnv: row.tokenEnv } : {}) };
}
/** @param {NodeJS.ProcessEnv} [env] @returns {Connection[]} */
export function loadConnections(env = process.env) {
  const file = path.join(locations(env).config, "mcp.json");
  const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
  if (!Array.isArray(data)) throw new Error("MCP connections must be an array");
  const rows = data.map(validate);
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("Duplicate MCP connection id");
  const vps = loadVps(env);
  if (vps) {
    if (rows.some(row => row.id === vps.id)) throw Error(`MCP connection ${vps.id} conflicts with the configured remote profile`);
    rows.push({ id: vps.id, url: vps.kind === "keir" ? vps.origin + "/api/keir/app/desktop/mcp" : vps.origin, tokenEnv: "LAKESIDE_VPS_TOKEN", auth: vps.auth, cookieName: vps.cookieName });
  }
  return rows;
}
/** @param {unknown} input @param {NodeJS.ProcessEnv} [env] */
export function addConnection(input, env = process.env) {
  const row = validate(input), rows = loadConnections(env);
  if (rows.some(value => value.id === row.id)) throw new Error("MCP already configured; edit private mcp.json to change its target");
  const file = path.join(locations(env).config, "mcp.json"), temp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try { fs.writeFileSync(temp, JSON.stringify([...rows.filter(value => value.id !== loadVps(env)?.id), row], null, 2) + "\n", { mode: 0o600 }); fs.renameSync(temp, file); }
  finally { fs.rmSync(temp, { force: true }); }
  return row;
}
/** @param {NodeJS.ProcessEnv} [env] */
export function engineConnections(env = process.env) {
  return Object.fromEntries(loadConnections(env).map(row => {
    // Resolve the reference inside OpenCode, never persist credential values.
    // Missing credentials disable that connection rather than sending an empty bearer.
    const available = !row.tokenEnv || Boolean(env[row.tokenEnv]);
    return [row.id, { type: "remote", url: row.url, enabled: available, ...(row.tokenEnv ? { oauth: false, headers: row.auth === "cookie" ? { Cookie: `${row.cookieName || "ops_session"}={env:${row.tokenEnv}}` } : { Authorization: `Bearer {env:${row.tokenEnv}}` } } : {}) }];
  }));
}
