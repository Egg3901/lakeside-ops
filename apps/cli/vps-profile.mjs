// @ts-check
import fs from "node:fs";
import path from "node:path";
import { locations } from "./config.mjs";
/** @typedef {{id: string, origin: string, tokenFile: string, kind: "keir"|"mcp", auth: "cookie"|"bearer", name: string, cookieName: string, instructions: string}} VpsProfile */
/** @param {NodeJS.ProcessEnv} [env] @returns {VpsProfile | undefined} */
export function loadVps(env = process.env) {
  const file = path.join(locations(env).config, "vps.json");
  if (!fs.existsSync(file)) return;
  const row = JSON.parse(fs.readFileSync(file, "utf8"));
  const url = new URL(row.origin);
  const kind = row.kind || "keir", auth = row.auth || (kind === "keir" ? "cookie" : "bearer"), cookieName = row.cookieName || "ops_session";
  if (!["keir", "mcp"].includes(kind) || !["cookie", "bearer"].includes(auth) || !/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(cookieName)) throw Error("Invalid VPS adapter or authentication");
  if (url.username || url.password || url.search || url.hash || (kind === "keir" && url.pathname !== "/") || !(url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) || typeof row.tokenFile !== "string" || !path.isAbsolute(row.tokenFile)) throw Error("Invalid VPS profile");
  if (row.instructions !== undefined && (typeof row.instructions !== "string" || row.instructions.length > 8000)) throw Error("VPS instructions must be at most8000 characters");
  const id = row.id || (kind === "keir" ? "keir-vps" : "remote-workspace");
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(id)) throw Error("Invalid remote connection id");
  return { id, origin: kind === "keir" ? url.origin : url.href, tokenFile: row.tokenFile, kind, auth, cookieName, name: String(row.name || (kind === "keir" ? "Keir VPS" : "Remote MCP")).replace(/[\x00-\x1f]/g, "").slice(0,60), instructions: row.instructions || "" };
}
/** @param {string} file */
export function readVpsToken(file) {
  let token;
  try { const stat = fs.statSync(file); if (!stat.isFile() || stat.size > 8192) throw Error(); token = fs.readFileSync(file, "utf8").trim(); }
  catch { throw Error("VPS token file is unavailable; supply a current credential file and reconnect"); }
  if (!token || token.length > 8000 || !/^[\x21-\x7e]+$/.test(token)) throw Error("VPS token file must contain one raw credential without whitespace or header names");
  return token;
}
/** @param {string} origin @param {string} tokenFile @param {NodeJS.ProcessEnv} [env] @param {Partial<VpsProfile>} [options] */
export function connectVps(origin, tokenFile, env = process.env, options = {}) {
  const directory = locations(env).config;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, "vps.json"), temp = file + ".tmp";
  const row = { ...options, origin, tokenFile: fs.realpathSync(path.resolve(tokenFile)) };
  readVpsToken(row.tokenFile);
  if (options.id && !/^[a-z][a-z0-9-]{0,39}$/.test(options.id)) throw Error("Invalid remote connection id");
  if (options.instructions !== undefined && (typeof options.instructions !== "string" || options.instructions.length > 8000)) throw Error("Remote instructions exceed8000 characters");
  const kind = options.kind || "keir", auth = options.auth || (kind === "keir" ? "cookie" : "bearer");
  if (!["keir", "mcp"].includes(kind) || !["cookie", "bearer"].includes(auth) || options.cookieName && !/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(options.cookieName)) throw Error("Invalid adapter or authentication");
  // Preserve a working profile until the replacement is valid.
  const url = new URL(origin);
  if (url.username || url.password || url.search || url.hash || (kind === "keir" && url.pathname !== "/") || !(url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw Error("VPS needs an HTTPS origin or loopback HTTP");
  row.origin = kind === "keir" ? url.origin : url.href;
  try { fs.writeFileSync(temp, JSON.stringify(row) + "\n", { mode: 0o600 }); fs.renameSync(temp, file); }
  finally { fs.rmSync(temp, { force: true }); }
  return { configured: true, ...row, credential: "file reference only" };
}
/** @param {NodeJS.ProcessEnv} [env] */
export function withVpsCredential(env = process.env) {
  const profile = loadVps(env);
  if (!profile) return env;
  try { return { ...env, LAKESIDE_VPS_TOKEN: readVpsToken(profile.tokenFile) }; }
  catch { return { ...env, LAKESIDE_VPS_TOKEN: "" }; }
}
/** @param {NodeJS.ProcessEnv} [env] */
export function vpsInstructions(env = process.env) {
  const profile = loadVps(env);
  if (profile?.kind === "mcp") return `Remote MCP ${profile.name} configured at ${profile.origin}. Inspect its actual connection and available tools before claiming access. Use remote tools for remote state; remote filesystem paths are not local paths. Keep credentials in the configured token file and never print or copy them into the conversation. ${profile.instructions}`;
  return profile ? `Keir VPS configured at ${profile.origin}. Verify connectivity using the ${profile.id} MCP vps_status before claiming access. Use vps_tools to discover available remote schemas. Read shared instructions and skills through vps_read(server="ops-knowledge", tool="knowledge_bootstrap"), knowledge_query and knowledge_get(collection="skills"). For Sentry tasks, call vps_sentry before asking for local SENTRY variables. vps_environment inspects registered remote .env keys with values redacted. Use vps_coordinate and worktree_fleet_status to coordinate work with other agents; use the configured Keir peer for bounded handoffs. Remote paths belong to the VPS. Do not read or print the local VPS token file. Production actions retain their approval path. ${profile.instructions}` : "Lakeside VPS is not configured. Local coding still works. Do not claim VPS access. Setup: lakeside code vps connect --url HTTPS_ORIGIN --token-file LOCAL_FILE. /vps shows connection guidance.";
}
