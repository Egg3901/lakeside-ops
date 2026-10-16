// @ts-check
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { locations } from "../config.mjs";
import { loadProjects, localProjectPath } from "./projects.mjs";

/** @typedef {{directory: string, name: string}} Project */
/** @param {string} session @param {NodeJS.ProcessEnv} env */
function stateFile(session, env) {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(session)) throw new Error("Invalid workspace session id");
  return path.join(locations(env).state, "workspaces", `${session}.json`);
}
/** @param {string} session @param {NodeJS.ProcessEnv} [env] @returns {Project[]} */
export function loadedProjects(session, env = process.env) {
  const file = stateFile(session, env);
  if (!fs.existsSync(file)) return [];
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(rows) || rows.length > 8 || rows.some(row => !row || typeof row.name !== "string" || typeof row.directory !== "string" || !path.isAbsolute(row.directory))) throw new Error("Invalid session workspace");
  return rows;
}
/** @param {string} target @param {NodeJS.ProcessEnv} env @param {string} [base] */
export function projectDirectory(target, env, base = process.cwd()) {
  if (!target.trim() || /[\x00-\x1f]/.test(target)) throw new Error("Project needs a local name or path");
  const registry = loadProjects(env);
  const directory = fs.realpathSync(path.resolve(base, registry[target] || localProjectPath(target, env)));
  if (!fs.statSync(directory).isDirectory()) throw new Error("Project must be an existing local directory");
  return directory;
}
/** @param {string} session @param {Project[]} rows @param {NodeJS.ProcessEnv} env */
function save(session, rows, env) {
  const file = stateFile(session, env), temp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try { fs.writeFileSync(temp, JSON.stringify(rows) + "\n", { mode: 0o600 }); fs.renameSync(temp, file); }
  finally { fs.rmSync(temp, { force: true }); }
}
/** @param {string} file @param {number} limit */
function excerpt(file, limit) {
  const fd = fs.openSync(file, "r");
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error("Context must be a regular file");
    const buffer = Buffer.alloc(limit + 1), bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return { file, text: buffer.subarray(0, Math.min(bytes, limit)).toString("utf8"), truncated: bytes > limit };
  } finally { fs.closeSync(fd); }
}
/** Refresh scoped instructions rather than caching stale repository rules.
 * @param {Project} project */
export function projectContext(project) {
  const directory = fs.realpathSync(project.directory);
  if (directory !== project.directory) throw new Error("Loaded project path changed; unload and load it again");
  const ancestors = [];
  for (let current = directory; ; current = path.dirname(current)) { ancestors.unshift(current); if (path.dirname(current) === current) break; }
  const instructions = ancestors.map(parent => path.join(parent, "AGENTS.md")).filter(file => fs.existsSync(file)).map(file => excerpt(file, 16000));
  let repository = null;
  try { repository = execFileSync("git", ["-C", directory, "rev-parse", "--show-toplevel"], { encoding: "utf8", timeout: 3000, maxBuffer: 16384, stdio: ["ignore", "pipe", "pipe"] }).trim(); } catch { /* Plain folders are supported. */ }
  return { ...project, repository, instructions };
}
/** @param {string} session @param {string} target @param {NodeJS.ProcessEnv} [env] @param {string} [base] */
export function loadProject(session, target, env = process.env, base = process.cwd()) {
  const directory = projectDirectory(target, env, base), rows = loadedProjects(session, env);
  const project = rows.find(row => row.directory === directory) || { directory, name: Object.hasOwn(loadProjects(env), target) ? target : path.basename(directory) || directory };
  const context = projectContext(project);
  if (!rows.some(row => row.directory === directory)) {
    if (rows.length >= 8) throw new Error("Eight projects are loaded; unload one before adding another");
    save(session, [...rows, project], env);
  }
  return context;
}
/** @param {string} session @param {string} target @param {NodeJS.ProcessEnv} [env] @param {string} [base] */
export function unloadProject(session, target, env = process.env, base = process.cwd()) {
  const rows = loadedProjects(session, env);
  let matches = rows.filter(row => row.name === target || row.directory === target);
  if (!matches.length) {
    try { const directory = projectDirectory(target, env, base); matches = rows.filter(row => row.directory === directory); } catch { /* Removed checkouts can still be unloaded by stored name/path. */ }
  }
  if (matches.length !== 1) throw new Error("Choose one loaded project by its exact path or unique name");
  save(session, rows.filter(row => row !== matches[0]), env);
  return { unloaded: matches[0] };
}
/** @param {string} session @param {NodeJS.ProcessEnv} [env] */
export function workspaceStatus(session, env = process.env) {
  return { available: loadProjects(env), loaded: loadedProjects(session, env) };
}
/** @param {string} session @param {NodeJS.ProcessEnv} [env] */
export function workspaceInstructions(session, env = process.env) {
  const status = workspaceStatus(session, env);
  const contexts = status.loaded.map(project => {
    try { return projectContext(project); }
    catch (error) { return { ...project, unavailable: error instanceof Error ? error.message : "Project unavailable" }; }
  });
  return `This session may start in a home/root folder with no selected repository. Load project context only as the task needs it; multiple projects can remain loaded. Use project_list, project_load and project_unload when available, or the terminal's /project load and /project unload commands. Registered project directories: ${JSON.stringify(status.available)}\nLoaded project contexts: ${JSON.stringify(contexts)}\nKeep instructions scoped to their project paths; ancestor AGENTS.md applies below its directory. Read any truncated instruction file in full and discover deeper instructions before editing there. Use absolute file paths and an explicit project working directory for each shell/check/Git operation. Never assume changing project context changes process.cwd(), grants provider permissions or authorizes commits, remote actions or deployments. Do not treat the home folder as one Git repository or recursively scan all projects. Unavailable projects must be reloaded before use.`;
}
