"use strict";

// Pure text helpers: no I/O, so everything here is unit tested.

const DISCORD_LIMIT = 1900;

/**
 * Split a reply into Discord-sized messages, breaking on newlines where it can
 * and keeping ``` fences balanced so a code block cut in half still renders.
 */
function chunkMessage(text, limit = DISCORD_LIMIT) {
  const src = String(text || "").trim();
  if (!src) return [];
  const chunks = [];
  let rest = src;
  let reopenFence = "";
  while (rest.length) {
    const room = limit - reopenFence.length - 4;
    let piece;
    if (rest.length <= room) {
      piece = rest;
      rest = "";
    } else {
      let cut = rest.lastIndexOf("\n", room);
      if (cut < room / 2) cut = rest.lastIndexOf(" ", room);
      if (cut < room / 2) cut = room;
      piece = rest.slice(0, cut);
      rest = rest.slice(cut).replace(/^\s+/, "");
    }
    let body = reopenFence + piece;
    const fences = body.match(/^```.*$/gm) || [];
    if (fences.length % 2 === 1) {
      const opener = fences[fences.length - 1];
      body += "\n```";
      reopenFence = rest ? `${opener}\n` : "";
    } else {
      reopenFence = "";
    }
    chunks.push(body);
  }
  return chunks;
}

/**
 * The agent's final reply for the turn, from `get_agent_activity` with a small
 * limit. Paseo renders tool calls as single `[Tool] summary` lines and assistant
 * text unprefixed, so a body that starts with a tag means the turn ended on a
 * tool call (nothing to post). A trailing `[Thought]` block is reasoning, not
 * reply, and is cut.
 */
function extractFinalText(content) {
  let body = String(content || "");
  if (/^Showing /.test(body)) {
    const gap = body.indexOf("\n\n");
    body = gap === -1 ? "" : body.slice(gap + 2);
  }
  const thought = body.search(/(^|\n)\[Thought\] /);
  if (thought !== -1) body = body.slice(0, thought);
  body = body.trim();
  if (!body) return "";
  // `[label](url)` is a markdown link, not a tool line.
  if (/^\[[^\]\n]{1,60}\](?!\()/.test(body)) return "";
  return body;
}

const SECRET_PATTERNS = [
  /\bahdk_[A-Za-z0-9_-]{8,}/g,
  /\b[MNO][A-Za-z\d_-]{23,27}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,40}\b/g,
  /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}/g,
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /(mongodb(?:\+srv)?:\/\/)[^\s:@/]+:[^\s@/]+@/g,
  /\b[0-9a-f]{32}\.[A-Za-z0-9]{20,}\b/g,
];

// Private or internal details that should never reach a channel even when the
// credential patterns above do not match: player emails, IP addresses, password
// hashes, JWTs, server paths and loopback services.
const PRIVATE_PATTERNS = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g,
  /\b(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b/gi,
  /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /(?:\/root|\/etc|\/var\/lib|\/home)\/[^\s`'")\]]*/g,
  /\blocalhost:\d{2,5}\b/g,
  /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|_URI)=\S+/g,
];

/** Last line of defence on anything posted to Discord: mask credentials and private details. */
function redactSecrets(text) {
  let out = String(text || "");
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (match, scheme) =>
      typeof scheme === "string" && scheme.startsWith("mongodb") ? `${scheme}[redacted]@` : "[redacted]",
    );
  }
  for (const re of PRIVATE_PATTERNS) out = out.replace(re, "[redacted]");
  return out;
}

/** True when the agent chose not to reply this turn. */
function isSilent(text) {
  return /^\[silent\]$/i.test(String(text || "").trim());
}

/** "10m", "2h", "90s", "1h30m", or a bare number of minutes. Returns ms or null. */
function parseDuration(input) {
  const s = String(input || "").trim().toLowerCase();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 60000);
  const re = /(\d+(?:\.\d+)?)\s*(h|m|s)/g;
  let total = 0;
  let consumed = "";
  let m;
  while ((m = re.exec(s))) {
    total += Number(m[1]) * (m[2] === "h" ? 3600000 : m[2] === "m" ? 60000 : 1000);
    consumed += m[0];
  }
  if (!total || consumed.replace(/\s/g, "") !== s.replace(/\s/g, "")) return null;
  return Math.round(total);
}

function displayName(user) {
  return (user && (user.global_name || user.username)) || "unknown";
}

/** One prompt from everything that arrived since the agent's last turn. */
function formatInbound(items, { channelName } = {}) {
  const where = channelName ? ` in #${channelName}` : "";
  const blocks = items.map((item) => {
    if (item.kind === "wakeup") {
      return `[Check-in you scheduled with \`keir later\`]: ${item.note}`;
    }
    if (item.kind === "heal") {
      return `[Heal result]: ${item.note}`;
    }
    const attach = item.attachments && item.attachments.length
      ? `\n(attachments: ${item.attachments.map((a) => a.filename).join(", ")}${item.images && item.images.length ? "; images are attached to this prompt" : ""})`
      : "";
    const reply = item.replyToKeir ? " (replying to you)" : "";
    const ref = item.messageId ? `, message ${item.messageId}` : "";
    return `[${item.authorName}, developer${reply}${ref}]:\n${item.content}${attach}`;
  });
  return `New Discord activity${where}:\n\n${blocks.join("\n\n")}`;
}

/** Footer marker on Keir's own /summon replies: "Despatch box · start". */
function parseCommandFooter(footerText) {
  const m = /Despatch box · (start|stop|floor open|floor closed)$/.exec(String(footerText || "").trim());
  return m ? m[1] : null;
}

function messageText(message) {
  const parts = [message.content || ""];
  for (const embed of message.embeds || []) {
    parts.push(embed.title || "", embed.description || "");
    for (const field of embed.fields || []) parts.push(`${field.name || ""}: ${field.value || ""}`);
  }
  return parts.filter(Boolean).join("\n");
}

function filterStarmerisms(body, allowed) {
  const serious = /\b(?:error|failed|failure|refund|compensation|heal|apolog\w*|sorry|breach|outage)\b/i.test(body);
  let used = false;
  return String(body || "").replace(/\b(?:let me be clear|I['’]ve been very clear(?: about this)?|country first,? party second|we['’]ll get on with the job)\b[.!:,;]?\s*/gi, (phrase) => {
    if (allowed && !serious && !used && /^(?:let me be clear|we['’]ll get on)/i.test(phrase)) {
      used = true;
      return phrase;
    }
    return "";
  }).trim();
}

module.exports = {
  DISCORD_LIMIT,
  chunkMessage,
  extractFinalText,
  redactSecrets,
  isSilent,
  parseDuration,
  displayName,
  formatInbound,
  parseCommandFooter,
  messageText,
  filterStarmerisms,
};
