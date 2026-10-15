"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { classifyGamePath, includeEngineeringDoc } = require("./source-index");

const GAME_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".md"]);
const MAX_FILE_BYTES = 400_000;
const SKIP_GAME_PARTS = new Set(["build", "coverage", "dist", "node_modules", "worktrees"]);
const ENGINEERING_ROOT_FILES = new Set(["CODEBASE_INDEX.md", "reset-and-seed-contract.md"]);

function gitDirectory(repo) {
  const marker = path.join(repo, ".git");
  if (fs.statSync(marker).isDirectory()) return marker;
  const match = fs.readFileSync(marker, "utf8").match(/^gitdir:\s*(.+)$/m);
  if (!match) throw new Error(`invalid git worktree marker: ${marker}`);
  return path.resolve(repo, match[1]);
}

function repositoryRevision(repo) {
  const gitDir = gitDirectory(repo);
  const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
  if (!head.startsWith("ref: ")) return head;
  const ref = head.slice(5);
  const commonMarker = path.join(gitDir, "commondir");
  const commonDir = fs.existsSync(commonMarker)
    ? path.resolve(gitDir, fs.readFileSync(commonMarker, "utf8").trim())
    : gitDir;
  for (const root of [gitDir, commonDir]) {
    const loose = path.join(root, ref);
    if (fs.existsSync(loose)) return fs.readFileSync(loose, "utf8").trim();
    const packed = path.join(root, "packed-refs");
    if (fs.existsSync(packed)) {
      const line = fs.readFileSync(packed, "utf8").split("\n").find(value => value.endsWith(` ${ref}`));
      if (line) return line.split(" ")[0];
    }
  }
  throw new Error(`cannot resolve ${ref} in ${repo}`);
}

function filesBelow(repo, relativeRoot) {
  const start = path.join(repo, relativeRoot);
  if (!fs.existsSync(start)) return [];
  const output = [];
  const visit = (absolute, relative) => {
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const childRelative = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".git" || SKIP_GAME_PARTS.has(entry.name)) continue;
        visit(path.join(absolute, entry.name), childRelative);
      } else if (entry.isFile()) {
        output.push(childRelative);
      }
    }
  };
  visit(start, relativeRoot);
  return output;
}

function includeGameFile(file) {
  const normalized = String(file || "").replace(/\\/g, "/");
  if (!normalized.startsWith("src/")) return false;
  if (!GAME_EXTENSIONS.has(path.extname(normalized))) return false;
  return !normalized.split("/").some(part => SKIP_GAME_PARTS.has(part));
}

function readDocuments(repo, files) {
  const root = path.resolve(repo);
  return files.flatMap(file => {
    const absolute = path.resolve(root, file);
    if (!absolute.startsWith(`${root}${path.sep}`)) throw new Error(`source path escapes repository: ${file}`);
    let stat;
    try { stat = fs.statSync(absolute); } catch { return []; }
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_FILE_BYTES) return [];
    const text = fs.readFileSync(absolute, "utf8");
    return text.trim() ? [{ path: file.replace(/\\/g, "/"), text }] : [];
  });
}

function loadSourceCorpora({ gameRepo, docsRepo }) {
  if (!gameRepo || !docsRepo) throw new Error("gameRepo and docsRepo are required");
  const gameRevision = repositoryRevision(gameRepo);
  const docsRevision = repositoryRevision(docsRepo);
  const gameFiles = filesBelow(gameRepo, "src").filter(includeGameFile);
  const gameDocuments = readDocuments(gameRepo, gameFiles);
  const docsFiles = ["api", "architecture", "design", "engineering"]
    .flatMap(root => filesBelow(docsRepo, root))
    .concat([...ENGINEERING_ROOT_FILES].filter(file => fs.existsSync(path.join(docsRepo, file))))
    .filter(includeEngineeringDoc);
  const docsDocuments = readDocuments(docsRepo, docsFiles);

  const sources = [
    {
      kind: "code",
      repository: "AHDGame",
      revision: gameRevision,
      documents: gameDocuments.filter(document => classifyGamePath(document.path) === "code"),
    },
    {
      kind: "docs",
      repository: "ahd-docs",
      revision: docsRevision,
      documents: docsDocuments,
    },
    {
      kind: "wiki",
      repository: "AHDGame",
      revision: gameRevision,
      documents: gameDocuments.filter(document => classifyGamePath(document.path) === "wiki"),
    },
  ];
  for (const source of sources) {
    if (!source.documents.length) throw new Error(`${source.kind} discovery produced an empty corpus`);
  }
  return sources;
}

function summarizeCoverage(sources) {
  return Object.fromEntries(sources.map(source => {
    const areas = {};
    let bytes = 0;
    for (const document of source.documents) {
      const parts = document.path.split("/");
      const area = source.kind === "code"
        ? parts.slice(0, 2).join("/")
        : source.kind === "docs"
          ? parts[0]
          : document.path.startsWith("src/app/guides/") ? "guides" : "wiki-content";
      areas[area] = (areas[area] || 0) + 1;
      bytes += Buffer.byteLength(document.text);
    }
    return [source.kind, {
      repository: source.repository,
      revision: source.revision,
      files: source.documents.length,
      bytes,
      areas,
    }];
  }));
}

module.exports = { includeGameFile, loadSourceCorpora, repositoryRevision, summarizeCoverage };
