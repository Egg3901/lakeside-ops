import { vpsInstructions } from "../vps-profile.mjs";
// @ts-check
import { fileURLToPath } from "node:url";
import skills from "../skills.js";
import { loadPolicy, workflowInstructions } from "../workflow/policy.mjs";
import { readCheckpoints } from "../workflow/checkpoints.mjs";
import { readRun } from "./store.mjs";

/** @param {string | undefined} id @param {NodeJS.ProcessEnv} [env] */
export function carryContext(id, env = process.env) {
  if (!id) return "";
  if (id.startsWith("ses_")) {
    const checkpoint = readCheckpoints(id, env).at(-1);
    if (!checkpoint) throw new Error("Source API session has no durable workflow checkpoint");
    return `Explicit task transfer from an API session (model report, reconcile before acting): ${JSON.stringify(checkpoint)}`;
  }
  const source = readRun(id, env);
  return `Explicit task transfer from ${source.backend}. Prior state: ${source.state}. Reconcile repository and external effects before acting. Visible task history (not private reasoning): ${JSON.stringify(source.entries.slice(-8).map(entry => ({ ...entry, text: entry.text.slice(-2500) })))}`;
}
/** @param {string} carry @param {NodeJS.ProcessEnv} [env] */
export function nativeInstructions(carry, env = process.env) {
  return `You are running inside Lakeside Code through an explicitly selected native backend. Respect owner and repository instructions, the backend's permissions and check scheduling. Never silently switch providers, retry uncertain external writes, or report unverified results. Inspect actual repository state before making changes. Use your own coding tools and available MCP servers. Keir is a separate optional remote agent.
${vpsInstructions(env)}
${workflowInstructions(loadPolicy(env))}
${skills.defaultInstructions(env)}
Built-in skills are readable at ${skills.skillRoot()} and ${fileURLToPath(new URL('../design-skills/', import.meta.url))}. Load relevant design skills for interface work. Honor explicit requests to stop or change skill levels.
${carry}`;
}
