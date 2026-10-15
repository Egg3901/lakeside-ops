"use strict";
const policy = require("./ownermuse-policy");
const { ownerText } = require("./privacy");
// One authenticated owner request creates one canonical ticket. The original
// message fixes its reporter; a model cannot name another person or mint consent.
async function openOwnerTicket({ ledger, config, mcp, effect, job, input, signal, now }) {
  const d = ledger.data, origin = policy.origin(d, job);
  if (!origin.valid || origin.actorId !== config.ownerId || !["command", "conversation"].includes(job.kind)) throw new Error("Start a new owner request to create this ticket.");
  if (config.supportDeferred()) throw new Error("Support intake is temporarily held. Retry this task when the hold clears.");
  const receipt = d.ownerMuseOrigins[origin.root];
  const message = d.appThread?.messages?.find(m => m.id === receipt.messageId);
  const original = message && { ...message }; if (original) delete original.jobId;
  if (!message || message.jobId !== origin.root || policy.digest(original) !== receipt.messageDigest || message.role !== "owner") throw new Error("The authenticated ticket request has changed.");
  const text = message.text;
  const requested = /\b(?:open|create|make|file|raise|log|need|want)\b[\s\S]{0,100}\b(?:ticket|incident)\b/i.test(text) && !/\b(?:do not|don't|never|no need to)\s+(?:\w+\s+){0,3}(?:open|create|make|file|raise|log)\b/i.test(text);
  if (!requested) throw new Error("Ask me explicitly to open a ticket or incident before I create one.");
  if (input.channelId || input.reportMessageId || input.discord_user_id) throw new Error("App intake uses your authenticated request and reporter identity.");
  const category = input.category || "bug";
  if (!["bug", "gameplay", "account", "other", "incident"].includes(category) || category === "incident" && !/\bincident\b/i.test(text)) throw new Error("The ticket category must match your request.");
  const title = ownerText(String(input.title || "")).trim(), description = ownerText(String(input.description || "")).trim();
  if (!title || title.length > 200 || !description || description.length > 4000) throw new Error("Give the ticket a short title and a bounded description.");
  const args = { discord_user_id: config.ownerId, category, title, description: `${description}\n\nOwner report from the Keir app:\n${ownerText(text)}`.slice(0,5000), platform: "Keir app" };
  const key = `intake:app:${message.id}`;
  if (!(job.effects || {})[key]) {
    d.intake = (d.intake || []).filter(x => now() - x.at < 3600000);
    if (d.intake.filter(x => x.directed).length >= 15) throw new Error("Ticket intake is busy. Retry later.");
    d.intake.push({ at: now(), source: message.id, directed: true }); ledger.save();
  }
  const result = await effect(job, key, () => mcp.call("support", "support_create_ticket", args, true, signal));
  const number = result.ticketNumber || result.number || result.ticket?.number;
  const channelId = result.channelId || result.channel?.id || result.discordChannelId;
  if (!number || !channelId) throw new Error("Ticket creation needs a verified number and channel. Inspect its receipt before retrying.");
  const opened = { number, channelId, reporterId: config.ownerId, requestMessageId: message.id, originDigest: origin.digest };
  (job.openedTickets ||= {})[message.id] = opened; ledger.save();
  return opened;
}
module.exports = { openOwnerTicket };
