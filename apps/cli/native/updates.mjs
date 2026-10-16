// @ts-check
import crypto from "node:crypto";
/** @param {import('./contracts.js').NativeRun} run @param {import('@agentclientprotocol/sdk').SessionNotification} event */
export function applyUpdate(run, event) {
  const update = event.update;
  if (update.sessionUpdate === "agent_message_chunk" || update.sessionUpdate === "user_message_chunk") {
    if (update.content.type !== "text") return;
    const role = update.sessionUpdate === "agent_message_chunk" ? "assistant" : "user";
    const last = run.entries.at(-1);
    if (last?.role === role) last.text += update.content.text;
    else run.entries.push({ id: crypto.randomUUID(), role, text: update.content.text });
  } else if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
    let row = run.entries.find(entry => entry.id === update.toolCallId);
    if (!row) { row = { id: update.toolCallId, role: "tool", text: update.title || "Tool operation" }; run.entries.push(row); }
    if (update.status) row.status = update.status;
    const text = update.content?.map(content => content.type === "content" && content.content.type === "text" ? content.content.text : content.type === "diff" ? `Changed ${content.path}` : "").filter(Boolean).join("\n");
    if (text) row.text = `${update.title || row.text.split("\n")[0]}\n${text.slice(-20000)}`;
  } else if (update.sessionUpdate === "plan") {
    const text = update.entries.map(entry => `${entry.status}: ${entry.content}`).join("\n");
    const prior = run.entries.find(entry => entry.id === "plan");
    if (prior) prior.text = text;
    else run.entries.push({ id: "plan", role: "notice", text });
  }
  // Private reasoning is deliberately absent from the portable task record.
}
