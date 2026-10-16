import { tool } from "@opencode-ai/plugin";
import { loadPolicy } from "./policy.mjs";
import { readCheckpoints, saveCheckpoint } from "./checkpoints.mjs";

export const workflowTools = {
  workflow_status: tool({
    description: "Read enabled work integrations and durable checkpoints for this coding session. Checkpoints are model reports, not verified remote effects. Read on resume or provider change.",
    args: {},
    async execute(_args, context) { return JSON.stringify({ policy: loadPolicy(), checkpoints: readCheckpoints(context.sessionID) }); },
  }),
  workflow_checkpoint: tool({
    description: "Save a provider-independent recovery checkpoint for this session. Record evidence, uncertainty and the next step before compaction or model switching. Never include secrets. This does not update GitHub, kanban or tickets, and does not certify completion.",
    args: { task: tool.schema.string(), state: tool.schema.enum(["active", "blocked", "uncertain", "completed"]), evidence: tool.schema.array(tool.schema.string()), next: tool.schema.string() },
    async execute(args, context) { return JSON.stringify(saveCheckpoint(context.sessionID, args)); },
  }),
};
