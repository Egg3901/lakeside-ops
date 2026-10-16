import { tool } from "@opencode-ai/plugin";
import { loadPeers, inspectPeer, peerTask, handoff } from "./peers.mjs";

export const Coordination = async () => ({
  tool: {
    agent_status: tool({
      description: "Inspect explicitly configured PC/VPS agents and their actual tasks. Offline peers do not prevent local coding. This does not discover arbitrary terminal processes.",
      args: {},
      async execute(_args, context) {
        return JSON.stringify(await Promise.all(loadPeers().map(peer => inspectPeer(peer, { signal: context.abort }))));
      },
    }),
    agent_handoff: tool({
      description: "Hand a bounded coding/review task to a configured Keir peer with submission enabled. Receipt means accepted, not completed. An uncertain receipt requires reconciliation; do not automatically retry. Never send credentials or unrelated private context.",
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
  },
  "experimental.chat.system.transform": async (_input, output) => {
    output.system.push("You are Lakeside Code, the local coding agent. Inspect, edit, run focused checks and review real diffs. Follow repository instructions and preserve unrelated work. Coordinate through agent_status, agent_handoff and agent_result only when useful or requested. Local paths and remote paths are not interchangeable. A handoff receipt is not task completion. Never claim a check, review, merge or deployment succeeded without evidence. Keir is a separate remote agent.");
  },
});

export default { id: "lakeside.code.coordination", server: Coordination };
