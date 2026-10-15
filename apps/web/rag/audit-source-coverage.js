#!/usr/bin/env node
"use strict";

const { loadSourceCorpora, summarizeCoverage } = require("./source-corpus");
const { auditCoverage } = require("./coverage-contract");

const gameRepo = process.env.RAG_GAME_REPO;
const docsRepo = process.env.RAG_DOCS_REPO;
if (!gameRepo || !docsRepo) throw new Error("Set RAG_GAME_REPO and RAG_DOCS_REPO before auditing source coverage");
const sources = loadSourceCorpora({ gameRepo, docsRepo });
const report = {
  generatedAt: new Date().toISOString(),
  sources: summarizeCoverage(sources),
  coverage: auditCoverage(sources),
  policy: {
    docs: "api, architecture, design, and engineering Markdown; excludes archives, plans, generated output, audits, and superseded design/wiki.md",
    wiki: "shipped wiki content, page registrations, and player guides; excludes test files",
  },
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.coverage.ready) process.exitCode = 2;
