"use strict";

const DOMAINS = [
  { id: "onboarding", pattern: /getting.?started|first.?campaign|create.?a.?character|game.?loop|player.?progression/i, required: ["docs", "wiki"] },
  { id: "elections", pattern: /election|primary|campaign|polling|canvass/i, required: ["code", "docs", "wiki"] },
  { id: "legislation", pattern: /bill|legislation|cloture|whip|chamber|congress/i, required: ["code", "docs", "wiki"] },
  { id: "executive", pattern: /cabinet|minister|government.?formation|executive|president|prime.?minister/i, required: ["code", "docs", "wiki"] },
  { id: "parties", pattern: /party|parties|coalition|caucus|npp/i, required: ["code", "docs", "wiki"] },
  { id: "corporations", pattern: /corporat|subsidiar|merger|brand.?loyalty|output.?quality/i, required: ["code", "docs", "wiki"] },
  { id: "markets", pattern: /stock.?market|commodit|market.?system|supply.?agreement|index.?fund/i, required: ["code", "docs", "wiki"] },
  { id: "banking", pattern: /bank|credit|line.?of.?credit|savings|interbank|imf/i, required: ["code", "docs", "wiki"] },
  { id: "fiscal", pattern: /budget|tax|sovereign.?bond|pension|subsid/i, required: ["code", "docs", "wiki"] },
  { id: "monetary", pattern: /currency|fomc|central.?bank|quantitative|money.?supply|inflation/i, required: ["code", "docs", "wiki"] },
  { id: "military", pattern: /military|war|conflict|battle|occupation|defen[cs]e/i, required: ["code", "docs", "wiki"] },
  { id: "crises", pattern: /crisis|default|bailout/i, required: ["code", "docs", "wiki"] },
  { id: "international", pattern: /trade|tariff|embargo|international|bloc|sphere/i, required: ["code", "docs", "wiki"] },
];

function auditCoverage(sources, domains = DOMAINS) {
  const byKind = Object.fromEntries(sources.map(source => [source.kind, source.documents]));
  const coverage = {};
  const gaps = [];
  for (const domain of domains) {
    coverage[domain.id] = {};
    for (const kind of ["code", "docs", "wiki"]) {
      const count = (byKind[kind] || []).filter(document => domain.pattern.test(`${document.path}\n${document.text}`)).length;
      coverage[domain.id][kind] = count;
      if (domain.required.includes(kind) && count === 0) gaps.push({ domain: domain.id, source: kind });
    }
  }
  return { ready: gaps.length === 0, domains: coverage, gaps };
}

module.exports = { DOMAINS, auditCoverage };
