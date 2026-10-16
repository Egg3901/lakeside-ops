// @ts-check
import lockfile from "proper-lockfile";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { locations } from "../config.mjs";
/** @typedef {import('./contracts.js').NativeRun} NativeRun */
/** @param {string} id @param {NodeJS.ProcessEnv} env */
function filename(id, env) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid native run id");
  return path.join(locations(env).state, "native-runs", `${id}.json`);
}
/** @param {string} backend @param {string} directory @returns {NativeRun} */
export function newRun(backend, directory) {
  const now = new Date().toISOString();
  return { version: 1, id: crypto.randomUUID(), backend, directory, state: "starting", createdAt: now, updatedAt: now, entries: [] };
}
/** @param {NativeRun} row @param {NodeJS.ProcessEnv} [env] */
export function saveRun(row, env = process.env) {
  const file = filename(row.id, env), temp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  row.updatedAt = new Date().toISOString();
  try { fs.writeFileSync(temp, JSON.stringify(row) + "\n", { mode: 0o600, flag: "wx" }); fs.renameSync(temp, file); }
  finally { fs.rmSync(temp, { force: true }); }
}
/** @param {string} id @param {NodeJS.ProcessEnv} [env] @returns {NativeRun} */
export function readRun(id, env = process.env) {
  const row = JSON.parse(fs.readFileSync(filename(id, env), "utf8"));
  if (row.version !== 1 || row.id !== id || typeof row.backend !== "string" || typeof row.directory !== "string" || !path.isAbsolute(row.directory) || !["starting", "idle", "running", "permission", "completed", "cancelled", "failed", "uncertain"].includes(row.state) || !Array.isArray(row.entries) || row.entries.some((/** @type {Record<string, unknown>} */ entry) => !entry || typeof entry.id !== "string" || typeof entry.text !== "string" || !["user", "assistant", "tool", "notice"].includes(/** @type {string} */ (entry.role)))) throw new Error("Invalid native run record");
  return row;
}
/** @param {NodeJS.ProcessEnv} [env] */
export function listRuns(env = process.env) {
  const dir = path.join(locations(env).state, "native-runs");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(file => /^[0-9a-f-]{36}\.json$/.test(file)).map(file => readRun(file.slice(0, -5), env)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** @param {string} id @param {NodeJS.ProcessEnv} [env] */
export function claimRun(id, env = process.env) {
  const file = filename(id, env);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try { return lockfile.lockSync(file, { realpath: false, stale: 10000, update: 5000, retries: 0 }); }
  catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ELOCKED") throw new Error("This native run is already owned by another process. No second agent was started.");
    throw error;
  }
}
