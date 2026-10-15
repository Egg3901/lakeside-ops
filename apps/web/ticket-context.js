"use strict";

// Context requests are deliberately a small, persisted decision alongside a
// ticket. The receipt can render the safe deterministic fallback immediately,
// while Jev supplies the classification used for the durable chat prompt.

const crypto = require("node:crypto");
const { callJev } = require("./llm");

const JEV_MODEL = process.env.TICKET_CONTEXT_JEV_MODEL || "~typesafe/jev-latest";
const JEV_TIMEOUT_MS = Number(process.env.TICKET_CONTEXT_JEV_TIMEOUT_MS) || 20_000;
const NEEDS = new Set(["discord", "corporation", "page"]);

const PLAYER_COPY = {
  discord: "Link your Discord account to the game, then reply here so we can match this report to your game data.",
  corporation: "Please reply with the corporation's in-game link, or its exact name and ticker, so we can check the right company.",
  page: "Please reply with the affected page's in-game link, or the exact menu path where it appears.",
};

const CORP_WORDS = /\b(?:corp(?:oration)?|company|ceo|shareholder|shareholders|shares?|subsidiary|buyout|charter|stock|ticker)\b/i;
const PAGE_WORDS = /\b(?:page|screen|tab|button|market|profile|menu|web\s+browser|mobile|ui|blank|error)\b|\b(?:doesn['’]t|does\s+not|not|can['’]t|cannot|won['’]t|fails?)\s+(?:show|load|work|open|match|display)/i;
const URL_RE = /https?:\/\/[^\s<>()]+/gi;

function nonEmpty(value) {
  return value != null && String(value).trim() !== "";
}

function ticketText(ticket) {
  const t = ticket || {};
  const messages = Array.isArray(t.messages)
    ? t.messages.map((m) => typeof m === "string" ? m : m && (m.content || m.text) || "")
    : [];
  return [t.title, t.description, ...messages].filter(nonEmpty).join("\n").slice(0, 12_000);
}

function reporterOf(ticket) {
  return ticket && ticket.reporter && typeof ticket.reporter === "object" ? ticket.reporter : {};
}

function hasGameIdentity(ticket) {
  const t = ticket || {};
  const r = reporterOf(t);
  return [
    t.userId,
    t.gameUserId,
    t.playerId,
    t.characterId,
    t.gameAccountId,
    t.discordGameUserId,
    r.userId,
    r.gameUserId,
    r.characterId,
  ].some(nonEmpty);
}

function hasCorporationLink(ticket) {
  const t = ticket || {};
  const r = reporterOf(t);
  return [
    t.corporationUrl,
    t.corporationId,
    r.corporationUrl,
    r.corporationId,
    t.entity && t.entity.type === "corporation" && (t.entity.url || t.entity.id),
  ].some(nonEmpty);
}

function isUsefulPageUrl(value) {
  if (!nonEmpty(value)) return false;
  try {
    const url = new URL(String(value));
    if (!/^https?:$/.test(url.protocol)) return false;
    if (/discord(?:app)?\.com|ops\.lakesidegames\.net/i.test(url.hostname)) return false;
    return !/\/character\//i.test(url.pathname) && !/\/corporation\//i.test(url.pathname);
  } catch {
    return false;
  }
}

function hasPageLink(ticket) {
  const t = ticket || {};
  if ([t.pageUrl, t.reportedPageUrl, t.affectedUrl, t.gamePageUrl].some(isUsefulPageUrl)) return true;
  const links = Array.isArray(t.links) ? t.links : [];
  if (links.some((value) => isUsefulPageUrl(typeof value === "string" ? value : value && (value.url || value.href)))) return true;
  return (ticketText(t).match(URL_RE) || []).some(isUsefulPageUrl);
}

function inferContextNeeds(ticket) {
  const text = ticketText(ticket);
  const needed = [];
  if (!hasGameIdentity(ticket)) needed.push("discord");
  if (CORP_WORDS.test(text) && !hasCorporationLink(ticket)) needed.push("corporation");
  if (PAGE_WORDS.test(text) && !hasPageLink(ticket)) needed.push("page");
  return needed;
}

function contextRequestKey(needed) {
  const values = [...new Set((needed || []).filter((value) => NEEDS.has(value)))].sort();
  if (!values.length) return null;
  return `context:${crypto.createHash("sha1").update(values.join(",")).digest("hex").slice(0, 16)}`;
}

function contextRequestForDisplay(ticket) {
  if (ticket && (ticket.publicUpdates || []).some((update) => ["development", "production", "heal", "resolution"].includes(update.kind) && !update.supersededAt)) return null;
  const stored = ticket && ticket.contextRequest;
  if (stored && Array.isArray(stored.needed)) {
    const needed = [...new Set(stored.needed.filter((value) => NEEDS.has(value)))];
    return needed.length ? { ...stored, needed } : null;
  }
  const needed = inferContextNeeds(ticket);
  return needed.length ? { needed, generatedBy: "receipt-fallback", key: contextRequestKey(needed) } : null;
}

function contextPromptInput(ticket, candidates) {
  const t = ticket || {};
  const r = reporterOf(t);
  return JSON.stringify({
    title: String(t.title || "").slice(0, 240),
    description: String(t.description || "").slice(0, 2000),
    messages: (Array.isArray(t.messages) ? t.messages : [])
      .map((m) => typeof m === "string" ? m : m && (m.content || m.text) || "")
      .filter(Boolean)
      .slice(0, 12)
      .map((value) => String(value).slice(0, 1200)),
    knownContext: {
      hasGameIdentity: hasGameIdentity(t),
      hasCorporationLink: hasCorporationLink(t),
      hasPageLink: hasPageLink(t),
      reporterName: r.characterName || r.username || null,
      corporationName: r.corporationName || null,
    },
    candidateRequests: candidates,
  });
}

function parseJevNeeds(raw, candidates) {
  if (!raw) throw new Error("empty Jev context response");
  let value = String(raw).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const first = value.indexOf("{");
  const last = value.lastIndexOf("}");
  if (first >= 0 && last > first) value = value.slice(first, last + 1);
  const obj = JSON.parse(value);
  let selected = obj.needed || obj.needs || obj.request || obj.requests || obj.missing;
  if (!Array.isArray(selected)) {
    selected = [];
    for (const key of NEEDS) {
      if (obj[key] === true || obj[`request${key[0].toUpperCase()}${key.slice(1)}Link`] === true) selected.push(key);
    }
  }
  if (typeof selected === "string") selected = selected.split(/[\s,]+/);
  const allowed = new Set(candidates);
  return [...new Set((Array.isArray(selected) ? selected : []).map((value) => String(value).toLowerCase().replace(/[-_ ]/g, "")).map((value) => value === "discordlink" ? "discord" : value === "corporationlink" ? "corporation" : value === "pagelink" ? "page" : value).filter((value) => NEEDS.has(value) && allowed.has(value)))];
}

function parseJevAnswers(answers, candidates) {
  const selected = [];
  for (const kind of candidates) {
    const answer = answers && answers[kind];
    const probability = Number(answer && (answer.noul ?? answer.probability));
    if (Number.isFinite(probability) && probability >= 0.5) selected.push(kind);
  }
  return selected;
}

async function classifyTicketContext(ticket) {
  const candidates = inferContextNeeds(ticket);
  if (!candidates.length) {
    return { needed: [], generatedBy: "deterministic", model: null, provider: null };
  }
  try {
    const questions = Object.fromEntries(candidates.map((kind) => [kind, {
      type: "noul",
      instructions: kind === "discord"
        ? "Is asking the reporter to link their Discord account to the game necessary to match this report to game data? Answer yes only when the report has no usable linked game identity or details."
        : kind === "corporation"
          ? "Is asking the reporter for the affected corporation's in-game link or exact name and ticker necessary to identify the corporation in this report? Answer yes only when the report concerns a corporation and no corporation link is present."
          : "Is asking the reporter for the affected game's page link or exact menu path necessary to identify the broken page in this report? Answer yes only when the report concerns a page or screen and no page link is present.",
    }]));
    const out = await callJev({
      model: JEV_MODEL,
      state: {
        description: "A support report and the candidate follow-up details that may be missing.",
        records: [{ id: "ticket", record: contextPromptInput(ticket, candidates) }],
      },
      questions,
      timeoutMs: JEV_TIMEOUT_MS,
    });
    // Jev validates the missing-context classification, but the hard player
    // promise remains deterministic: if our input says a link is missing, a
    // transiently overconfident model must not suppress that request.
    const needed = [...new Set([...candidates, ...parseJevAnswers(out.answers, candidates)])];
    return { needed, generatedBy: "jev-openrouter", model: out.model || JEV_MODEL, provider: out.provider || "openrouter" };
  } catch (error) {
    // A missing context prompt is useful even when the model endpoint is
    // temporarily unavailable. Keep the fallback constrained to deterministic
    // candidates and record the provenance for staff diagnostics.
    console.warn(`[ticket-context] Jev classification failed: ${error.message}`);
    return { needed: candidates, generatedBy: "deterministic-fallback", model: JEV_MODEL, provider: "openrouter", error: String(error.message || error).slice(0, 240) };
  }
}

function buildContextRequest(ticket, classification, now = new Date()) {
  const needed = [...new Set((classification && classification.needed || []).filter((value) => NEEDS.has(value)))];
  if (!needed.length) return { version: 1, needed: [], generatedAt: now, generatedBy: classification && classification.generatedBy || "deterministic" };
  return {
    version: 1,
    needed,
    key: contextRequestKey(needed),
    reason: "We need one or more links or account details to match this report to the right game records.",
    generatedAt: now,
    generatedBy: classification.generatedBy || "deterministic",
    ...(classification.model ? { model: classification.model } : {}),
    ...(classification.provider ? { provider: classification.provider } : {}),
    ...(classification.error ? { error: classification.error } : {}),
  };
}

async function ensureTicketContextRequest(db, ticket, { force = false } = {}) {
  if (!ticket) return null;
  if (!force && ticket.contextRequest && Array.isArray(ticket.contextRequest.needed)) {
    return ticket.contextRequest;
  }
  const classification = await classifyTicketContext(ticket);
  const request = buildContextRequest(ticket, classification);
  if (db && ticket._id) {
    await db.collection("tickets").updateOne(
      { _id: ticket._id, ...(force ? {} : { contextRequest: { $exists: false } }) },
      { $set: { contextRequest: request, updatedAt: new Date() } },
    );
  }
  return request;
}

module.exports = {
  JEV_MODEL,
  PLAYER_COPY,
  hasGameIdentity,
  hasCorporationLink,
  hasPageLink,
  inferContextNeeds,
  contextRequestKey,
  contextRequestForDisplay,
  parseJevNeeds,
  parseJevAnswers,
  classifyTicketContext,
  buildContextRequest,
  ensureTicketContextRequest,
};
