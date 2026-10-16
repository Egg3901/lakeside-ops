// @ts-check
import fs from "node:fs/promises";
import path from "node:path";
/** @param {string} file @param {string} directory @param {boolean} write */
async function scoped(file, directory, write) {
  if (!path.isAbsolute(file)) throw new Error("ACP file paths must be absolute");
  const root = await fs.realpath(directory);
  let canonical;
  try { canonical = await fs.realpath(file); }
  catch (error) {
    if (!write || /** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT") throw error;
    canonical = path.join(await fs.realpath(path.dirname(file)), path.basename(file));
  }
  const relative = path.relative(root, canonical);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) throw new Error("ACP filesystem access outside the selected project is not supported");
  return canonical;
}
/** @param {import('@agentclientprotocol/sdk').ReadTextFileRequest} input @param {string} directory @param {string[]} [libraries] */
export async function readProjectFile(input, directory, libraries = []) {
  let file;
  try { file = await scoped(input.path, directory, false); }
  catch (error) {
    for (const library of libraries) { try { file = await scoped(input.path, library, false); break; } catch {} }
    if (!file) throw error;
  }
  if ((await fs.stat(file)).size > 2 * 1024 * 1024) throw new Error("File exceeds the 2 MiB text read limit");
  const text = await fs.readFile(file, "utf8");
  const start = Math.max(0, (input.line || 1) - 1);
  return { content: input.line || input.limit ? text.split("\n").slice(start, input.limit ? start + input.limit : undefined).join("\n") : text };
}
/** @param {import('@agentclientprotocol/sdk').WriteTextFileRequest} input @param {string} directory @param {string[]} [projects] */
export async function writeProjectFile(input, directory, projects = []) {
  if (Buffer.byteLength(input.content) > 2 * 1024 * 1024) throw new Error("File exceeds the 2 MiB text write limit");
  let file;
  try { file = await scoped(input.path, directory, true); }
  catch (error) {
    for (const project of projects) { try { file = await scoped(input.path, project, true); break; } catch {} }
    if (!file) throw error;
  }
  await fs.writeFile(file, input.content);
  return {};
}
