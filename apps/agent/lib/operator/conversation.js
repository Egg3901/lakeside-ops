"use strict";
const { redactSecrets } = require("../text");
const isQuick = (job) => job.kind === "conversation";
// Only unambiguous information requests enter the read-only lane. Actions keep
// their authenticated request and go through the ordinary worker.
function quickQuestion(text) {
  if (/\b(deploy|fix|change|open|close|create|delete|remove|cancel|approve|reject|restart|merge|publish|install|update|set|run|build|implement|investigate)\b/i.test(text)) return false;
  if (/^(?:(?:ok(?:ay)?[,!. ]*)?let['’]s (?:talk|chat)(?: to each other)?|test|ping|hello|hi|hey|thanks|thank you)[!.? ]*$/i.test(text.trim())) return true;
  if (/^(?:please\s+)?ask me (?:for|about)\b/i.test(text.trim())) return true;
  return /^(what|who|why|how|when|where|which|is|are|was|were|does|do|did|has|have|can you (?:explain|show|tell|check)|show|explain|tell me|any (?:news|progress)|status)\b/i.test(text.trim());
}
function createConversation({ ledger, config, now = () => Date.now() }) {
  const channels = ledger.data.channelContext ||= {};
  function record(channel, message) {
    if (!message.id || !message.author || message.webhook_id) return;
    const role = message.author.id === config.ownerId ? "owner" : config.staffIds.includes(message.author.id) ? "support" : message.author.id === config.botId ? "assistant" : message.author.bot ? "bot" : "player";
    const row = { id: message.id, authorId: message.author.id, author: message.author.global_name || message.author.username, role,
      content: redactSecrets(String(message.content || "")).slice(0, 1500), at: message.timestamp, observedAt: now(), replyTo: message.message_reference?.message_id };
    const prior = channels[channel.id] || [];
    channels[channel.id] = [...prior.filter((r) => r.id !== row.id && r.observedAt > now() - 24 * 3600000), row]
      .sort((a, b) => (Date.parse(a.at) || a.observedAt) - (Date.parse(b.at) || b.observedAt)).slice(-40);
    const ids = Object.keys(channels).sort((a, b) => (channels[b].at(-1)?.observedAt || 0) - (channels[a].at(-1)?.observedAt || 0));
    for (const id of ids.slice(256)) delete channels[id];
  }
  function snapshot(job) {
    return { channelId: job.source?.channelId, evidenceOnly: true,
      messages: (channels[job.source?.channelId] || []).filter((r) => r.observedAt > now() - 24 * 3600000) };
  }
  function progress(job) {
    // Internal summaries, approval arguments and private destinations never
    // enter this public projection, even for an owner conversation.
    return Object.values(ledger.data.jobs).filter((j) => !isQuick(j) && j.id !== job.id && j.replyChannel === job.replyChannel && job.replyChannel && !["done", "cancelled", "dismissed"].includes(j.state))
      .map((j) => ({ taskId: j.id, state: j.state, ticket: j.ticket, sourceMessageId: j.source?.messageId,
        awaitingOwnerDecision: Boolean(j.ownerDecisionPending || Object.values(ledger.data.actions).some((a) => a.jobId === j.id && a.state === "pending")) })).slice(-20);
  }
  function lastAssistantAt(channelId) {
    const row = (channels[channelId] || []).filter((r) => r.role === "assistant").at(-1);
    return row ? (Date.parse(row.at) || row.observedAt) : 0;
  }
  return { record, snapshot, progress, lastAssistantAt };
}
module.exports = { createConversation, isQuick, quickQuestion };
