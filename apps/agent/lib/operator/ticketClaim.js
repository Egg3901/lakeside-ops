"use strict";
// Discord interaction replies from the application carry webhook_id = botId.
// Trust only our bot's canonical claim text, never arbitrary webhook content.
function ticketClaim(message, config, releasedAt = 0) {
  if (message.author?.id !== config.botId || !message.author.bot || (message.webhook_id && message.webhook_id !== config.botId)) return null;
  const at = Date.parse(message.timestamp || "");
  if (releasedAt && Number.isFinite(at) && at <= releasedAt) return null;
  const id = /<@!?(\d+)> has claimed this ticket/.exec(message.content || "")?.[1];
  return id === config.ownerId || config.staffIds.includes(id) ? id : null;
}
module.exports = { ticketClaim };
