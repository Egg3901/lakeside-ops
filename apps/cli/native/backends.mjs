// @ts-check
import fs from "node:fs";
import path from "node:path";
import { locations } from "../config.mjs";
/** @typedef {{id: string, command: string, args: string[]}} Backend */
/** @type {Backend[]} */
const builtins = [
  { id: "claude", command: "claude-agent-acp", args: [] },
  { id: "codex", command: "codex-acp", args: [] },
  { id: "gemini", command: "gemini", args: ["--acp"] },
];
/** @param {unknown} value @returns {Backend} */
function validate(value) {
  if (!value || typeof value !== "object") throw new Error("Invalid native backend");
  const row = /** @type {Record<string, unknown>} */ (value);
  if (typeof row.id !== "string" || !/^[a-z][a-z0-9-]{0,39}$/.test(row.id) || row.id === "api" || typeof row.command !== "string" || !row.command.trim() || /[\x00-\x1f]/.test(row.command) || !Array.isArray(row.args) || row.args.some(arg => typeof arg !== "string" || /[\x00-\x1f]/.test(arg))) throw new Error("Backend needs a lowercase id, executable and string arguments; shell command strings are not supported");
  return { id: row.id, command: row.command, args: row.args };
}
/** @param {NodeJS.ProcessEnv} [env] @returns {Backend[]} */
export function loadBackends(env = process.env) {
  const file = path.join(locations(env).config, "backends.json");
  if (!fs.existsSync(file)) return builtins;
  const values = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(values)) throw new Error("Backend configuration must be an array");
  const custom = values.map(validate);
  if (new Set(custom.map(row => row.id)).size !== custom.length) throw new Error("Duplicate backend ids");
  return [...builtins.filter(row => !custom.some(value => value.id === row.id)), ...custom];
}
/** @param {Backend} row @param {NodeJS.ProcessEnv} [env] */
export function saveBackend(row, env = process.env) {
  const backend = validate(row);
  const rows = loadBackends(env).filter(value => value.id !== backend.id);
  const file = path.join(locations(env).config, "backends.json"), temp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try { fs.writeFileSync(temp, JSON.stringify([...rows, backend], null, 2) + "\n", { mode: 0o600 }); fs.renameSync(temp, file); }
  finally { fs.rmSync(temp, { force: true }); }
  return backend;
}
