// @ts-check
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { locations } from "../config.mjs";

/** @typedef {{version: 1, id: string, session: string, createdAt: string, task: string, state: 'active'|'blocked'|'uncertain'|'completed', evidence: string[], next: string}} Checkpoint */
/** @param {unknown} value @param {number} limit @returns {string} */
function bounded(value, limit) {
  if (typeof value !== "string" || !value.trim() || value.length > limit || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new Error("Invalid checkpoint text");
  return value;
}
/** @param {string} session @param {NodeJS.ProcessEnv} env */
function directory(session, env) {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(session)) throw new Error("Invalid session id");
  return path.join(locations(env).state, "checkpoints", session);
}
/** @param {string} session @param {{task: string, state: Checkpoint['state'], evidence: string[], next: string}} input @param {NodeJS.ProcessEnv} [env] @returns {Checkpoint} */
export function saveCheckpoint(session, input, env = process.env) {
  const dir = directory(session, env);
  if (!["active", "blocked", "uncertain", "completed"].includes(input.state)) throw new Error("Invalid checkpoint state");
  if (!Array.isArray(input.evidence) || input.evidence.length > 30 || input.state === "completed" && !input.evidence.length) throw new Error("Checkpoint evidence must have at most 30 entries; completed work requires evidence");
  const row = { version: /** @type {const} */ (1), id: crypto.randomUUID(), session, createdAt: new Date().toISOString(), task: bounded(input.task, 4000), state: input.state, evidence: input.evidence.map(value => bounded(value, 2000)), next: bounded(input.next, 4000) };
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const destination = path.join(dir, `${row.id}.json`), temp = `${destination}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(row) + "\n", { flag: "wx", mode: 0o600 }); fs.renameSync(temp, destination); }
  finally { fs.rmSync(temp, { force: true }); }
  return row;
}
/** @param {string} session @param {NodeJS.ProcessEnv} [env] @returns {Checkpoint[]} */
export function readCheckpoints(session, env = process.env) {
  const dir = directory(session, env);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(file => /^[0-9a-f-]{36}\.json$/.test(file)).map(file => {
    const row = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    if (row.version !== 1 || row.session !== session || typeof row.task !== "string" || !Array.isArray(row.evidence) || !["active", "blocked", "uncertain", "completed"].includes(row.state) || typeof row.next !== "string" || typeof row.createdAt !== "string") throw new Error("Corrupt workflow checkpoint");
    if (row.id !== file.slice(0, -5) || row.evidence.length > 30 || !Number.isFinite(Date.parse(row.createdAt))) throw new Error("Corrupt workflow checkpoint identity");
    bounded(row.task, 4000); bounded(row.next, 4000);
    row.evidence.forEach((/** @type {unknown} */ item) => bounded(item, 2000));
    return /** @type {Checkpoint} */ (row);
  }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
