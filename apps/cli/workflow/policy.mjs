// @ts-check
import fs from "node:fs";
import path from "node:path";
import { locations } from "../config.mjs";

/** @typedef {'github' | 'kanban' | 'tickets'} Integration */
/** @typedef {{version: 1, enabled: Integration[]}} WorkflowPolicy */
/** @type {readonly Integration[]} */
export const integrations = ["github", "kanban", "tickets"];

/** @param {NodeJS.ProcessEnv} [env] @returns {WorkflowPolicy} */
export function loadPolicy(env = process.env) {
  const file = path.join(locations(env).config, "workflow.json");
  if (!fs.existsSync(file)) return { version: 1, enabled: [] };
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (value.version !== 1 || !Array.isArray(value.enabled) || value.enabled.some((/** @type {Integration} */ id) => !integrations.includes(id))) throw new Error("Invalid workflow policy; expected version 1 and enabled github, kanban or tickets");
  return { version: 1, enabled: [...new Set(/** @type {Integration[]} */ (value.enabled))] };
}

/** @param {string} id @param {boolean} enabled @param {NodeJS.ProcessEnv} [env] */
export function configureIntegration(id, enabled, env = process.env) {
  if (!integrations.includes(/** @type {Integration} */ (id))) throw new Error("Integration must be github, kanban or tickets");
  const policy = loadPolicy(env);
  policy.enabled = policy.enabled.filter(value => value !== id);
  if (enabled) policy.enabled.push(/** @type {Integration} */ (id));
  const file = path.join(locations(env).config, "workflow.json");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(policy, null, 2) + "\n", { mode: 0o600 }); fs.renameSync(temp, file); }
  finally { fs.rmSync(temp, { force: true }); }
  return policy;
}

/** @param {WorkflowPolicy} policy */
export function workflowInstructions(policy) {
  return `Lakeside workflow contract applies across all models and providers.
Enabled work integrations: ${policy.enabled.join(", ") || "none"}. Enablement is workflow consent, not proof of authentication or tool access. Never claim an integration is connected without inspecting its available tools or CLI credentials.
For enabled integrations, link the coding task to the relevant existing issue/card/ticket when known. Read its acceptance criteria, update meaningful progress and blockers, and attach concrete validation evidence on completion. Use available GitHub CLI or configured MCP tools; do not invent endpoints or credentials. Avoid duplicate records. Do not send messages to other people without explicit authorization. Disabled integrations must not be updated automatically. Explicit owner requests still take precedence.
Before a provider change or context compaction, save a workflow_checkpoint containing the task, evidence and next step. On resume, read workflow_status and reconcile actual repository and remote state. A checkpoint is a model report, not verified execution evidence. Never replay a remote write, merge, ticket reply, deployment or handoff because its response was lost. Inspect the original operation and leave the outcome uncertain when it cannot be established. Preserve repository instructions, permissions and task scope when changing models. Report unsupported capabilities instead of silently substituting another provider.`;
}
