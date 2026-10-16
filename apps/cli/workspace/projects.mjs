// @ts-check
import fs from "node:fs";
import path from "node:path";
import { locations } from "../config.mjs";

/** @param {NodeJS.ProcessEnv} [env] @returns {Record<string, string>} */
export function loadProjects(env = process.env) {
  const file = path.join(locations(env).config, "projects.json");
  if (!fs.existsSync(file)) return {};
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid project registry");
  for (const [name, directory] of Object.entries(data)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,59}$/.test(name) || typeof directory !== "string" || !path.isAbsolute(directory)) throw new Error("Project aliases need names and absolute local paths");
  }
  return data;
}
/** @param {string} name @param {string} directory @param {NodeJS.ProcessEnv} [env] */
export function addProject(name, directory, env = process.env) {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,59}$/.test(name) || ["backends", "runs", "run", "serve", "attach", "auth", "models", "mcp", "workflow", "projects", "skills", "doctor", "peers", "handoffs", "help", "version", "session", "upgrade", "uninstall", "web", "stats", "export", "import", "debug", "github", "pr", "agent", "generate", "completion", "acp", "db"].includes(name)) throw new Error("Choose a project name that is not a CLI command");
  const absolute = fs.realpathSync(path.resolve(directory));
  if (!fs.statSync(absolute).isDirectory()) throw new Error("Project must be a local directory");
  const projects = loadProjects(env);
  if (Object.hasOwn(projects, name)) throw new Error("Project already registered; edit private projects.json to change its path");
  const file = path.join(locations(env).config, "projects.json"), temp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try { fs.writeFileSync(temp, JSON.stringify({ ...projects, [name]: absolute }, null, 2) + "\n", { mode: 0o600 }); fs.renameSync(temp, file); }
  finally { fs.rmSync(temp, { force: true }); }
  return { name, directory: absolute };
}
/** @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
export function resolveProject(args, env = process.env) {
  if (!args.length || args[0].startsWith("-")) return args;
  const projects = loadProjects(env);
  if (!Object.hasOwn(projects, args[0])) return args;
  const directory = projects[args[0]];
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) throw new Error(`Registered project ${args[0]} is unavailable at ${directory}`);
  return [directory, ...args.slice(1)];
}
