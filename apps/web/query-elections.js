#!/usr/bin/env node
"use strict";
// One-off election type probe. Prefer MONGODB_URI + MONGODB_DB_NAME env vars.
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const { primaryRepoDir } = require("./src/core/paths");

function loadUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const repo = primaryRepoDir();
  if (!repo) return "";
  try {
    const envLocal = path.join(repo, ".env.local");
    for (const line of fs.readFileSync(envLocal, "utf8").split("\n")) {
      const m = line.match(/^MONGODB_URI=(.*)$/);
      if (m) return m[1].trim();
    }
  } catch { /* optional */ }
  return "";
}

const uri = loadUri();
if (!uri) {
  console.error("Set MONGODB_URI (or PRIMARY_REPO_DIR with .env.local)");
  process.exit(1);
}
const dbName = process.env.MONGODB_DB_NAME || "a-house-divided";

const client = new MongoClient(uri, { maxPoolSize: 2 });
client.connect().then(async () => {
  const db = client.db(dbName);
  const types = await db.collection("elections").distinct("electionType");
  console.log("Election types:", types);
  for (const t of types) {
    const completed = await db.collection("elections").countDocuments({ electionType: t, status: "completed" });
    const upcoming = await db.collection("elections").countDocuments({ electionType: t, status: "upcoming" });
    console.log(`  ${t}: completed=${completed} upcoming=${upcoming}`);
  }
  await client.close();
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
