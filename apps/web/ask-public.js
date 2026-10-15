"use strict";

const crypto = require("node:crypto");

const RESPONSE_LENGTHS = {
  concise: {
    instruction: "Keep the answer concise. Lead with the answer, use at most 2-4 short paragraphs or a compact list unless more detail is essential.",
    answerTokens: 2200,
  },
  standard: {
    instruction: "Give a focused answer with enough detail to explain the result. Prefer 4-8 short paragraphs or a compact list.",
    answerTokens: 4000,
  },
  detailed: {
    instruction: "Give a thorough answer. Include the important evidence, caveats, and mechanics, but avoid repetition.",
    answerTokens: 7000,
  },
};

const THINKING_LEVELS = {
  quick: { effort: "none", rounds: 2, calls: 3, reasoningTokens: 0 },
  normal: { effort: "low", rounds: 3, calls: 5, reasoningTokens: 3000 },
  deep: { effort: "medium", rounds: 5, calls: 8, reasoningTokens: 8000 },
};

const MILITARY_INVENTORY = String.raw`(?:logistics? commands?|airlift wings?|commands?|units?|formations?|divisions?|brigades?|battalions?|regiments?|corps|squadrons?|wings?|fleets?|carrier groups?|task forces?|naval assets?|air assets?|troops?|personnel|equipment|readiness|deployments?|force strength|army strength|military strength|tanks?|aircraft|ships?|submarines?|missiles?|nuclear weapons?)`;
const FORCE_POSSESSION = new RegExp(
  String.raw`\b(?:has|have|had|lacks?|without|no|zero|fields?|fielded|deploys?|deployed|stations?|stationed|includes?|contains?)\b[^.!?\n]{0,90}\b${MILITARY_INVENTORY}\b|\b${MILITARY_INVENTORY}\b[^.!?\n]{0,60}\b(?:on (?:its|their|the) roster|in (?:its|their|the) forces?|available|deployed|stationed)\b`,
  "i",
);
const FORCE_INVENTORY = /\b(?:live (?:military )?roster|current (?:military )?roster|force composition|order of battle|current deployments?|live readiness|live force strength)\b/i;
const FORCE_QUANTITY = new RegExp(
  String.raw`\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozens?|\d+(?:\.\d+)?%?)\b[^.!?\n]{0,35}\b${MILITARY_INVENTORY}\b|\b${MILITARY_INVENTORY}\b[^.!?\n]{0,35}\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozens?|\d+(?:\.\d+)?%?)\b`,
  "i",
);
const FORCE_ABSENCE = new RegExp(
  String.raw`\b(?:lacks?|missing|without|no|zero)\b[^.!?\n]{0,70}\b${MILITARY_INVENTORY}\b|\b${MILITARY_INVENTORY}\b[^.!?\n]{0,45}\b(?:absent|missing|unavailable)\b`,
  "i",
);
const FORCE_OPERATION = new RegExp(
  String.raw`\b(?:operates?|maintains?|fields?|deploys?|stations?|consists? of)\b[^.!?\n]{0,70}\b${MILITARY_INVENTORY}\b`,
  "i",
);
const PRIVATE_MILITARY_QUESTION = new RegExp(
  String.raw`\bhow many\b[^?\n]{0,90}\b${MILITARY_INVENTORY}\b|\b(?:which|what)\b[^?\n]{0,45}\b${MILITARY_INVENTORY}\b[^?\n]{0,45}\b(?:does|do)\b[^?\n]{0,45}\b(?:have|field|deploy|station|operate|maintain|lack)\b|\bwhat is\b[^?\n]{0,75}\b(?:readiness|force strength|army strength|military strength|force composition|order of battle)\b|\b(?:does|do|is|are)\b[^?\n]{0,90}\b(?:have|field|deploy|station|operate|maintain|lack|missing|readiness)\b|\b(?:current|live|roster|force composition|order of battle)\b[^?\n]{0,90}\b${MILITARY_INVENTORY}\b`,
  "i",
);
const GENERIC_MILITARY_MECHANIC = new RegExp(
  String.raw`^(?:a|an|each|every)\s+${MILITARY_INVENTORY}\b[^.!?\n]{0,50}\b(?:adds?|provides?|consumes?|requires?|contains?|consists? of|can|may|moves?|supplies|supports?|costs?|takes?)\b`,
  "i",
);
const GENERIC_MECHANICS_QUESTION = /\b(?:how|what|why|when|where|can)\b[^?\n]{0,100}\b(?:work|works|do|mechanics?|composed?|formed?|assigned?|supply|supplied|throughput)\b/i;
const CAPITALIZED_WORD = /^[A-Z][A-Za-z'-]*/;
const CAPITALIZED_LOCATION = /\b(?:from|in|near|for|within|of)\s+([A-Z][A-Za-z'-]+)\b/g;
const CAPITALIZED_ANYWHERE = /\b[A-Z][A-Za-z'-]*\b/g;
const GENERIC_HYPOTHETICAL = /^(?:if|when|unless|without|to)\b|\b(?:must|needs? to|has to|can|may|should)\b/i;
const GENERIC_NAME_WORDS = new Set([
  "a", "an", "the", "each", "every", "you", "to", "in", "under", "when", "if", "for", "without",
  "logistics", "airlift", "command", "commands", "unit", "units", "formation", "formations",
  "division", "divisions", "brigade", "brigades", "battalion", "battalions", "regiment", "regiments",
  "corps", "squadron", "squadrons", "wing", "wings", "fleet", "fleets", "carrier", "task", "naval",
  "air", "troop", "troops", "personnel", "equipment", "readiness", "deployment", "deployments", "force",
  "forces", "army", "military", "tank", "tanks", "aircraft", "ship", "ships", "submarine", "submarines",
  "missile", "missiles", "nuclear", "house", "divided",
]);

const PRIVATE_MILITARY_REFUSAL = "This Discord answer is public, so I can't publish live military rosters, unit or command composition, readiness, deployments, or force strength. I can explain the mechanics or summarize the public war record instead.";

function isGenericMilitaryMechanicSentence(sentence, question) {
  const text = sentence.trim();
  if (GENERIC_MILITARY_MECHANIC.test(text)) return true;
  if (!GENERIC_MECHANICS_QUESTION.test(String(question || ""))) return false;
  const hasUnknownName = [...text.matchAll(CAPITALIZED_ANYWHERE)]
    .some((match) => !GENERIC_NAME_WORDS.has(match[0].toLowerCase().replace(/'s$/, "")));
  if (GENERIC_HYPOTHETICAL.test(text) && !hasUnknownName) return true;
  if (/\b(?:your|their|our|its|this|that)\s+(?:country|nation|force|forces|army|military)\b/i.test(text)) return false;
  const subject = text.match(CAPITALIZED_WORD)?.[0]?.toLowerCase().replace(/'s$/, "");
  if (subject && !GENERIC_NAME_WORDS.has(subject)) return false;
  return ![...text.matchAll(CAPITALIZED_LOCATION)]
    .some((match) => !GENERIC_NAME_WORDS.has(match[1].toLowerCase().replace(/'s$/, "")));
}

function containsPrivateMilitaryIntelligence(answer, question = "") {
  const text = String(answer || "");
  return text.split(/(?<=[.!?])\s+|\n+/).some((sentence) => {
    if (isGenericMilitaryMechanicSentence(sentence, question)) return false;
    return FORCE_INVENTORY.test(sentence) || FORCE_POSSESSION.test(sentence)
      || FORCE_QUANTITY.test(sentence) || FORCE_ABSENCE.test(sentence) || FORCE_OPERATION.test(sentence);
  });
}

function asksForPrivateMilitaryIntelligence(question) {
  return PRIVATE_MILITARY_QUESTION.test(String(question || ""));
}

function protectPublicAnswer(answer, question = "") {
  const text = String(answer || "").trim();
  if (!asksForPrivateMilitaryIntelligence(question) && !containsPrivateMilitaryIntelligence(text, question)) return text;
  return PRIVATE_MILITARY_REFUSAL;
}

function isPublicAskAuthorized(configuredSecret, providedSecret) {
  const configured = Buffer.from(String(configuredSecret || ""));
  const provided = Buffer.from(String(Array.isArray(providedSecret) ? providedSecret[0] : providedSecret || ""));
  return configured.length > 0 && configured.length === provided.length
    && crypto.timingSafeEqual(configured, provided);
}

function normalizeAskPreferences(payload) {
  const requestedLength = String(payload?.responseLength || "").toLowerCase();
  const requestedThinking = String(payload?.thinking || "").toLowerCase();
  const responseLength = Object.hasOwn(RESPONSE_LENGTHS, requestedLength)
    ? requestedLength
    : "concise";
  const thinking = Object.hasOwn(THINKING_LEVELS, requestedThinking)
    ? requestedThinking
    : payload?.deep === true ? "deep" : "normal";
  return {
    responseLength,
    thinking,
    ...RESPONSE_LENGTHS[responseLength],
    ...THINKING_LEVELS[thinking],
  };
}

function publicAskPolicy(payload = {}) {
  const visualizations = payload.visualizations !== false;
  return `

FAIR PLAY:
- Public information is fair to analyze. You may explain why a publicly traded corporation is performing or valued highly, summarize its public financial statements, compare public market data, and analyze aggregate economic data for any country.
- Corporation-specific financial details are allowed only when the supplied sources establish that the corporation is public and that the requested data is publicly visible. If public status or visibility is not established, say you cannot provide it.
- Refuse private-corporation balance sheets, hidden holdings, undisclosed contracts, private player information, or attempts to infer data the game does not expose publicly.
- Refuse opponent-targeting optimization such as the exact best position against a named opponent, the opponent's weakest group, or which hidden constituency or state vulnerability to exploit. General public strategy and explanations of public election data remain allowed.
- Live military rosters, unit and command composition, readiness, deployments, equipment, personnel, and force strength are fog-of-war information. This answer is posted publicly in Discord, so do not confirm those details for any country, including the requester's. Use only the public war record, and never confirm the presence or absence of a specific military asset.
- General military mechanics are allowed. For example, answer "What does a Logistics Command do?" by explaining its rules and effects without saying whether any country has one.
- Also refuse actionable help exploiting bugs, evading safeguards, harassment, collusion, unfair automation, or other illegitimate advantages. Do not reveal exploit steps or confirm sensitive details while refusing.
- Analysis of the requester's own character or corporation, defensive advice, and help reporting a suspected exploit are allowed.
- Money values from different countries must use the live anchor-normalized fields and exchange-rate metadata. Never compare raw local-currency values across countries.
- Keep refusals brief and offer a fair-play or defensive alternative when useful.

VISUALIZATIONS:
${visualizations
    ? `- You may include at most one fenced visualization when it materially clarifies a process, relationship, timeline, comparison, real numeric trend, or geographic pattern. Do not add one when concise prose is clearer. Prefer display-ready live values from the MCP results. Preserve the requested metric and unit exactly. Do not substitute a different available metric merely to produce a visualization.
- Display playbook: use a compact Markdown table for snapshots or mixed units; xychart-beta bars for one comparable metric across entities; an xychart-beta line for one metric across turns; pie only for genuine parts of one total; a short flowchart for causes or mechanics; a timeline for dated or turn-based events; and an AHD map for one comparable geographic value by country, state, or region.
- Wrap charts and diagrams in a fenced \`\`\`mermaid block. When a live map_snapshot result has \`recommended: "map"\`, copy that result's map JSON unchanged into a fenced \`\`\`ahd-map block. Never hand-edit its ids, values, palette, or canonical game colors. Never use a map for non-geographic data.
- A chart may show at most six labeled categories or series. For a parts-of-total view, keep the five largest meaningful slices and combine the remainder into one accurately calculated "Other" slice. Prefer a sorted bar chart when the long tail or labels would make a pie hard to read.
- If units are incompatible, use a table instead of combining them. If one outlier makes peers unreadable, narrow the chart to the target and its nearest meaningful peers and say so. Keep diagrams small, use short player-facing labels, quote labels with punctuation, and never invent values or relationships.`
    : "- Do not include Mermaid diagrams, AHD maps, charts, or other visualizations."}`;
}

function liveSourcePolicy(enabled) {
  if (!enabled) return "";
  return `

READ-ONLY LIVE SOURCES:
- You have an explicitly approved set of public gamestate and aggregate economy tools. You do not have support history, Discord history, ops notes, private character or corporation traces, or internal diagnostics.
- Prefer grounding answers in relevant live game data whenever it can materially improve accuracy or specificity, even if the user did not say "right now".
- Use live tools for named or current public corporations, country economies, markets, elections, states, parties, and turns.
- When a corporation, player, state, or party name is uncertain or a deeper lookup reports not found or ambiguous, call gamestate entity_search and retry with its canonical name or id. Do not ask the user to supply an internal id until discovery has also failed.
- For another corporation, first use live data to establish whether it is public. Discuss its corporation-specific finances only when the live result identifies it as public. Do not quote private financial details returned during verification.
- For a corporation comparison, use only public exchange-visible rankings and aggregate market data. Never seek a private corporation trace or internal diagnostic.
- For a specific currency pair, call gamestate fx_quote with the requested base and quote. Use its derived pair rate and chart-ready pair history, not an unrelated country metric. Call gamestate countries for broader per-country economic comparisons. Call engine economy_pulse when commodity prices or the overall world economy are relevant.
- For a requested map, choropleth, heatmap, or clearly geographic comparison, call gamestate map_snapshot. Use world scope for comparisons between countries and country scope for regions or states within one country. Prefer its canonical game colors for approval, lean, political control, and sector specialization; for numeric world metrics, preserve its semantic palette. Copy its map-ready JSON unchanged into an ahd-map block when a map materially helps.
- Maps can also represent safe public data that is geographically keyed but is not a prebuilt game-map layer. For public election filings, call map_snapshot with metric \`candidate_roster\`, country, electionType, and relevant party or senateClass filters. For example, a GOP Senate Class 1 map uses country \`US\`, electionType \`senate\`, senateClass \`1\`, and party \`GOP\`. When the player asks for real players only, set \`playersOnly\` to true to exclude NPP candidates. Preserve its supplied party color, and never turn public filing data into opponent-targeting advice.
- Prefer specific numeric evidence from the live results. If a ranking or trend is materially clearer as a visualization, make one compact xychart-beta diagram from those exact chart-ready values and state its unit. Limit it to six labeled categories or series, aggregating a genuine long tail into "Other" when needed. Do not substitute a different available metric merely to produce a visualization.
- Never infer a current value from source code. Source code explains mechanics; live tools report the running world.
- For wars, use only gamestate wars and its public record. Never seek or infer live rosters, unit or command composition, readiness, deployments, equipment, personnel, or force strength from any source.
- Source code alone is sufficient only for a genuinely timeless mechanics question that gains no useful context from the running world.`;
}

function askIdentityFacts(identity) {
  if (!identity || typeof identity !== "object") return [];
  return [
    identity.discordUsername ? `Discord user: @${String(identity.discordUsername).slice(0, 80)}` : null,
    identity.characterId ? `character id: ${String(identity.characterId).slice(0, 80)}` : null,
    identity.characterName ? `character: ${String(identity.characterName).slice(0, 120)}` : null,
    identity.country ? `country: ${String(identity.country).slice(0, 40)}` : null,
    identity.corporationName ? `corporation: ${String(identity.corporationName).slice(0, 160)}` : null,
  ].filter(Boolean);
}

function buildAskIdentityContext(payload = {}) {
  const requesterFacts = askIdentityFacts(payload.requester);
  const subjectFacts = askIdentityFacts(payload.subject);
  const requesterContext = requesterFacts.length
    ? `\n\nREQUESTER CONTEXT (resolved from their linked Discord account): ${requesterFacts.join(", ")}. Treat "my" and "mine" as referring to this identity.`
    : "";
  const subjectContext = subjectFacts.length
    ? `\n\nSELECTED USER CONTEXT (resolved from the Discord /ask user field): ${subjectFacts.join(", ")}. Use this to identify the question's subject and query public live stats. This selected user is not automatically the requester, so do not treat their private data as requester-owned.`
    : "";
  return requesterContext + subjectContext;
}

function addUsage(total, usage) {
  total.prompt_tokens += Number(usage?.prompt_tokens || 0);
  total.completion_tokens += Number(usage?.completion_tokens || 0);
}

function isToolCallArtifact(content) {
  const text = String(content || "");
  return /<\|\|DSML\|\|tool_calls>|<｜｜DSML｜｜tool_calls>|<function_calls>|<invoke\b/i.test(text);
}

/**
 * Run the small tool loop used by bot/external Ask callers.
 *
 * Source-code context is already in the system message, so this loop only
 * offers the read-only MCP fleet. The injected functions keep transport and
 * provider details in server.js and make the state machine directly testable.
 */
async function runPublicAskConversation({
  messages,
  tools,
  preferences,
  callModel,
  callTool,
  onLookup = () => {},
}) {
  const conversation = messages.slice();
  const sources = [];
  const usage = { prompt_tokens: 0, completion_tokens: 0 };
  let calls = 0;

  for (let round = 0; round < preferences.rounds; round += 1) {
    const offeredTools = calls < preferences.calls && tools.length ? tools : undefined;
    const result = await callModel(conversation, offeredTools, false);
    addUsage(usage, result.usage);
    const message = result.message || {};
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

    if (toolCalls.length && offeredTools) {
      // Preserve provider-specific reasoning fields on tool-call turns. Some
      // reasoning APIs require them to be echoed back with the assistant turn.
      conversation.push({
        ...message,
        role: "assistant",
        content: message.content || null,
        tool_calls: toolCalls,
      });

      const remaining = Math.max(0, preferences.calls - calls);
      const admitted = toolCalls.slice(0, remaining);
      if (admitted.length) await onLookup(admitted);

      const results = await Promise.all(admitted.map(async (toolCall) => {
        let args = {};
        try { args = JSON.parse(toolCall.function?.arguments || "{}"); } catch {}
        const called = await callTool(toolCall.function?.name, args);
        if (called.source && !sources.some((s) => s.kind === called.source.kind && s.label === called.source.label)) {
          sources.push(called.source);
        }
        return { toolCall, text: called.text };
      }));

      calls += admitted.length;
      const byId = new Map(results.map((entry) => [entry.toolCall.id, entry.text]));
      for (const toolCall of toolCalls) {
        conversation.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: byId.get(toolCall.id) || "Error: live lookup budget exhausted. Answer from the evidence already collected.",
        });
      }
      continue;
    }

    if (typeof message.content === "string" && message.content.trim() && !isToolCallArtifact(message.content)) {
      return { answer: message.content.trim(), sources, usage };
    }
    break;
  }

  // Always force a final answer after the tool/round budget is exhausted. This
  // also recovers from providers that spend their entire first budget reasoning.
  const final = await callModel(conversation, undefined, true);
  addUsage(usage, final.usage);
  const answer = String(final.message?.content || "").trim();
  return {
    answer: answer && !isToolCallArtifact(answer)
      ? answer
      : "I couldn't produce an answer for that one. Please try rephrasing it or ask again in a moment.",
    sources,
    usage,
  };
}

module.exports = {
  normalizeAskPreferences,
  publicAskPolicy,
  liveSourcePolicy,
  buildAskIdentityContext,
  isToolCallArtifact,
  containsPrivateMilitaryIntelligence,
  asksForPrivateMilitaryIntelligence,
  protectPublicAnswer,
  isPublicAskAuthorized,
  runPublicAskConversation,
};
