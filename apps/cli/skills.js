"use strict";
const fs = require("node:fs");
const path = require("node:path");

function skillRoot() {
  const bundled = path.join(__dirname, "skills");
  return fs.existsSync(path.join(bundled, "manifest.json")) ? bundled : path.join(__dirname, "../agent/skills");
}
function manifest() {
  const canonical = JSON.parse(fs.readFileSync(path.join(skillRoot(), "manifest.json"), "utf8"));
  const local = JSON.parse(fs.readFileSync(path.join(__dirname, "design-skills", "manifest.json"), "utf8"));
  return { ...canonical, skills: { ...canonical.skills, ...local.skills } };
}
function readSkill(name) {
  if (!Object.hasOwn(manifest().skills, name)) throw new Error(`Unknown built-in skill ${name}`);
  const root = manifest().skills[name].source === "Lakeside Games" ? path.join(__dirname, "design-skills") : path.join(skillRoot(), "vendor");
  return fs.readFileSync(path.join(root, name, "SKILL.md"), "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
}
function listSkills(env = process.env) {
  return Object.entries(manifest().skills).map(([name, info]) => {
    readSkill(name); // Missing packaged assets must fail doctor, not silently disable workflows.
    return { name, source: info.source, revision: info.sha || info.revision, license: info.license, default: defaultSkills(env).includes(name) };
  });
}
function skillCommands() {
  return Object.fromEntries(listSkills().map(({ name }) => [name, {
    description: `Use the built-in ${name} workflow`,
    template: `Load the ${name} skill using the skill tool and follow it for this task. For Ponytail, full is the default; honor lite, full, ultra or stop when requested. User arguments: $ARGUMENTS`,
  }]));
}
function defaultSkills(env = process.env) {
  const file = path.join(require("./config.mjs").locations(env).config, "skill-defaults.json");
  const names = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : ["ponytail", "verification-before-completion"];
  if (!Array.isArray(names) || names.some(name => typeof name !== "string" || !Object.hasOwn(manifest().skills, name))) throw Error("Skill defaults must be an array of installed built-in skill names");
  return [...new Set(names)];
}
function configureDefaultSkills(names, env = process.env) {
  if (!Array.isArray(names) || names.some(name => typeof name !== "string" || !Object.hasOwn(manifest().skills, name))) throw Error("Choose installed built-in skill names");
  const file = path.join(require("./config.mjs").locations(env).config, "skill-defaults.json");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + ".tmp";
  try { fs.writeFileSync(temp, JSON.stringify([...new Set(names)]) + "\n", { mode: 0o600 }); fs.renameSync(temp, file); }
  finally { fs.rmSync(temp, { force: true }); }
  return defaultSkills(env);
}
function defaultInstructions(env = process.env) {
  const defaults = defaultSkills(env);
  if (!defaults.length) return "No built-in skill is enabled by default. Load skills when requested or relevant; owner and repository instructions take precedence. Other installed and configured skills remain available.";
  if (defaults.join(",") !== "ponytail,verification-before-completion") return `Configured default skills: ${defaults.join(", ")}. Follow these when applicable, honoring owner and repository instructions first. Other installed skills remain available on demand.\n\n${defaults.map(readSkill).join("\n\n")}`;
  return `Built-in coding workflows: Ponytail full and verification-before-completion are active by default. Honor the owner's request to change Ponytail level or stop it. Use the native skill tool for systematic-debugging on bugs, test-driven-development when test-first work is requested or appropriate, ponytail-review for reviews, and frontend-design for UI work. For substantial interface work, load design-system, ux-design and accessible-design as relevant; use terminal-design for terminal interfaces and design-review to inspect the rendered result. The superpowers: prefix in upstream instructions refers to these same unprefixed built-in skill names. Repository and owner instructions take precedence over skill defaults; use project tools and check scheduling rather than assuming Keir's studio infrastructure. Preserve the project's visual language and the owner's design direction.\n\n${readSkill("ponytail")}\n\n${readSkill("verification-before-completion")}`;
}
module.exports = { skillRoot, readSkill, listSkills, skillCommands, defaultInstructions, defaultSkills, configureDefaultSkills };
