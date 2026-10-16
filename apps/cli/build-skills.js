"use strict";
// Generate the standalone package from Keir's pinned source of truth.
const fs = require("node:fs");
const path = require("node:path");
const source = path.join(__dirname, "../agent/skills");
const target = path.join(__dirname, "skills");
if (!fs.existsSync(path.join(source, "manifest.json"))) throw new Error("Pack Lakeside Code from the repository so Keir's skills and licenses are included");
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });
console.log("Bundled Keir skills, references, licenses and pinned provenance");
