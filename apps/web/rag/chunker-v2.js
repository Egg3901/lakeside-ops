"use strict";

// Chunker v2: boundary-aware, zero-overlap chunks sized for the embedder.
//
// Why: nomic-embed-text truncates at 2048 tokens (about 5800 chars on this
// corpus, measured 2026-09-05) and the v1 chunker emits blind 6000-char
// slices, so roughly half of the code chunks lost their tail before they
// were embedded. This chunker keeps every chunk body at or under CEILING
// chars and lands boundaries on declaration, section, and line starts.
//
// Code (.ts/.tsx/.js/.jsx/.json): a brace-depth scanner that understands
// strings, template literals (with nested ${} expressions), comments, regex
// literals, and enough JSX not to lose count on this codebase. It yields
// top-level units (each declaration with its leading comments attached).
// A unit over the ceiling splits at the next nesting depth (class members,
// array elements, statements), then at markdown headings inside template
// literals (wiki seed content), then at line boundaries. Adjacent small
// units merge up to TARGET so a chunk keeps its module context
// (split-then-merge; one-chunk-per-function measured worse than sliding
// windows because it strips that context).
//
// Markdown: H1/H2 sections, then H3..H6, then atomic blocks (fenced code,
// tables, lists, paragraphs) that are never split, then lines.
//
// Everything else: line packing to TARGET.
//
// Invariants: chunks concatenate back to the exact input, no chunk body
// exceeds CEILING, and output is a pure function of the input.

const TARGET = 2500;
const CEILING = 3500;
const MIN_PIECE = 300;

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".json"]);
const MD_EXT = new Set([".md", ".mdx", ".markdown"]);

// Scanner states.
const NORMAL = 0, LINE = 1, BLOCK = 2, SQ = 3, DQ = 4, TPL = 5, RX = 6;
const REGEX_AFTER_WORD = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
// Characters after which a "/" starts a regex literal rather than dividing.
// ")" "]" "}" and identifier chars mean division. "<" is excluded so a JSX
// closing tag "</div>" is never read as a regex, and arithmetic operators are
// excluded because "50%/turn" or "+/-" in JSX prose is far more common than a
// regex literal after "%" or "+" in real code.
const REGEX_AFTER_CHAR = new Set("(,=:[!&|?{;>~^".split(""));

function isIdentChar(c) {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === "$";
}

// Does the quote at text[i] close on the same line? JSX prose ("Don't") has
// apostrophes that never close; treating those as strings would swallow the
// braces that follow, so an unterminated quote is read as a plain character.
function quoteClosesOnLine(text, i, quote) {
  for (let j = i + 1; j < text.length; j++) {
    const c = text[j];
    if (c === "\n") return false;
    if (c === "\\") { j++; continue; }
    if (c === quote) return true;
  }
  return false;
}

/**
 * Per-line scan of JS/TS source. Each record carries the nesting depth and
 * lexical state at the START of the line, its indentation, first non-space
 * character, and how many non-comment characters it contains.
 */
function scanCode(text) {
  const lines = [];
  const n = text.length;
  let state = NORMAL;
  let depth = 0;
  const stack = []; // template contexts: {kind: "tpl"} or {kind: "expr", depth}
  let rxClass = false;
  let lastSig = "";
  let word = "";
  let lineStart = 0, lineDepth = 0, lineState = NORMAL, lineTpl = 0, indent = -1, first = "", code = 0;

  const finishLine = end => {
    lines.push({ start: lineStart, end, depth: lineDepth, state: lineState, tpl: lineTpl, indent: indent < 0 ? end - lineStart : indent, first, code });
    lineStart = end; lineDepth = depth; lineState = state; lineTpl = stack.length; indent = -1; first = ""; code = 0;
  };

  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (c === "\n") {
      // A line comment ends here; strings and regexes cannot span lines, so
      // an open one is a mis-read and resets rather than poisoning the file.
      if (state === LINE || state === SQ || state === DQ || state === RX) state = NORMAL;
      finishLine(i + 1);
      continue;
    }
    const ws = c === " " || c === "\t" || c === "\r";
    if (indent < 0 && !ws) { indent = i - lineStart; first = c; }
    const next = text[i + 1];
    switch (state) {
      case LINE:
        break;
      case BLOCK:
        if (c === "*" && next === "/") { state = NORMAL; i++; }
        break;
      case SQ:
      case DQ:
        if (!ws) code++;
        if (c === "\\") { if (next !== "\n") i++; }
        else if (c === (state === SQ ? "'" : '"')) { state = NORMAL; lastSig = "'"; word = ""; }
        break;
      case TPL:
        if (!ws) code++;
        if (c === "\\") { if (next !== "\n") i++; }
        else if (c === "`") { stack.pop(); state = NORMAL; lastSig = "'"; word = ""; }
        else if (c === "$" && next === "{") { stack.push({ kind: "expr", depth }); state = NORMAL; i++; lastSig = "{"; word = ""; }
        break;
      case RX:
        if (!ws) code++;
        if (c === "\\") { if (next !== "\n") i++; }
        else if (rxClass) { if (c === "]") rxClass = false; }
        else if (c === "[") rxClass = true;
        else if (c === "/") { state = NORMAL; lastSig = "'"; word = ""; }
        break;
      default: { // NORMAL
        if (ws) break;
        if (c === "/") {
          // "http://" inside JSX prose is not a comment; "case x:" followed by
          // a comment line is, so only an adjacent ":" disarms the comment.
          if (next === "/" && text[i - 1] !== ":") { state = LINE; break; }
          if (next === "*") { state = BLOCK; i++; break; }
          // "!/re/.test(x)" is a regex; "x! / y" (TS non-null assertion) divides.
          const regex = !lastSig || (word ? REGEX_AFTER_WORD.has(word)
            : lastSig === "!" ? text[i - 1] === "!" : REGEX_AFTER_CHAR.has(lastSig));
          code++;
          if (regex) { state = RX; rxClass = false; break; }
          lastSig = "/"; word = "";
          break;
        }
        code++;
        if (c === "'" || c === '"') {
          if (quoteClosesOnLine(text, i, c)) state = c === "'" ? SQ : DQ;
          lastSig = "'"; word = "";
          break;
        }
        if (c === "`") { stack.push({ kind: "tpl" }); state = TPL; word = ""; break; }
        if (c === "{" || c === "(" || c === "[") depth++;
        else if (c === "}") {
          const top = stack[stack.length - 1];
          if (top && top.kind === "expr" && depth === top.depth) { stack.pop(); state = TPL; lastSig = "'"; word = ""; break; }
          depth--;
        } else if (c === ")" || c === "]") depth--;
        word = isIdentChar(c) ? word + c : "";
        lastSig = c;
      }
    }
  }
  if (lineStart < n) finishLine(n);
  return { lines, balanced: depth === 0 && state === NORMAL && stack.length === 0, depth, state };
}

// A line that opens with a closer or a continuation leader (a generic's
// closing ">", a chained ".", a ternary "?" or ":", a union "|", an
// intersection "&", or a trailing ",") continues the previous statement.
const CONTINUATION = new Set(["}", ")", "]", ">", ".", "?", ":", "|", "&", ","]);
function isCloser(c) {
  return CONTINUATION.has(c);
}

// Top-level unit starts: a line beginning in column 0 at depth 0, outside any
// string, comment, or template literal. Each unit runs to the next start.
function topLevelStarts(lines) {
  const starts = [0];
  for (let k = 1; k < lines.length; k++) {
    const L = lines[k];
    if (L.state !== NORMAL || L.tpl !== 0 || L.depth > 0 || L.indent !== 0 || !L.first || isCloser(L.first)) continue;
    starts.push(k);
  }
  return starts;
}

function piecesFromCuts(from, to, cuts) {
  const pieces = [];
  let a = from;
  for (const k of cuts) { if (k > a && k < to) { pieces.push([a, k]); a = k; } }
  pieces.push([a, to]);
  return pieces;
}

// A piece with no code (comments, blank lines) or that is only decorators
// belongs to what follows it, so a JSDoc travels with its declaration.
function glueForward(pieces, lines, text) {
  const out = [];
  let carry = null;
  for (const [a, b] of pieces) {
    const start = carry === null ? a : carry;
    let hasCode = false;
    for (let k = a; k < b && !hasCode; k++) hasCode = lines[k].code > 0;
    const head = text.slice(lines[a].start, lines[a].end).trimStart();
    if (!hasCode || head.startsWith("@")) { carry = start; continue; }
    out.push([start, b]);
    carry = null;
  }
  if (carry !== null) {
    if (out.length) out[out.length - 1][1] = pieces[pieces.length - 1][1];
    else out.push([carry, pieces[pieces.length - 1][1]]);
  }
  return out;
}

function lineSpan(lines, from, to) {
  return lines[to - 1].end - lines[from].start;
}

// Pack whole lines up to TARGET; a single line over the ceiling is cut at
// TARGET boundaries (this only happens on minified or data-heavy lines).
function sliceLines(lines, from, to) {
  const out = [];
  let a = lines[from].start;
  let cur = 0;
  for (let k = from; k < to; k++) {
    const L = lines[k];
    const len = L.end - L.start;
    if (len > CEILING) {
      if (cur > 0) out.push([a, L.start]);
      for (let s = L.start; s < L.end; s += TARGET) out.push([s, Math.min(L.end, s + TARGET)]);
      a = L.end; cur = 0;
      continue;
    }
    if (cur > 0 && cur + len > TARGET) { out.push([a, L.start]); a = L.start; cur = 0; }
    cur += len;
  }
  if (cur > 0) out.push([a, lines[to - 1].end]);
  return out;
}

// ---------------------------------------------------------------- markdown

const FENCE_RE = /^ {0,3}((?:\\?`){3,}|~{3,})(.*)$/;
const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]|$)/;
const LIST_RE = /^\s*(?:[-*+]|\d{1,9}[.)])[ \t]+\S/;
const TABLE_RE = /^\s*\|/;

function fenceOf(line) {
  const m = FENCE_RE.exec(line);
  if (!m) return null;
  const raw = m[1];
  const ch = raw.includes("`") ? "`" : "~";
  const len = ch === "`" ? raw.split("`").length - 1 : raw.length;
  return { ch, len, rest: m[2] };
}

// Per-line markdown structure. Lines are only "eligible" for structure when
// the caller says so (every line of a .md file; only template-literal lines
// of a code file), so a "# comment" in TS never reads as a heading.
function mdInfo(lines, text, eligible) {
  const count = lines.length;
  const kind = new Uint8Array(count); // 0 text, 1 blank, 2 heading, 3 fence, 4 table, 5 list
  const level = new Uint8Array(count);
  const inFence = new Uint8Array(count);
  let open = null;
  for (let k = 0; k < count; k++) {
    const raw = text.slice(lines[k].start, lines[k].end).replace(/\r?\n$/, "");
    if (!eligible(k)) { kind[k] = 0; continue; }
    const fence = fenceOf(raw);
    if (open) {
      inFence[k] = 1; kind[k] = 3;
      if (fence && fence.ch === open.ch && fence.len >= open.len && !fence.rest.trim()) open = null;
      continue;
    }
    if (fence) { open = fence; inFence[k] = 1; kind[k] = 3; continue; }
    if (!raw.trim()) { kind[k] = 1; continue; }
    const h = HEADING_RE.exec(raw);
    if (h) { kind[k] = 2; level[k] = h[1].length; continue; }
    if (TABLE_RE.test(raw)) { kind[k] = 4; continue; }
    if (LIST_RE.test(raw)) { kind[k] = 5; continue; }
  }
  return { kind, level, inFence };
}

function mdSplit(lines, from, to, lv, info, force) {
  const size = lineSpan(lines, from, to);
  if (!force && size <= CEILING) return [[lines[from].start, lines[to - 1].end]];
  for (let level = lv; level <= 6; level++) {
    const cuts = [];
    for (let k = from + 1; k < to; k++) {
      if (info.kind[k] === 2 && info.level[k] <= level) cuts.push(k);
    }
    if (!cuts.length) continue;
    const pieces = piecesFromCuts(from, to, cuts);
    return pieces.flatMap(([a, b]) => mdSplit(lines, a, b, level + 1, info, false));
  }
  if (size <= CEILING) return [[lines[from].start, lines[to - 1].end]];
  return mdBlocks(lines, from, to, info);
}

// Atomic blocks: a fenced code block, a table, a list (with its indented
// continuations), a paragraph, a heading. Blank lines attach to the block
// before them; a heading attaches to the block after it.
function mdBlocks(lines, from, to, info) {
  const blocks = [];
  const isIndented = k => info.kind[k] === 0 && lines[k].indent >= 2 && lines[k].first;
  let k = from;
  while (k < to) {
    const kind = info.kind[k];
    let end = k + 1;
    let heading = false;
    if (kind === 3) { while (end < to && info.inFence[end]) end++; }
    else if (kind === 2) heading = true;
    else if (kind === 4) { while (end < to && info.kind[end] === 4) end++; }
    else if (kind === 5) {
      for (;;) {
        while (end < to && (info.kind[end] === 5 || isIndented(end))) end++;
        let probe = end;
        while (probe < to && info.kind[probe] === 1) probe++;
        if (probe < to && probe > end && (info.kind[probe] === 5 || isIndented(probe))) { end = probe; continue; }
        break;
      }
    } else if (kind === 1) { while (end < to && info.kind[end] === 1) end++; }
    else { while (end < to && info.kind[end] === 0) end++; }
    if (!heading) while (end < to && info.kind[end] === 1) end++;
    blocks.push({ a: k, b: end, heading });
    k = end;
  }
  // Glue headings (and leading blank runs) forward, then pack to TARGET.
  const out = [];
  let carryStart = null;
  let cur = null;
  const flush = () => { if (cur) out.push(cur); cur = null; };
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const start = carryStart === null ? block.a : carryStart;
    if ((block.heading || info.kind[block.a] === 1) && i < blocks.length - 1) { carryStart = start; continue; }
    carryStart = null;
    const span = lineSpan(lines, start, block.b);
    if (span > CEILING) {
      flush();
      out.push(...sliceLines(lines, start, block.b));
      continue;
    }
    if (cur && cur[1] - cur[0] + span <= TARGET) { cur[1] = lines[block.b - 1].end; continue; }
    flush();
    cur = [lines[start].start, lines[block.b - 1].end];
  }
  flush();
  return out;
}

// ---------------------------------------------------------------- code

function splitDeep(lines, from, to, text, mdLazy) {
  const size = lineSpan(lines, from, to);
  if (size <= CEILING) return [[lines[from].start, lines[to - 1].end]];
  const base = Math.max(0, lines[from].depth);
  // Next nesting depth: class members, array elements, object keys, statements.
  let cands = [];
  let minIndent = Infinity;
  for (let k = from + 1; k < to; k++) {
    const L = lines[k];
    if (L.state !== NORMAL || L.tpl !== 0 || L.depth !== base + 1 || !L.first || isCloser(L.first)) continue;
    cands.push(k);
    if (L.indent < minIndent) minIndent = L.indent;
  }
  cands = cands.filter(k => lines[k].indent === minIndent);
  if (cands.length) {
    const pieces = glueForward(piecesFromCuts(from, to, cands), lines, text);
    if (pieces.length > 1) return pieces.flatMap(([a, b]) => splitDeep(lines, a, b, text, mdLazy));
  }
  // Markdown living inside a template literal (wiki seed content).
  const info = mdLazy();
  let hasHeading = false;
  for (let k = from + 1; k < to && !hasHeading; k++) hasHeading = info.kind[k] === 2;
  if (hasHeading) return mdSplit(lines, from, to, 1, info, false);
  return sliceLines(lines, from, to);
}

function codeRanges(text) {
  const { lines } = scanCode(text);
  if (!lines.length) return [];
  const units = glueForward(piecesFromCuts(0, lines.length, topLevelStarts(lines).slice(1)), lines, text);
  let info = null;
  const mdLazy = () => info || (info = mdInfo(lines, text, k => lines[k].state === TPL));
  return units.flatMap(([a, b]) => splitDeep(lines, a, b, text, mdLazy));
}

function markdownRanges(text) {
  const { lines } = scanPlain(text);
  if (!lines.length) return [];
  const info = mdInfo(lines, text, () => true);
  return mdSplit(lines, 0, lines.length, 2, info, true);
}

function plainRanges(text) {
  const { lines } = scanPlain(text);
  if (!lines.length) return [];
  return sliceLines(lines, 0, lines.length);
}

function scanPlain(text) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "\n") continue;
    lines.push(lineRecord(text, start, i + 1));
    start = i + 1;
  }
  if (start < text.length) lines.push(lineRecord(text, start, text.length));
  return { lines };
}

function lineRecord(text, start, end) {
  let indent = 0;
  let first = "";
  for (let i = start; i < end; i++) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") { indent++; continue; }
    first = c; break;
  }
  return { start, end, depth: 0, state: NORMAL, tpl: 0, indent: first ? indent : end - start, first, code: first ? 1 : 0 };
}

// Greedy split-then-merge: adjacent pieces join while the result stays under
// TARGET; a piece under MIN_PIECE may also join a neighbour up to CEILING so
// a lone closing line or one-line export never becomes its own chunk.
function mergeRanges(ranges) {
  const out = [];
  for (const [s, e] of ranges) {
    if (e <= s) continue;
    const len = e - s;
    const cur = out[out.length - 1];
    if (cur) {
      const curLen = cur[1] - cur[0];
      const fits = curLen + len <= TARGET || ((len < MIN_PIECE || curLen < MIN_PIECE) && curLen + len <= CEILING);
      if (fits) { cur[1] = e; continue; }
    }
    out.push([s, e]);
  }
  return out;
}

// Ranges must tile the text exactly; anything else is a chunker bug.
function assertTiling(ranges, text) {
  let cursor = 0;
  for (const [s, e] of ranges) {
    if (s !== cursor || e <= s) throw new Error(`chunker-v2 produced a gap or overlap at ${cursor}`);
    cursor = e;
  }
  if (cursor !== text.length) throw new Error(`chunker-v2 lost the tail of the document at ${cursor}/${text.length}`);
}

function extensionOf(file) {
  const normalized = String(file || "").replace(/\\/g, "/");
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : base.slice(dot).toLowerCase();
}

/**
 * chunksOf(text, { path, kind }) -> [{ text, ord, total }]
 * Zero overlap; chunks concatenate back to the input; no body over CEILING.
 */
function chunksOf(text, { path = "", kind = "code" } = {}) {
  const value = String(text || "");
  if (!value.trim()) return [];
  const ext = extensionOf(path);
  let ranges;
  if (MD_EXT.has(ext)) ranges = markdownRanges(value);
  else if (CODE_EXT.has(ext)) ranges = codeRanges(value);
  else ranges = plainRanges(value);
  ranges = mergeRanges(ranges);
  assertTiling(ranges, value);
  for (const [s, e] of ranges) {
    if (e - s > CEILING) throw new Error(`chunker-v2 emitted ${e - s} chars for ${path || kind}`);
  }
  return ranges.map(([s, e], ord) => ({ text: value.slice(s, e), ord, total: ranges.length }));
}

/** Top-level unit start offsets for a JS/TS source (exposed for tests). */
function topLevelUnits(text) {
  const { lines, balanced } = scanCode(String(text || ""));
  const units = glueForward(piecesFromCuts(0, lines.length, topLevelStarts(lines).slice(1)), lines, text);
  return { starts: units.map(([a]) => lines[a].start), balanced };
}

module.exports = { chunksOf, topLevelUnits, scanCode, TARGET, CEILING, MIN_PIECE };
