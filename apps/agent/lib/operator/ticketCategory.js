"use strict";
// The ticket bot's intake card names the category: a "Category" field
// ("Moderation Issue") and a title like "🛡️ Moderation Issue — #0042".
// Moderation tickets belong to human moderators; Keir never works them.
// Incident tickets are staff-owned catch-alls that repeat reports merge into.
function ticketCategory(rows, botId) {
  for (const m of rows || []) {
    if (m.author?.id !== botId) continue;
    for (const e of m.embeds || []) {
      const field = (e.fields || []).find((f) => String(f.name).toLowerCase() === "category")?.value;
      const text = String(field || (/#\d+/.test(e.title || "") ? e.title : "") || "").toLowerCase();
      if (!text) continue;
      if (text.includes("moderation")) return "moderation";
      if (text.includes("incident")) return "incident";
      if (text.includes("suggest")) return "suggestion";
      if (text.includes("bug")) return "bug";
      return "mechanics";
    }
  }
  return null;
}
const isModerationChannel = (ledger, channelId) => ledger.data.channels?.[channelId]?.category === "moderation";
const isIncidentChannel = (ledger, channelId) => ledger.data.channels?.[channelId]?.category === "incident";
// Categories Keir never opens automatic ticket work in: humans own them.
const STAFF_OWNED = new Set(["moderation", "incident"]);
module.exports = { ticketCategory, isModerationChannel, isIncidentChannel, STAFF_OWNED };
