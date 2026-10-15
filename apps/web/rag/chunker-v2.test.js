"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chunksOf, topLevelUnits, scanCode, CEILING, TARGET } = require("./chunker-v2");

const joined = chunks => chunks.map(chunk => chunk.text).join("");
const filler = (label, lines) => Array.from({ length: lines }, (_, i) => `  const ${label}${i} = compute(${label}, ${i}); // padding line ${i}`).join("\n");

// Four declarations around 1,500 chars each: two fit a chunk, four do not,
// so the merge has to pick boundaries.
const CODE = [
  'import { compute } from "./compute";',
  'import type { Thing } from "./types";',
  "",
  "/** alpha doc */",
  "export function alpha(a: Thing) {",
  filler("a", 22),
  "  return a;",
  "}",
  "",
  "/**",
  " * beta doc",
  " */",
  "export async function beta(b: Thing) {",
  filler("b", 22),
  "  return b;",
  "}",
  "",
  "// gamma comment",
  "export class Gamma {",
  filler("g", 22),
  "  method() { return 1; }",
  "}",
  "",
  "export const delta = {",
  filler("d", 22),
  "};",
  "",
].join("\n");

test("code chunks round-trip, respect the ceiling, and keep ord/total", () => {
  const chunks = chunksOf(CODE, { path: "src/lib/example.ts", kind: "code" });
  assert.equal(joined(chunks), CODE);
  assert.ok(chunks.length >= 2);
  chunks.forEach((chunk, index) => {
    assert.equal(chunk.ord, index);
    assert.equal(chunk.total, chunks.length);
    assert.ok(chunk.text.length <= CEILING, `chunk ${index} is ${chunk.text.length} chars`);
  });
});

test("code chunk boundaries land on declaration starts with leading comments attached", () => {
  const chunks = chunksOf(CODE, { path: "src/lib/example.ts", kind: "code" });
  for (const chunk of chunks.slice(1)) {
    assert.match(chunk.text, /^(?:\/\*\*|\/\/|export |import |class |function |const )/, `chunk starts mid-declaration: ${JSON.stringify(chunk.text.slice(0, 40))}`);
  }
  const withBeta = chunks.find(chunk => chunk.text.includes("export async function beta"));
  assert.ok(withBeta.text.includes(" * beta doc"), "JSDoc must travel with its declaration");
  const withGamma = chunks.find(chunk => chunk.text.includes("export class Gamma"));
  assert.ok(withGamma.text.includes("// gamma comment"));
  const { starts } = topLevelUnits(CODE);
  assert.deepEqual(starts.map(offset => CODE.slice(offset, offset + 12)), [
    "import { com", "import type ", "/** alpha do", "/**\n * beta ", "// gamma com", "export const",
  ]);
});

test("scanner survives template literals, regex literals, JSX prose, and URLs", () => {
  const source = [
    "export const tpl = `a ${ { b: 1 }.b } \\` ${`nested ${x}`}`;",
    "export const re = /[/{]+/g.test(s) ? a / b : /}/;",
    "export function Page() {",
    "  return <p>Don't stop {count} at http://example.com/x {more}</p>;",
    "}",
    "export const s = 'it\\'s' + \"{\" + '}';",
    "export const jsx = <Item value={v} />;",
    "",
  ].join("\n");
  const { balanced, starts } = topLevelUnits(source);
  assert.equal(balanced, true);
  assert.equal(starts.length, 5);
  assert.equal(scanCode(source).lines.length, 7);
});

test("an oversized declaration splits at inner boundaries, never above the ceiling", () => {
  const big = ["export const ROWS = [", ...Array.from({ length: 400 }, (_, i) => `  { id: ${i}, name: "row ${i}", value: ${i * 7}, tags: ["a", "b"] },`), "];", ""].join("\n");
  const chunks = chunksOf(big, { path: "src/data/rows.ts", kind: "code" });
  assert.equal(joined(chunks), big);
  assert.ok(chunks.length > 3);
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= CEILING);
    assert.match(chunk.text, /^(?:export const ROWS|  \{ id: \d+)/);
    assert.match(chunk.text, /\n$/, "inner splits land on line boundaries");
  }
  const single = "export const X = " + "x".repeat(9000) + ";\n";
  for (const chunk of chunksOf(single, { path: "a.ts" })) assert.ok(chunk.text.length <= CEILING);
});

test("wiki template literals split at markdown headings", () => {
  const para = "Prose about a mechanic. ".repeat(40);
  const body = ["# Senate", para, "## Cloture", para, para, "## Filibuster", para, "### Detail", para, para].join("\n\n");
  const source = `export const senateContent = \`${body}\`;\n`;
  const chunks = chunksOf(source, { path: "src/lib/seeds/wiki/content/senate.ts", kind: "wiki" });
  assert.equal(joined(chunks), source);
  assert.ok(chunks.length >= 2);
  for (const chunk of chunks.slice(1)) assert.match(chunk.text, /^#{2,3} /);
});

const MD = [
  "# Title",
  "",
  "Intro paragraph. ".repeat(30),
  "",
  "## Section one",
  "",
  "Body one. ".repeat(60),
  "",
  "```ts",
  ...Array.from({ length: 60 }, (_, i) => `const line${i} = ${i}; // inside the fence`),
  "```",
  "",
  "Tail of section one. ".repeat(20),
  "",
  "## Section two",
  "",
  "| a | b |",
  "| - | - |",
  ...Array.from({ length: 80 }, (_, i) => `| ${i} | ${"cell ".repeat(6)} |`),
  "",
  "- item one",
  "  continued",
  "- item two",
  "",
  "### Sub",
  "",
  "Body two. ".repeat(80),
  "",
].join("\n");

test("markdown chunks round-trip, split at headings, and never split a fenced block or table", () => {
  const chunks = chunksOf(MD, { path: "design/senate.md", kind: "docs" });
  assert.equal(joined(chunks), MD);
  assert.ok(chunks.length >= 3);
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= CEILING);
    const fences = (chunk.text.match(/^```/gm) || []).length;
    assert.equal(fences % 2, 0, "a fence opened in a chunk closes in the same chunk");
  }
  const fenced = chunks.filter(chunk => chunk.text.includes("inside the fence"));
  assert.equal(fenced.length, 1, "the fenced block stays in exactly one chunk");
  const table = chunks.filter(chunk => /^\| \d+ \|/m.test(chunk.text));
  assert.equal(table.length, 1, "the table stays in exactly one chunk");
  for (const chunk of chunks.slice(1)) assert.match(chunk.text, /^(?:#{1,6} |\| |Body|Tail|- )/);
});

test("markdown headings inside fenced code are not section boundaries", () => {
  const md = ["## Real", "", "```bash", "# not a heading", "## also not", "```", "", "text", ""].join("\n");
  const chunks = chunksOf(md, { path: "x.md" });
  assert.equal(chunks.length, 1);
});

test("json and unknown extensions pack whole lines to the target", () => {
  const json = "{\n" + Array.from({ length: 300 }, (_, i) => `  "key${i}": {"value": ${i}, "label": "${"x".repeat(20)}"}${i < 299 ? "," : ""}`).join("\n") + "\n}\n";
  const chunks = chunksOf(json, { path: "src/data/x.json" });
  assert.equal(joined(chunks), json);
  for (const chunk of chunks) { assert.ok(chunk.text.length <= CEILING); assert.match(chunk.text, /\n$/); }
  const plain = Array.from({ length: 200 }, (_, i) => `line ${i} ${"y".repeat(30)}`).join("\n");
  const other = chunksOf(plain, { path: "notes.txt" });
  assert.equal(joined(other), plain);
  for (const chunk of other.slice(0, -1)) { assert.ok(chunk.text.length <= TARGET); assert.match(chunk.text, /\n$/); }
});

test("output is deterministic and has zero overlap", () => {
  const a = chunksOf(CODE, { path: "a.ts" });
  const b = chunksOf(CODE, { path: "a.ts" });
  assert.deepEqual(a, b);
  assert.deepEqual(chunksOf(MD, { path: "a.md" }), chunksOf(MD, { path: "a.md" }));
  assert.equal(chunksOf("", { path: "a.ts" }).length, 0);
  assert.equal(chunksOf("   \n\n", { path: "a.ts" }).length, 0);
});

// Corpus sweep: every file the builder indexes must round-trip, stay under
// the ceiling, and (for JS/TS) leave the scanner balanced on nearly every
// file. Skipped when the retrieval checkout is not on this box.
const GAME_REPO = process.env.RAG_GAME_REPO || "/root/projects/LSGD-ops-dash/ahd-sandbox";
test("sandbox corpus: round-trip, ceiling, and scanner balance", { skip: !fs.existsSync(path.join(GAME_REPO, "src")) }, () => {
  const { includeGameFile } = require("./source-corpus");
  const files = [];
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "node_modules") visit(absolute); continue; }
      const relative = path.relative(GAME_REPO, absolute);
      if (includeGameFile(relative) && fs.statSync(absolute).size <= 400_000) files.push(relative);
    }
  };
  visit(path.join(GAME_REPO, "src"));
  assert.ok(files.length > 1000);
  let unbalanced = 0, scanned = 0;
  for (const file of files) {
    const text = fs.readFileSync(path.join(GAME_REPO, file), "utf8");
    if (!text.trim()) continue;
    const chunks = chunksOf(text, { path: file, kind: "code" });
    assert.equal(joined(chunks), text, `round-trip failed for ${file}`);
    for (const chunk of chunks) assert.ok(chunk.text.length <= CEILING, `${file} chunk over ceiling`);
    if (/\.[jt]sx?$/.test(file)) { scanned++; if (!scanCode(text).balanced) unbalanced++; }
  }
  assert.ok(unbalanced / scanned < 0.01, `${unbalanced}/${scanned} JS/TS files left the scanner unbalanced`);
});
