"use strict";
/**
 * support_create_ticket: open a support ticket on a player's behalf, the same
 * way the Discord ticket bot does, for reports made outside the ticket flow
 * (a #general message, a DM, a screenshot passed along by staff).
 *
 * 1. Reserves a number from the shared atomic game counter before creating a channel.
 * 2. Creates the ticket channel in the ticket category, copying the role and
 *    bot permission overwrites from the newest existing ticket channel and
 *    granting the reporter the same access the bot grants.
 * 3. Posts the bot's ticket embed with its Claim and Close buttons, so the
 *    bot's own handlers work on it, plus the staff role ping.
 * 4. Registers the ticket with the game through the bot API so triage, the
 *    receipt page and the support MCP see it like any other ticket.
 *
 * Env: DISCORD_BOT_TOKEN (StarmerBot), DISCORD_BOT_API_KEY (game bot API),
 * AHD_GUILD_ID / AHD_TICKET_CATEGORY_ID / AHD_TICKET_PING_ROLE_ID optional.
 */

const GUILD_ID = process.env.AHD_GUILD_ID || "1465445442987888743";
const TICKET_CATEGORY_ID = process.env.AHD_TICKET_CATEGORY_ID || "1483979826967744534";
const PING_ROLE_ID = process.env.AHD_TICKET_PING_ROLE_ID || "1470571508689535188";
const GAME_API = process.env.AHD_GAME_API_URL || "https://ahousedividedgame.com";
const API = "https://discord.com/api/v10";

const CATEGORY = {
  bug: { slug: "bug", label: "Bug Report", emoji: "🐛", color: 15548997 },
  gameplay: { slug: "mechanics", label: "Mechanics Help", emoji: "🧩", color: 5793266 },
  moderation: { slug: "moderation", label: "Moderation", emoji: "🛡️", color: 15105570 },
  account: { slug: "account", label: "Account", emoji: "👤", color: 3447003 },
  other: { slug: "other", label: "Other", emoji: "📨", color: 9807270 },
  // Staff-opened catch-all for an outage or a problem many players hit
  // (AHDGame #4081). Keir may open one for a severe cluster of tickets.
  incident: { slug: "incident", label: "Incident", emoji: "🚨", color: 13843259 },
};

async function discord(path, init = {}) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("DISCORD_BOT_TOKEN is not configured");
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(API + path, {
      ...init,
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json", "User-Agent": "ahd-support-mcp/1.0", ...(init.headers || {}) },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      await new Promise((r) => setTimeout(r, Math.ceil((body.retry_after || 1) * 1000) + 200));
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`Discord ${init.method || "GET"} ${path.split("?")[0]} -> ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }
  throw new Error(`Discord ${path.split("?")[0]} stayed rate limited`);
}

function channelSlug(name) {
  return String(name || "player").toLowerCase().replace(/[^a-z0-9_-]+/g, "").slice(0, 32) || "player";
}

function ticketPageCandidate(description) {
  const match = String(description || "").match(/https?:\/\/[^\s<>]+/i)?.[0]?.replace(/[),.;]+$/, "");
  if (!match) return null;
  try {
    const url = new URL(match);
    return ["http:", "https:"].includes(url.protocol) && /(^|\.)ahousedividedgame\.com$/i.test(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizePlatformLabel(value) {
  const label = String(value || "").toLowerCase();
  if (/android/.test(label)) return "Android";
  if (/\bios\b|iphone|ipad/.test(label)) return "iOS";
  if (/mobile|phone|tablet/.test(label)) return /browser|web/.test(label) ? "Mobile browser" : "Mobile";
  if (/desktop|windows|macos|linux|computer|laptop/.test(label)) return /client|app/.test(label) ? "Desktop client" : "Desktop browser";
  if (/client/.test(label)) return "Desktop client";
  return "Platform unknown";
}

function ticketIntakeComponents(number) {
  return [
    { type: 1, components: [
      { type: 2, custom_id: `ticket_intake:confirm_page:${number}`, style: 1, label: "Confirm page" },
      { type: 2, custom_id: `ticket_intake:change_page:${number}`, style: 2, label: "Change page" },
      { type: 2, custom_id: `ticket_intake:confirm_platform:${number}`, style: 1, label: "Confirm details" },
      { type: 2, custom_id: `ticket_intake:edit_details:${number}`, style: 2, label: "Edit details" },
    ] },
  ];
}

async function sendWithRetry(
  channelId,
  message,
  nonce,
  send = discord,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  const idempotentMessage = { ...message, nonce, enforce_nonce: true };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await send(`/channels/${channelId}/messages`, {
        method: "POST",
        body: JSON.stringify(idempotentMessage),
      });
      return true;
    } catch (error) {
      if (attempt === 2) {
        console.error(`Discord message delivery failed in channel ${channelId}:`, error);
        return false;
      }
      await wait(400 * (attempt + 1));
    }
  }
  return false;
}

async function editMessageWithRetry(path, message, edit = discord, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await edit(path, { method: "PATCH", body: JSON.stringify(message) });
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await wait(400 * (attempt + 1));
    }
  }
  console.error(`Discord card edit failed for ${path}:`, lastError);
  return false;
}

function registerCreateTicket(server, { auth, Tickets, z, jsonResult, errorResult, ticketPublicUrl }) {
  server.tool(
    "support_create_ticket",
    "Open a support ticket on a player's behalf (WRITE-scoped token required). Use for reports made outside the ticket flow. Category incident opens a staff catch-all for an outage or a problem many players hit; it needs no reporter, and repeat tickets then join it with support_merge. Creates the ticket channel, posts one persistent intake card with Claim/Close and page/platform controls, and registers it with the game. Returns the ticket number and channel.",
    {
      discord_user_id: z.string().regex(/^\d{15,22}$/).optional().describe("Reporter's Discord user id; optional only for an incident, which defaults to the bot"),
      category: z.enum(["bug", "gameplay", "moderation", "account", "other", "incident"]).default("bug"),
      title: z.string().trim().min(1).max(200).describe("Ticket subject, shown in the embed"),
      description: z.string().trim().min(1).max(5000).describe("What the player reported, in their words where possible, with context"),
      platform: z.string().trim().max(100).optional().describe("Broad platform or device class such as Android, iOS, mobile browser, desktop browser, or desktop client"),
      source_channel_id: z.string().regex(/^\d{15,22}$/).optional().describe("Originating chat; announce that Starmer opened the ticket with a link"),
      image_urls: z.array(z.string().url()).max(10).optional(),
    },
    async ({ discord_user_id, category, title, description, platform, image_urls, source_channel_id }) => {
      if (!auth || auth.scopes?.write !== true) return errorResult("write scope required — this token is read-only");
      const botApiKey = process.env.DISCORD_BOT_API_KEY;
      if (!botApiKey) return errorResult("DISCORD_BOT_API_KEY is not configured for the support MCP");
      const meta = CATEGORY[category];
      const incident = category === "incident";
      try {
        if (!discord_user_id) {
          if (!incident) return errorResult("discord_user_id is required for a player ticket");
          discord_user_id = (await discord("/users/@me")).id;
        }
        const member = await discord(`/guilds/${GUILD_ID}/members/${discord_user_id}`);
        const username = member.user.username;
        const displayName = member.nick || member.user.global_name || username;

        const channels = await discord(`/guilds/${GUILD_ID}/channels`);
        const ticketChannels = channels
          .filter((c) => c.type === 0 && /^(?:closed-)?ticket-.+-\d+$/.test(c.name || ""))
          .map((c) => ({ ...c, number: Number(c.name.match(/-(\d+)$/)[1]) }))
          .sort((a, b) => b.number - a.number);
        const reserved = await fetch(`${GAME_API}/api/discord-bot/tickets/reserve`, {
          method: "POST", headers: { "Content-Type": "application/json", "X-Bot-Token": botApiKey },
          body: JSON.stringify({ discordFloor: ticketChannels[0]?.number || 0 }),
          signal: AbortSignal.timeout(20000),
        });
        if (!reserved.ok) return errorResult(`Ticket number reservation failed (${reserved.status}); no channel was created`);
        const { ticketNumber: number } = await reserved.json();
        if (!Number.isSafeInteger(number) || number <= (ticketChannels[0]?.number || 0)) return errorResult("Invalid ticket number reservation; no channel was created");

        const template = ticketChannels[0];
        const me = await discord("/users/@me");
        const overwrites = template
          ? template.permission_overwrites.filter((o) => o.type === 0 || o.id === me.id)
          : [{ id: GUILD_ID, type: 0, allow: "0", deny: "1024" }];
        if (!overwrites.some((o) => o.id === GUILD_ID)) overwrites.push({ id: GUILD_ID, type: 0, allow: "0", deny: "1024" });
        if (!overwrites.some((o) => o.id === me.id)) overwrites.push({ id: me.id, type: 1, allow: "11280", deny: "0" });
        const reporterAllow = template?.permission_overwrites.find((o) => o.type === 1 && o.id !== me.id)?.allow || "68608";
        overwrites.push({ id: discord_user_id, type: 1, allow: reporterAllow, deny: "0" });

        const channel = await discord(`/guilds/${GUILD_ID}/channels`, {
          method: "POST",
          body: JSON.stringify({
            name: `ticket-${meta.slug}-${channelSlug(username)}-${number}`,
            type: 0,
            parent_id: template?.parent_id || TICKET_CATEGORY_ID,
            permission_overwrites: overwrites.map(({ id, type, allow, deny }) => ({ id, type, allow, deny })),
          }),
        });

        const created = Math.floor(Date.now() / 1000);
        const fields = [
          { name: "Opened by", value: `<@${me.id}> on behalf of <@${discord_user_id}>`, inline: false },
          { name: "Reporter", value: `<@${discord_user_id}>`, inline: true },
          { name: "Category", value: meta.label, inline: true },
          { name: "Created", value: `<t:${created}:R>`, inline: true },
          ...(platform ? [{ name: "Platform", value: normalizePlatformLabel(platform), inline: true }] : []),
          { name: "Subject", value: title.slice(0, 200), inline: false },
        ];
        let candidatePageUrl = ticketPageCandidate(description);
        let platformLabel = normalizePlatformLabel(platform);
        let gameVersion = null;
        let clientVersion = null;
        fields.push(
          { name: "Intake", value: "Please confirm the page and platform details", inline: false },
          { name: "Affected page / issue", value: candidatePageUrl ? `[${candidatePageUrl}](${candidatePageUrl}) · please confirm` : "No page detected · confirm or replace the suggested page", inline: false },
          { name: "Platform and versions", value: [platformLabel, "Game: version unknown", "Client: version unknown", "Status: please confirm"].join("\n"), inline: false },
          { name: "Receipt", value: "Receipt link is being prepared", inline: false },
        );
        const embed = await discord(`/channels/${channel.id}/messages`, {
          method: "POST",
          body: JSON.stringify({
            embeds: [{ title: `${meta.emoji} ${meta.label} - #${number}`, color: meta.color, fields, footer: { text: "ahousedividedgame.com" } }],
            components: [{ type: 1, components: [
              { type: 2, custom_id: "ticket_claim", style: 2, label: "Claim", emoji: { name: "🙋" } },
              { type: 2, custom_id: "ticket_close", style: 4, label: "Close Ticket", emoji: { name: "🔒" } },
            ] }],
          }),
        });
        await discord(`/channels/${channel.id}/messages`, {
          method: "POST",
          body: JSON.stringify({ content: `<@&${PING_ROLE_ID}>`, allowed_mentions: { roles: [PING_ROLE_ID] } }),
        });
        const res = await fetch(`${GAME_API}/api/discord-bot/tickets`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Bot-Token": botApiKey },
          body: JSON.stringify({
            category, title, description, ticketNumber: number,
            discordChannelId: channel.id, discordUserId: discord_user_id,
            discordUsername: username, discordDisplayName: displayName,
            ...(image_urls?.length ? { imageUrls: image_urls } : {}),
            message: { discordMessageId: embed.id, authorId: discord_user_id, authorName: displayName, content: description, ...(image_urls?.length ? { imageUrls: image_urls } : {}) },
          }),
          signal: AbortSignal.timeout(20000),
        });
        const body = await res.text();
        if (!res.ok) {
          return errorResult(`channel #${channel.name} created but the game API refused the ticket (${res.status}): ${body.slice(0, 300)}. Register it before anyone replies.`);
        }
        const registered = JSON.parse(body);
        const receiptUrl = ticketPublicUrl?.(number) || null;
        try {
          const contextRes = await fetch(`${GAME_API}/api/discord-bot/tickets?ticketNumber=${number}&discordChannelId=${encodeURIComponent(channel.id)}`, {
            headers: { "X-Bot-Token": botApiKey }, signal: AbortSignal.timeout(10000),
          });
          if (contextRes.ok) {
            const context = await contextRes.json();
            const suggestion = context.intakeSuggestion || {};
            candidatePageUrl = candidatePageUrl || suggestion.candidatePageUrl || null;
            platformLabel = platform ? normalizePlatformLabel(platform) : normalizePlatformLabel(suggestion.platformLabel);
            gameVersion = suggestion.gameVersion || null;
            clientVersion = suggestion.clientVersion || null;
          }
        } catch (error) {
          console.warn(`Ticket #${number} intake context lookup failed:`, error.message);
        }
        const questions = (registered.contextQuestions || []).filter((q) => typeof q === "string" && q.trim()).slice(0, 4);
        const updatedFields = fields.filter((field) => !["Intake", "Affected page / issue", "Platform and versions", "Receipt", "Details needed"].includes(field.name));
        updatedFields.push(
          { name: "Intake", value: "Please confirm the page and platform details", inline: false },
          { name: "Affected page / issue", value: candidatePageUrl ? `[${candidatePageUrl}](${candidatePageUrl}) · please confirm` : "No page detected · confirm or replace the suggested page", inline: false },
          { name: "Platform and versions", value: [platformLabel, `Game: ${gameVersion || "version unknown"}`, `Client: ${clientVersion || "version unknown"}`, "Status: please confirm"].join("\n"), inline: false },
          { name: "Receipt", value: receiptUrl ? `[View ticket receipt](${receiptUrl})` : "Receipt link unavailable", inline: false },
        );
        if (questions.length) updatedFields.push({ name: "Details needed", value: questions.join("\n").slice(0, 1000), inline: false });
        const intakePersistResponse = await fetch(`${GAME_API}/api/discord-bot/tickets`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "X-Bot-Token": botApiKey },
          body: JSON.stringify({
            action: "intake", ticketNumber: number, discordChannelId: channel.id,
            intake: {
              cardMessageId: embed.id, receiptUrl, candidatePageUrl,
              platformLabel, gameVersion, clientVersion,
            },
          }),
          signal: AbortSignal.timeout(20000),
        });
        const intakePersisted = intakePersistResponse.ok;
        const intakeCardDelivered = await editMessageWithRetry(`/channels/${channel.id}/messages/${embed.id}`, {
            embeds: [{ ...embed.embeds[0], fields: updatedFields, footer: { text: "✅ Correct page / issue · ❌ Wrong page / issue · ahousedividedgame.com" } }],
            components: [{ type: 1, components: [
              { type: 2, custom_id: "ticket_claim", style: 2, label: "Claim", emoji: { name: "🙋" } },
              { type: 2, custom_id: "ticket_close", style: 4, label: "Close Ticket", emoji: { name: "🔒" } },
            ] }, ...(incident ? [] : ticketIntakeComponents(number))],
        });
        if (!incident) {
          await discord(`/channels/${channel.id}/messages/${embed.id}/reactions/%E2%9C%85/@me`, { method: "PUT" }).catch(() => {});
          await discord(`/channels/${channel.id}/messages/${embed.id}/reactions/%E2%9D%8C/@me`, { method: "PUT" }).catch(() => {});
        }
        const receiptDelivered = Boolean(receiptUrl) && intakePersisted && intakeCardDelivered;
        const questionsDelivered = intakeCardDelivered;
        const announcementDelivered = !source_channel_id || await sendWithRetry(source_channel_id, {
          content: `Starmer opened a ticket on behalf of <@${discord_user_id}>: https://discord.com/channels/${GUILD_ID}/${channel.id}`,
          allowed_mentions: { users: [discord_user_id] },
        }, `t${number}-announcement`);
        return jsonResult({
          ok: true, ticketNumber: number, channelId: channel.id, channelName: channel.name,
          channelUrl: `https://discord.com/channels/${GUILD_ID}/${channel.id}`, reporter: { id: discord_user_id, username, displayName },
          receiptUrl, receiptDelivered, questionsDelivered, intakePersisted, intakeCardDelivered, announcementDelivered,
        });
      } catch (error) {
        return errorResult(String(error.message || error));
      }
    }
  );
}

module.exports = { registerCreateTicket, sendWithRetry };
