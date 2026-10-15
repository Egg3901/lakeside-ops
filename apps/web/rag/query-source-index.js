#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { createSourceIndex } = require("./source-index");
const { embed } = require("./build-source-index");

async function main() {
  const question = process.argv.slice(3).join(" ").trim();
  const claimType = process.argv[2] || "general";
  if (!question) throw new Error("usage: query-source-index.js <claim-type> <question>");
  const dbPath = process.env.RAG_SOURCE_DB || path.join(__dirname, "index-v2.db");
  const index = createSourceIndex({
    dbPath,
    embedDocuments: embed,
    embedQuery: async text => (await embed([text]))[0],
  });
  const result = await index.search(question, { claimType, topK: 8 });
  process.stdout.write(`${JSON.stringify({
    question,
    claimType,
    hits: result?.hits.map(({ source, repository, revision, path: file, ord, score }) => ({
      source, repository, revision, file, ord, score: Number(score.toFixed(4)),
    })) || [],
  }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
