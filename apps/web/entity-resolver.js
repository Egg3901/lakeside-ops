"use strict";

const CORPORATE_WORDS = new Set([
  "co", "company", "corp", "corporation", "group", "holdings", "inc",
  "incorporated", "limited", "ltd", "plc",
]);

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^@+/, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function canonicalName(value, kind) {
  const normalized = normalizeName(value);
  if (kind !== "corporation") return normalized;
  const useful = normalized.split(" ").filter((token) => token && !CORPORATE_WORDS.has(token));
  return useful.join(" ") || normalized;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[b.length];
}

function similarity(a, b) {
  const longest = Math.max(a.length, b.length);
  return longest ? 1 - levenshtein(a, b) / longest : 1;
}

function scoreName(query, candidate, kind) {
  const rawQuery = normalizeName(query);
  const rawCandidate = normalizeName(candidate);
  if (!rawQuery || !rawCandidate) return 0;
  if (rawQuery === rawCandidate) return 1;

  const wanted = canonicalName(query, kind);
  const name = canonicalName(candidate, kind);
  if (wanted === name) return 0.99;
  if (wanted.length < 3 || name.length < 3) return 0;

  const wantedTokens = wanted.split(" ");
  const nameTokens = name.split(" ");
  let score = 0.55 + 0.4 * similarity(wanted, name);

  if (nameTokens.length > wantedTokens.length) {
    const prefix = nameTokens.slice(0, wantedTokens.length).join(" ");
    const prefixScore = 0.55 + 0.4 * similarity(wanted, prefix)
      - Math.min(0.14, (nameTokens.length - wantedTokens.length) * 0.035);
    score = Math.max(score, prefixScore);
  }

  if (name.includes(wanted) || wanted.includes(name)) score = Math.max(score, 0.8);
  return Math.max(0, Math.min(1, score));
}

function rankEntityMatches(query, candidates, { kind = "character", limit = 5, threshold = 0.68 } = {}) {
  return candidates
    .filter((candidate) => candidate && candidate.name)
    .map((candidate, index) => ({ candidate, index, score: scoreName(query, candidate.name, kind) }))
    .filter((entry) => entry.score >= threshold)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ candidate, score }) => ({
      ...candidate,
      score: Math.round(score * 1000) / 1000,
    }));
}

function resolveEntityMatch(query, candidates, { kind = "character" } = {}) {
  const ranked = rankEntityMatches(query, candidates, { kind, limit: candidates.length }).map((candidate, index) => ({
    candidate,
    index,
    score: candidate.score,
  }));

  if (!ranked.length) return { status: "not_found", suggestions: [] };

  const suggestions = ranked.slice(0, 5).map(({ candidate, score }) => ({
    ...candidate,
    score: Math.round(score * 1000) / 1000,
  }));
  const [best, second] = ranked;
  if (second && best.score - second.score < 0.025) {
    return { status: "ambiguous", suggestions };
  }
  const plausibleAlternatives = ranked
    .slice(1)
    .filter((entry) => best.score - entry.score <= 0.2)
    .slice(0, 4)
    .map(({ candidate, score }) => ({
      ...candidate,
      score: Math.round(score * 1000) / 1000,
    }));
  return { status: "matched", match: best.candidate, suggestions: plausibleAlternatives };
}

module.exports = { canonicalName, normalizeName, rankEntityMatches, resolveEntityMatch, scoreName };
