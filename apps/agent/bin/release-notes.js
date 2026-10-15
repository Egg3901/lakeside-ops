#!/usr/bin/env node
// Print one version's CHANGELOG section as GitHub release notes.
//   bin/release-notes.js <version> [CHANGELOG.md]
// Exits 2 when the changelog has no section for that version.
const fs = require("fs");
const path = require("path");

const version = String(process.argv[2] || "").replace(/^v/, "");
const file = process.argv[3] || path.join(__dirname, "..", "CHANGELOG.md");
const text = fs.readFileSync(file, "utf8");
const heading = new RegExp(`^## ${version.replace(/\./g, "\\.")} \\(([^)]+)\\)\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(text);
if (!version || !heading) process.exit(2);
process.stdout.write(`Released ${heading[1]}.\n\n${heading[2].trim()}\n`);
