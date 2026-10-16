import { readCheckpoints } from "./workflow/checkpoints.mjs";
import { workflowTools } from "./workflow/tools.mjs";
import { loadPolicy, workflowInstructions } from "./workflow/policy.mjs";
import skills from "./skills.js";
import { tool } from "@opencode-ai/plugin";
import { loadPeers, inspectPeer, peerTask, handoff, listHandoffs, reconcileHandoff, cancelHandoff } from "./peers.mjs";

function receiptPeer(id) {
  const receipt = listHandoffs().find(row => row.id === id);
  if (!receipt) throw new Error("Unknown handoff id");
  const peer = loadPeers().find(peer => peer.id === receipt.peer);
  if (!peer) throw new Error("The original peer is no longer configured");
  return peer;
}

export const Coordination = async () => ({
  tool: {
    ...workflowTools,
    agent_status: tool({
      description: "Inspect explicitly configured PC/VPS agents and their actual tasks. Offline peers do not prevent local coding. This does not discover arbitrary terminal processes.",
      args: {},
      async execute(_args, context) {
        return JSON.stringify(await Promise.all(loadPeers().map(peer => inspectPeer(peer, { signal: context.abort }))));
      },
    }),
    agent_handoff: tool({
      description: "Hand a bounded coding/review task to a configured Keir or OpenCode peer with submission enabled. Receipt means accepted, not completed. An uncertain receipt requires reconciliation; do not automatically retry. Never send credentials or unrelated private context.",
      args: {
        peer: tool.schema.string(), goal: tool.schema.string(), repository: tool.schema.string(),
        branch: tool.schema.string(), base: tool.schema.string(), scope: tool.schema.string(),
        deliverable: tool.schema.string(), thread: tool.schema.string().optional(),
      },
      async execute({ peer: id, ...spec }, context) {
        const peer = loadPeers().find(peer => peer.id === id);
        if (!peer) throw new Error(`Unknown peer ${id}`);
        await context.ask({ permission: "agent_handoff", patterns: [id], always: [id], metadata: { peer: id, goal: spec.goal, repository: spec.repository, branch: spec.branch } });
        return JSON.stringify(await handoff(peer, spec, { signal: context.abort }));
      },
    }),
    agent_result: tool({
      description: "Fetch a known remote task/session and its result, including completed work. Verify state and evidence before reporting completion.",
      args: { peer: tool.schema.string(), task: tool.schema.string() },
      async execute({ peer: id, task }, context) {
        const peer = loadPeers().find(peer => peer.id === id);
        if (!peer) throw new Error(`Unknown peer ${id}`);
        return JSON.stringify(await peerTask(peer, task, { signal: context.abort }));
      },
    }),
    agent_handoffs: tool({
      description: "List durable local handoff receipts, including accepted, uncertain, completed and cancelled work across restarts.",
      args: {},
      async execute() { return JSON.stringify(listHandoffs()); },
    }),
    agent_reconcile: tool({
      description: "Refresh a handoff from its original peer without duplicating work. retry is only for explicitly recovering an uncertain Keir dispatch with the same deduplication key; it can create the originally requested task if dispatch never arrived and requires approval. Never set retry automatically.",
      args: { handoff: tool.schema.string(), retry: tool.schema.boolean().optional() },
      async execute({ handoff: id, retry }, context) {
        const peer = receiptPeer(id);
        if (retry) await context.ask({ permission: "agent_handoff", patterns: [peer.id], always: [peer.id], metadata: { action: "recover original handoff", handoff: id, peer: peer.id } });
        return JSON.stringify(await reconcileHandoff(peer, id, { signal: context.abort, retry }));
      },
    }),
    agent_cancel: tool({
      description: "Cancel only the remote task belonging to a durable local handoff. Confirmation is recorded; lost replies remain cancel-uncertain. Cancellation cannot undo already dispatched effects.",
      args: { handoff: tool.schema.string() },
      async execute({ handoff: id }, context) {
        const peer = receiptPeer(id);
        await context.ask({ permission: "agent_cancel", patterns: [peer.id], always: [peer.id], metadata: { handoff: id, peer: peer.id } });
        return JSON.stringify(await cancelHandoff(peer, id, { signal: context.abort }));
      },
    }),
  },
  "experimental.session.compacting": async (input, output) => {
    const checkpoint = readCheckpoints(input.sessionID).at(-1);
    output.context.push("Preserve the task, owner constraints, enabled work integrations, validated outcomes, unresolved uncertainty and the next action. Never replay an uncertain external write.");
    if (checkpoint) output.context.push(`Durable checkpoint (model report): ${JSON.stringify(checkpoint)}`);
  },
  "experimental.chat.system.transform": async (input, output) => {
    output.system.push(skills.defaultInstructions());
    output.system.push(workflowInstructions(loadPolicy()));
    if (input.sessionID) {
      const checkpoint = readCheckpoints(input.sessionID).at(-1);
      if (checkpoint) output.system.push(`Latest durable recovery checkpoint (model report; reconcile before acting): ${JSON.stringify(checkpoint)}`);
    }
    output.system.push("You are Lakeside Code, the local coding agent. Inspect, edit, run focused checks and review real diffs. Follow repository instructions and preserve unrelated work. Coordinate through the agent tools only when useful or requested. Use agent_handoffs to recover context after restart and agent_reconcile to verify actual outcomes. Never automatically retry uncertain dispatches. Local paths and remote paths are not interchangeable. A handoff receipt is not task completion. Never claim a check, review, merge or deployment succeeded without evidence. Keir is a separate remote agent.");
  },
});

export default { id: "lakeside.code.coordination", server: Coordination };
