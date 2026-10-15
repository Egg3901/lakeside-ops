"use strict";

const path = require("path");

const ASK_IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".next",
  ".git",
  "coverage",
  "dist",
  "out",
  "e2e",
  "__tests__",
  "audit-reports",
  "docs",
  "plans",
  "design",
  "memory",
  ".claude",
  "shared",
  "scripts",
  "public",
]);

const QUERY_ALIASES = [
  {
    pattern: /\bstaats?\s*(?:raar|raad|rat)\b/i,
    terms: "Staatsrat Council of State GDR East Germany Volkskammer",
  },
];

/** Add canonical game terms for common player spellings and speech transcriptions. */
function normalizeAskRetrievalQuery(question) {
  const original = String(question || "");
  const expansions = QUERY_ALIASES
    .filter(({ pattern }) => pattern.test(original))
    .map(({ terms }) => terms);
  return expansions.length ? `${original} ${expansions.join(" ")}` : original;
}

/** The seeded wiki is player-facing mechanics knowledge and belongs in Ask search. */
function shouldIndexAskDirectory(name) {
  const directory = String(name || "");
  return Boolean(directory) && !directory.startsWith(".") && !ASK_IGNORED_DIRECTORIES.has(directory);
}

/** Put compact player-facing mechanics sources ahead of the general file cap. */
function getAskSearchRoots(sandboxDir) {
  return [
    path.join(sandboxDir, "src/lib/seeds/wiki/content"),
    sandboxDir,
  ];
}

module.exports = {
  getAskSearchRoots,
  normalizeAskRetrievalQuery,
  shouldIndexAskDirectory,
};
