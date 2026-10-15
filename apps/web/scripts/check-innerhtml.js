#!/usr/bin/env node
"use strict";

/**
 * innerHTML safety ratchet.
 *
 * Assigning to innerHTML is not automatically a bug. In this codebase almost
 * every site assigns a constant: either a plain HTML literal, or a literal that
 * the *server* filled in with `${icon(...)}` before the browser ever saw it.
 * Those are inert.
 *
 * The sites that matter are the ones that splice a runtime value — an API error
 * string, a database field, a websocket payload — straight into markup without
 * escaping it. This script finds those and only those, so the number it reports
 * is a number worth acting on.
 *
 * Usage:
 *   node scripts/check-innerhtml.js            # report, exit 1 if over budget
 *   node scripts/check-innerhtml.js --list     # report every finding
 *   node scripts/check-innerhtml.js --baseline # rewrite the budget file
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const budgetFile = path.join(__dirname, "innerhtml-budget.json");

// `ahd-sandbox` is a gitignored vendored checkout of another product, present
// only in the serving tree. Scanning it made the count differ between checkouts.
const SKIP_DIRS = new Set(["node_modules", ".git", "worktrees", "artifacts", "data", "plans", "public", "ahd-sandbox"]);
// Helpers that make a value safe to concatenate into markup.
const ESCAPERS = /^(escapeHtml|escapeAttr|esc|encodeURIComponent|sanitizeHtml)$/;
// Builders that return markup we generated ourselves, not caller data.
const TRUSTED = /^(icon|sparkSVG|IC_[A-Z_]+)$/;

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, files);
    } else if (entry.name.endsWith(".js") && !entry.name.endsWith(".test.js")) {
      files.push(full);
    }
  }
  return files;
}

/** Drop `${ ... }` spans: the server resolves those before the browser runs. */
function stripInterpolations(source) {
  let out = "";
  let index = 0;
  while (index < source.length) {
    if (source[index] === "$" && source[index + 1] === "{") {
      let depth = 1;
      index += 2;
      while (index < source.length && depth > 0) {
        if (source[index] === "{") depth += 1;
        else if (source[index] === "}") depth -= 1;
        index += 1;
      }
      continue;
    }
    out += source[index];
    index += 1;
  }
  return out;
}

/** Drop quoted literals, leaving a placeholder so concatenation is still visible. */
function stripLiterals(source) {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === "'" || char === '"') {
      index += 1;
      while (index < source.length && source[index] !== char) {
        if (source[index] === "\\") index += 1;
        index += 1;
      }
      index += 1;
      out += "@LIT@";
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

/**
 * Collect the operands concatenated into an innerHTML assignment that are
 * neither literals nor passed through an escaper.
 */
function unsafeOperands(expression) {
  const cleaned = stripLiterals(stripInterpolations(expression));
  const findings = [];
  // Every identifier or member/call expression left after literals are gone.
  const pattern = /([A-Za-z_$][\w$]*)\s*(\()?/g;
  let match;
  while ((match = pattern.exec(cleaned))) {
    const name = match[1];
    const isCall = Boolean(match[2]);
    if (name === "LIT") continue;
    if (isCall && (ESCAPERS.test(name) || TRUSTED.test(name))) {
      // Skip the call and everything it wraps — its output is already safe.
      let depth = 1;
      let index = pattern.lastIndex;
      while (index < cleaned.length && depth > 0) {
        if (cleaned[index] === "(") depth += 1;
        else if (cleaned[index] === ")") depth -= 1;
        index += 1;
      }
      pattern.lastIndex = index;
      continue;
    }
    if (ESCAPERS.test(name) || TRUSTED.test(name)) continue;
    findings.push(name);
  }
  return findings;
}

/** The statement assigned to innerHTML, following `+` continuation lines. */
function readAssignment(lines, start) {
  let expression = lines[start].slice(lines[start].indexOf("innerHTML") + "innerHTML".length).replace(/^\s*=/, "");
  let index = start;
  while (/[+=]\s*$/.test(expression.trimEnd()) && index + 1 < lines.length && index - start < 40) {
    index += 1;
    expression += lines[index];
  }
  return { expression, end: index };
}

function scan() {
  const findings = [];
  let total = 0;
  for (const file of walk(root)) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (!/\.innerHTML\s*=[^=]/.test(lines[index])) continue;
      total += 1;
      const { expression } = readAssignment(lines, index);
      if (!expression.includes("+")) continue;
      const unsafe = unsafeOperands(expression);
      if (!unsafe.length) continue;
      findings.push({
        file: path.relative(root, file),
        line: index + 1,
        operands: [...new Set(unsafe)].slice(0, 4),
      });
    }
  }
  return { findings, total };
}

const { findings, total } = scan();
const budget = fs.existsSync(budgetFile) ? JSON.parse(fs.readFileSync(budgetFile, "utf8")) : { max: 0 };

if (process.argv.includes("--baseline")) {
  fs.writeFileSync(budgetFile, `${JSON.stringify({ max: findings.length, note: "innerHTML sites splicing unescaped runtime values. This number may only go down." }, null, 2)}\n`);
  process.stdout.write(`baseline written: ${findings.length}\n`);
  process.exit(0);
}

if (process.argv.includes("--list") || findings.length > budget.max) {
  for (const finding of findings) {
    process.stdout.write(`${finding.file}:${finding.line}  unescaped: ${finding.operands.join(", ")}\n`);
  }
}

process.stdout.write(`innerHTML assignments: ${total} · unescaped runtime values: ${findings.length} · budget: ${budget.max}\n`);

if (findings.length > budget.max) {
  process.stderr.write(`FAIL: ${findings.length - budget.max} new unescaped innerHTML site(s). Escape the value or build the node with src/ui/safeDom.js.\n`);
  process.exit(1);
}
