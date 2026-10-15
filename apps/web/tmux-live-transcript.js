"use strict";

// Parse raw tmux pane captures from live agent CLIs into a conversation-shaped
// transcript: user bubble, light thinking/status, rich tool cards, and answer
// prose. Used by the live agent web view so Cursor/Codex/Claude/Kimi feel like
// the non-live Code Agent UI instead of a terminal dump.

const TOOL_VERBS = Object.freeze({
  read: "Read",
  grepped: "Grep",
  searched: "Search",
  listed: "List",
  deleted: "Delete",
  edited: "Edit",
  wrote: "Write",
  created: "Create",
  ran: "Shell",
  explored: "Explore",
  used: "Tool",
  using: "Tool",
  websearch: "Search",
  called: "Tool",
  calling: "Tool",
  viewed: "View",
  globbed: "List",
  running: "Shell",
  thinking: "Think",
});

const CURSOR_TOOL_RE = /^(?:Edited|Wrote|Created|Read|Grepped|Searched|Listed|Deleted|Globbed|Used|WebSearch|Explored|Called)\s+(.+)$/i;
const CURSOR_MCP_TOOL_RE = /^\s{4,}([a-z][\w-]*)\s+([a-z][\w]*(?:_[a-z][\w]*)+)\s*$/i;
const CURSOR_PLAN_UPDATE_RE = /^plan updated$/i;
const CURSOR_SUMMARY_RE = /^(?:Read|Wrote|Edited|Created|Grepped|Searched|Listed|Deleted|Globbed|Found|Used)[, ].+\b(?:files?|greps?|globs?|matches?|references?|tools?)\b/i;
const CURSOR_FOUND_RE = /^Found\s+\d+\s+(?:matches?|references?)(?:\s+\(truncated\))?$/i;
const CURSOR_STATUS_RE = /^(?:Reading|Explored|Exploring|Running|Thinking|Searching|Listing|Resetting|Updating|Checking|Inspecting|Fixing|Wiring)\b.{0,100}$/i;
const CURSOR_SWITCH_MODE_RE = /^SwitchMode\s*(?:→|->)\s*(.+?)\s+Mode\s+switch\s+approved\s*$/i;
// Cursor sometimes glues mode-switch chrome into the padded user echo:
//   "my question SwitchMode → Plan Mode switch approved <plan overview>"
const SWITCH_MODE_IN_TEXT_RE = /\bSwitchMode\s*(?:→|->)\s*.+?\s*Mode\s+switch\s+approved\b/i;
const CODEX_TOOL_RE = /^\s*[•●]\s+(Ran|Read|Searched|Explored|Edited|Wrote|Created|Used|Using|Listed|Deleted|Called|Calling|Viewed)\b(.*)$/i;
const CODEX_STATUS_RE = /^\s*[•●]\s+(Working|Waiting|Thinking)\b(.*)$/i;
const CODEX_ANSWER_RE = /^\s*[•●]\s+(?!(?:Working|Waiting|Thinking|Ran|Read|Searched|Explored|Edited|Wrote|Created|Used|Using|Listed|Deleted|Called|Calling|Viewed)\b)(.+)$/i;
const USER_PROMPT_RE = /^\s*[›❯✨]\s+(\S.*)$/;
const MOON_SPINNER_RE = /^[🌑🌒🌓🌔🌕🌖🌗🌘]\s*$/u;
const KIMI_STATUS_SPINNER_RE = /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*(?:Thinking|Composing)\.\.\./i;
// Agents may print `STATUS: <one line>` (or Progress: / Working on:) anytime;
// the /code list and conversation chips prefer that over derived tool tallies.
const EXPLICIT_STATUS_RE = /^(?:STATUS|Progress|Working on)\s*:\s*(.+)$/i;
// SGR sequences from a styled (`-e`) tmux capture. Stripped for content, but
// mined first for structure: kimi renders its thinking stream italic+grey50
// and section headings bold+underline, which lets the parser tell thinking
// apart from the agent's actual responses.
const ESCAPE_SEQ_RE = /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\([A-Za-z0-9]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g;
const KIMI_THINK_STYLE_RE = /\x1b\[(?:3|0;3)m\x1b\[38;5;24\dm/;
const KIMI_HEADING_STYLE_RE = /\x1b\[1;4m/;
const INTERNAL_AGENT_MARKER_RE = /<!--\s*END_READY\s*-->/gi;

function stripTmuxEscapes(value) {
  return String(value || "").replace(ESCAPE_SEQ_RE, "");
}

function clipStatus(text, max = 140) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

function classifyPaneLine(raw) {
  // Only look at codes that precede the first visible character — inline
  // styling mid-line (e.g. an italic word in a response) must not count.
  const head = (String(raw).match(/^((?:\x1b\[[0-9;]*m|[\s•●])*)/) || ["", ""])[1];
  return {
    thinking: KIMI_THINK_STYLE_RE.test(head),
    heading: KIMI_HEADING_STYLE_RE.test(head),
  };
}

function enrichKimiLine(raw) {
  // Reconstruct the markdown the CLI already rendered away: inline code
  // (bold bright cyan) and bold spans become `code` / **bold** again so the
  // web view can format them properly.
  return String(raw)
    .replace(/\x1b\[1m\x1b\[96m([^\x1b]+?)\x1b\[0m/g, "`$1`")
    .replace(/\x1b\[1m([^\x1b]+?)\x1b\[0m/g, "**$1**");
}
// Kimi renders tool calls as `• Used Shell (…)` when finished and with a
// braille spinner as `⠏ Using Shell (…)` while running.
const KIMI_TOOL_RE = /^\s*[•●]\s+Used\s+([A-Za-z][A-Za-z0-9]*)\s*\((.*)$/;
const KIMI_LIVE_TOOL_RE = /^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⠘⠤⠀⠞]\s*Using\s+([A-Za-z][A-Za-z0-9]*)\s*\((.*)$/;
const KIMI_TOOL_VERBS = Object.freeze({
  shell: "Shell",
  readfile: "Read",
  readmediafile: "Read",
  grep: "Grep",
  glob: "List",
  writefile: "Write",
  strreplacefile: "Edit",
  searchweb: "Search",
  fetchurl: "Search",
  agent: "Explore",
  settodolist: "Plan",
  tasklist: "Plan",
  taskoutput: "Shell",
  askuserquestion: "Ask",
});
// Kimi prefixes every assistant prose line with `• ` at column 0; the agent's
// own markdown list items arrive indented (`  • item`). Only indented bullets
// are real list items — col-0 bullets are prose (handled by CODEX_ANSWER_RE).
const KIMI_BULLET_RE = /^•\s+(?!(?:Used|Using)\b)(.+)$/;
const KIMI_INDENTED_BULLET_RE = /^\s+•\s+(?!(?:Used|Using)\b)(.+)$/;
const PLACEHOLDER_PROMPT_RE = /(?:Explain this codebase|Implement \{feature\}|Write tests for @filename|Use \/skills|Improve documentation in @filename)/i;
const BOX_LINE_RE = /^[\s─━│╭╮╰╯└┘┌┐├┤]*[─━│╭╮╰╯└┘┌┐├┤][\s─━│╭╮╰╯└┘┌┐├┤]*$/;
const TREE_LINE_RE = /^\s*[│└├─┌┐┘┌╭╮╰╯]\s*/;
// Claude status chrome. The verb is randomised every turn, so the shape is what
// identifies it: an ellipsis while the turn runs, "for <duration>" once it ends.
const CLAUDE_SPINNER_LINE_RE = /^[✻✳✽✢✶*]\s+[^\s…]+…/;
const CLAUDE_DONE_LINE_RE = /^[✻✳✽✢✶*]\s+\S+\s+for\s+\d/i;
const CLAUDE_MODE_FOOTER_LINE_RE = /^[⏵⏸►▶]{0,2}\s*(?:auto|plan|accept edits|bypass(?:ing)?\s+permissions?)\s+mode\s+on\b/i;

function isPlaceholderPrompt(text) {
  return PLACEHOLDER_PROMPT_RE.test(String(text || ""));
}

function stripAttachedImageNote(text) {
  return String(text || "")
    .replace(/\s*\[Attached images?(?: saved)? for (?:your )?analysis:\s*[\s\S]*?\]\s*$/i, "")
    .trim();
}

// Cursor Agent paints mode switches into the user-echo region. Keep only the
// human text before the SwitchMode marker so bubbles / task excerpts stay clean.
function sanitizeUserFacingText(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const match = raw.match(SWITCH_MODE_IN_TEXT_RE);
  if (!match) return raw;
  const cut = raw.search(SWITCH_MODE_IN_TEXT_RE);
  return (cut >= 0 ? raw.slice(0, cut) : raw).trim();
}

function attachedImageFiles(text) {
  return [...String(text || "").matchAll(/\/tmp\/(ops-agent-\d+-[a-f0-9]{10}\.(?:png|jpg|webp|gif))/gi)]
    .map((match) => match[1]);
}

function shortPath(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const bare = text.replace(/^["'`]|["'`]$/g, "");
  const file = bare.split(/\s+/)[0] || "";
  if (!file) return bare.slice(0, 72);
  const parts = file.split("/").filter(Boolean);
  if (parts.length <= 2) return file;
  return parts.slice(-2).join("/");
}

function compactDetail(verb, detail) {
  const raw = String(detail || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  if (/^shell$/i.test(verb) || /^ran$/i.test(verb)) {
    const cmd = raw.replace(/^[|:]\s*/, "").trim();
    return cmd.length > 88 ? `${cmd.slice(0, 85)}…` : cmd;
  }
  const pathish = raw.match(/(\/[^\s]+|\S+\.[A-Za-z0-9]{1,8}\b)/);
  if (pathish) {
    const short = shortPath(pathish[1]);
    const delta = raw.match(/[+][\d,]+(?:\s+-[\d,]+)?/);
    return delta ? `${short} ${delta[0]}` : short;
  }
  return raw.length > 88 ? `${raw.slice(0, 85)}…` : raw;
}

function kimiToolVerb(name) {
  return KIMI_TOOL_VERBS[String(name || "").toLowerCase()] || String(name || "Tool");
}

function kimiToolDetail(raw) {
  return String(raw || "").replace(/\)\s*$/, "").trim();
}

function toolItem(verb, detail, extra = {}) {
  const label = TOOL_VERBS[String(verb || "").toLowerCase()] || String(verb || "Tool");
  const args = compactDetail(label, detail);
  return {
    verb: label,
    detail: String(detail || "").trim(),
    args,
    output: String(extra.output || "").trim(),
    running: !!extra.running,
  };
}

function isChromeLine(line, kind) {
  const t = line.trim();
  if (!t) return true;
  if (BOX_LINE_RE.test(t)) return true;
  if (/^→ Add a follow-up$/i.test(t)) return true;
  if (/truncated.*ctrl\+r to review/i.test(t)) return true;
  if (/^\d+ background terminals? running\b/i.test(t)) return true;
  if (/^context:\s*[\d.]+%/i.test(t)) return true;
  if (/^↑ to edit · ctrl-s to send immediately$/i.test(t)) return true;
  if (/^(?:[✻•]\s*)?[─━-]*\s*Worked for\b/i.test(t)) return true;
  if (/^›\s*(Explain this codebase|Implement \{feature\}|Write tests for @filename|Use \/skills)/i.test(t)) return true;
  if (/^gpt-[\w.-]+\s+(?:default|low|medium|high|xhigh|max|ultra)\s+·\s+/i.test(t)) return true;
  if (/^yolo\s+.*agent\s*\(/i.test(t)) return true;
  // Cursor footer: "Cursor Grok 4.5 High · 65.9% · 7 files edited   Run Everything"
  if (/^Cursor\s+.+\s+[·•|]\s+[\d.]+%/i.test(t)) return true;
  if (/^(Run Everything|Auto-review|Ask|Plan)$/i.test(t)) return true;
  if (/^(Low|Medium|High|Max)$/i.test(t)) return true;
  if (/^~+$/.test(t)) return true;
  if (/[▎]/.test(line)) return true;
  // Claude's own chrome. The live status line ends in an ellipsis
  // ("✻ Channelling… (27s · ↑ 1.4k tokens)") and the completion line reads
  // "✻ Cooked for 1h 21m 50s"; both were previously rendered as agent prose,
  // as were the mode footer under the composer and the hints beside it.
  if (CLAUDE_SPINNER_LINE_RE.test(t)) return true;
  if (CLAUDE_DONE_LINE_RE.test(t)) return true;
  if (CLAUDE_MODE_FOOTER_LINE_RE.test(t)) return true;
  if (/^[⏵⏸►▶]{1,2}\s*Tip:\s+/i.test(t)) return true;
  if (/^Still working\.\s+Check in from your phone/i.test(t)) return true;
  if (/^\d+\s+shells?\s+(?:still\s+)?running\b/i.test(t)) return true;
  // Todo headers/items are parsed into task panels — keep them out of chrome.
  if (/^…\s*\d+\s+(input|output)\s+lines?\s+hidden/i.test(t)) return true;
  if (/^…\s*\d+\s+input\s*\+\s*\d+\s+output/i.test(t)) return true;
  if (/^Cursor Agent$/i.test(t)) return true;
  if (/^v\d{4}\.\d{2}\.\d{2}/i.test(t)) return true;
  if (/^Tip:\s+/i.test(t)) return true;
  if (kind === "cursor" && /^\[Pasted text\b/i.test(t)) return true;
  if (kind === "cursor" && /^┌─\s*follow-ups\b/i.test(t)) return true;
  if (kind === "cursor" && /^│/.test(t)) return true;
  if (kind === "cursor" && /^└─/.test(t)) return true;
  // Follow-up suggestion chips use ○; todo items also use ○ — todo scanner
  // claims real tasks, so only hide short non-task suggestion chips here.
  if (kind === "cursor" && /^○\s+/.test(t) && t.length < 100 && !isTodoItemLine(t)) return true;
  if (kind === "cursor" && /^→ Add a follow-up\b/i.test(t)) return true;
  if (kind === "cursor" && /^ctrl\+c to stop$/i.test(t)) return true;
  if (kind === "cursor" && /^\d+ tasks?$/i.test(t)) return true;
  // Spinner + token-count chrome stays out of the conversation. Meaningful
  // Cursor status lines ("Explored auth module", "Searching for X") are kept
  // and rendered as thinking chips — see CURSOR_STATUS_RE handling below.
  if (/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⠘⠤⠀⠞⣾⣷⣯⣟⡿⢿⣻⣽]\s*/.test(t) && /(?:Running|Thinking|Working|Grepping|Reading|Searching|Listing)\b/i.test(t)) return true;
  if (/^(?:Running|Thinking|Working|Grepping|Reading|Searching|Listing)\b.*\b[\d.]+k?\s*tokens?\b/i.test(t)) return true;
  if (/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⠘⠤⠀⠞⣾⣷⣯⣟⡿⢿⣻⣽]?\s*(?:Running|Thinking|Working)\b.{0,40}$/i.test(t) && t.length < 60) return true;
  if (CURSOR_SUMMARY_RE.test(t) || CURSOR_FOUND_RE.test(t)) return true;
  if (kind === "kimi" && /^input\b/i.test(t)) return true;
  if (kind === "kimi" && /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*Thinking\b/i.test(t)) return true;
  if (kind === "kimi" && /\b[\d.]+k?\s*tokens?\b/i.test(t) && t.length < 80) return true;
  if (kind === "kimi" && MOON_SPINNER_RE.test(t)) return true;
  if (kind === "kimi" && KIMI_STATUS_SPINNER_RE.test(t)) return true;
  if (kind === "kimi" && /Compacting\.\.\./i.test(t)) return true;
  return false;
}

function isTodoHeaderLine(text) {
  const t = String(text || "").trim().replace(/^[•●]\s+/, "");
  return /^To-?dos?\b/i.test(t)
    || /^Tasks?\b/i.test(t)
    || /^(?:Update Todos|TodoWrite|SetTodoList|TaskCreate|TaskUpdate)\b/i.test(t);
}

function isTodoItemLine(text) {
  const t = String(text || "").trim();
  if (/^[◐○✔✓●☐☑☒]\s+\S/.test(t)) return true;
  if (/^[-*]\s*\[[ xX✓✔]\]\s+\S/.test(t)) return true;
  if (/^(?:in_progress|pending|completed|cancelled)\s*[:\-–]\s*\S/i.test(t)) return true;
  return false;
}

function todoStatusFromMarker(raw) {
  const t = String(raw || "").trim();
  if (/^[✔✓☑☒]/.test(t) || /^[-*]\s*\[[xX✓✔]\]/.test(t) || /^completed\b/i.test(t)) return "completed";
  if (/^[◐●]/.test(t) || /^in_progress\b/i.test(t)) return "in_progress";
  if (/^cancelled\b/i.test(t)) return "cancelled";
  return "pending";
}

function todoTextFromLine(raw) {
  return String(raw || "")
    .trim()
    .replace(/^[◐○✔✓●☐☑☒]\s+/, "")
    .replace(/^[-*]\s*\[[ xX✓✔]\]\s+/, "")
    .replace(/^(?:in_progress|pending|completed|cancelled)\s*[:\-–]\s*/i, "")
    .trim();
}

function parseTodoItems(lines, start, kind) {
  const items = [];
  let j = start;
  while (j < lines.length) {
    const raw = String(lines[j] || "");
    const t = raw.trim();
    if (!t) {
      if (items.length) break;
      j += 1;
      continue;
    }
    if (!isTodoItemLine(t)) break;
    const itemIndent = (raw.match(/^\s*/) || [""])[0].length;
    const item = { status: todoStatusFromMarker(t), text: todoTextFromLine(t) };
    j += 1;
    while (j < lines.length) {
      const continuation = String(lines[j] || "");
      const nt = continuation.trim();
      const indent = (continuation.match(/^\s*/) || [""])[0].length;
      if (!nt || isTodoItemLine(nt) || isTodoHeaderLine(nt) || indent < itemIndent + 2) break;
      if (isChromeLine(continuation, kind) || CURSOR_TOOL_RE.test(nt) || CURSOR_MCP_TOOL_RE.test(continuation)
        || CURSOR_SUMMARY_RE.test(nt) || CURSOR_STATUS_RE.test(nt) || /^\$\s/.test(nt) || /^SwitchMode\b/i.test(nt)) break;
      item.text = `${item.text} ${nt}`.replace(/\s+/g, " ").trim();
      j += 1;
    }
    items.push(item);
  }
  return { items, next: j };
}

function pushTasks(blocks, title, items) {
  const list = (items || []).filter((item) => item && item.text);
  if (!list.length) return;
  const last = blocks[blocks.length - 1];
  if (last && last.type === "tasks") {
    last.title = title || last.title;
    last.items = list;
    return;
  }
  blocks.push({ type: "tasks", title: title || "Tasks", items: list });
}

function pushMode(blocks, modeName, detail) {
  const label = String(modeName || "Mode").replace(/\s+/g, " ").trim() || "Mode";
  const id = /^plan\b/i.test(label) ? "plan" : (/^ask\b/i.test(label) ? "ask" : "agent");
  blocks.push({
    type: "mode",
    id,
    label,
    detail: String(detail || "").replace(/\s+/g, " ").trim(),
  });
}

/**
 * Blank out Claude's composer so unsent text is not mistaken for a sent message.
 *
 * The composer is drawn as `❯ <draft>` inside a bordered box below the
 * transcript, and it uses the very same marker as the echo of a message that was
 * actually sent. Left alone, anything half-typed opens a brand new turn — and
 * because it is the newest turn with no agent output under it, the answer to the
 * previous message stops being displayed at all.
 *
 * Returns the lines with the box interior cleared, plus the draft text.
 */
function extractComposerDraft(lines) {
  const kept = Array.isArray(lines) ? lines.slice() : [];
  const borders = [];
  for (let i = kept.length - 1; i >= 0 && borders.length < 2; i -= 1) {
    const t = String(kept[i]).trim();
    if (t && BOX_LINE_RE.test(t)) borders.push(i);
  }
  if (borders.length < 2) return { lines: kept, draft: "" };
  const [close, open] = borders;
  const interior = [];
  for (let i = open + 1; i < close; i += 1) {
    if (String(kept[i]).trim()) interior.push(i);
  }
  // Only a box whose first line carries the prompt marker is the composer.
  if (!interior.length || !USER_PROMPT_RE.test(kept[interior[0]])) return { lines: kept, draft: "" };
  const draft = interior
    .map((index) => String(kept[index]).replace(USER_PROMPT_RE, "$1").trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  for (const index of interior) kept[index] = "";
  return { lines: kept, draft };
}

function detectBusy(kind, lines) {
  // Match isOutputBusy: only the live chrome near the bottom. Older Working /
  // interrupt lines in scrollback must not keep the UI stuck on THINKING.
  const tail = lines.slice(-18).join("\n");
  // The randomised verb cannot be enumerated; "…" means running, "for 4m 2s"
  // means the turn already finished.
  if (kind === "claude") return /(?:esc to interrupt|[✻✳✽✢✶*]\s+[^\s…]+…)/i.test(tail);
  if (kind === "kimi") return /(?:esc to interrupt|●\s+\w+ing\b|[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*\w+|[🌑🌒🌓🌔🌕🌖🌗🌘])/i.test(tail);
  if (kind === "cursor") return /(?:esc to interrupt|[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*\w+|Running\b|Thinking\b)/i.test(tail);
  return /(?:•\s+Working\b|esc to interrupt|[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*\w+ing\b|shell still running)/i.test(tail);
}

function pushText(blocks, type, text) {
  let cleaned = String(text || "")
    .replace(INTERNAL_AGENT_MARKER_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned) return;
  // Drop trailing CLI chrome that sometimes glues onto the last prose chunk
  // (footer model/context line, token counters, spinner status). Do not apply
  // this to thinking chips — those are intentionally status-shaped.
  if (type === "text") {
    cleaned = cleaned
      .replace(/(?:^|\n)\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⠘⠤⠀⠞⣾⣷⣯⣟⡿⢿⣻⣽]?\s*(?:Running|Thinking|Working|Grepping|Reading)\b[^\n]*$/gi, "")
      .replace(/(?:^|\n)\s*Cursor\s+.+\s+[·•|]\s+[\d.]+%[^\n]*$/gi, "")
      .replace(/(?:^|\n)\s*context:\s*[\d.]+%[^\n]*$/gi, "")
      .replace(/(?:^|\n)\s*gpt-[\w.-]+\s+(?:default|low|medium|high|xhigh|max|ultra)\s+·\s+[^\n]*$/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  if (!cleaned) return;
  const last = blocks[blocks.length - 1];
  if (last && last.type === type) {
    last.text = `${last.text}\n\n${cleaned}`.trim();
    return;
  }
  blocks.push({ type, text: cleaned });
}

function pushTool(blocks, item) {
  const last = blocks[blocks.length - 1];
  if (last && last.type === "tools") {
    const prev = last.items[last.items.length - 1];
    if (prev && prev.verb === item.verb && prev.args === item.args) {
      // A completed `Used X` after a running `Using X` is the same tool —
      // flip it to done instead of dropping the update.
      if (prev.running && !item.running) prev.running = false;
      return;
    }
    last.items.push(item);
    return;
  }
  blocks.push({ type: "tools", items: [item] });
}

function flushTools(blocks) {
  // no-op helper for readability at call sites
  return blocks;
}

function dedupeRepeatedTailBlocks(blocks) {
  let list = Array.isArray(blocks) ? blocks.slice() : [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let size = Math.floor(list.length / 2); size >= 3; size -= 1) {
      const first = list.slice(list.length - (size * 2), list.length - size);
      const second = list.slice(list.length - size);
      if (JSON.stringify(first) !== JSON.stringify(second)) continue;
      list = list.slice(0, list.length - (size * 2)).concat(second);
      changed = true;
      break;
    }
  }
  return list;
}

function dedupeRepeatedTailLines(lines) {
  let list = Array.isArray(lines) ? lines.slice() : [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let size = Math.floor(list.length / 2); size >= 3; size -= 1) {
      const first = list.slice(list.length - (size * 2), list.length - size);
      const second = list.slice(list.length - size);
      if (first.join("\n") !== second.join("\n")) continue;
      list = list.slice(0, list.length - (size * 2)).concat(second);
      changed = true;
      break;
    }
  }
  return list;
}

function parseCodexLike(lines, busy, singleTurn = false, kind = "codex", meta = null) {
  const starts = [];
  lines.forEach((line, index) => {
    const m = line.match(USER_PROMPT_RE);
    if (m && !isPlaceholderPrompt(m[1])) starts.push(index);
  });
  // A pane capture can contain several completed Codex turns. Parse each
  // prompt-delimited segment independently; the old implementation selected
  // only the newest prompt and consequently cleared the visible history after
  // every follow-up message.
  if (!singleTurn && starts.length > 1) {
    const turns = starts.map((start, index) => {
      const end = index + 1 < starts.length ? starts[index + 1] : lines.length;
      const turn = parseCodexLike(lines.slice(start, end), busy && index === starts.length - 1, true, kind, meta && meta.slice(start, end));
      return { user: turn.user, blocks: turn.blocks, imageFiles: turn.imageFiles || [] };
    });
    const last = turns[turns.length - 1];
    return { user: last.user, blocks: last.blocks, busy, turns };
  }
  // Prefer the latest real user turn that actually has agent output after it.
  // Codex leaves a placeholder `› Improve documentation…` in the composer which
  // would otherwise look like an empty newest turn and wipe the live answer.
  let startIdx = starts.length - 1;
  while (startIdx >= 0) {
    const after = lines.slice(starts[startIdx] + 1).some((line) => {
      const t = line.trim();
      return t && !isChromeLine(line, kind) && !USER_PROMPT_RE.test(line) && !isPlaceholderPrompt(t);
    });
    if (after) break;
    startIdx -= 1;
  }
  const start = startIdx >= 0 ? starts[startIdx] : Math.max(0, lines.length - 80);
  let user = startIdx >= 0 ? lines[start].replace(USER_PROMPT_RE, "$1").trim() : "";
  let bodyAt = startIdx >= 0 ? start + 1 : start;
  // Codex wraps long prompts onto following indented lines before the first
  // agent `•` bullet — keep those in the user bubble, not the answer.
  if (startIdx >= 0) {
    while (bodyAt < lines.length) {
      const line = lines[bodyAt];
      const t = line.trim();
      if (!t) {
        bodyAt += 1;
        break;
      }
      if (USER_PROMPT_RE.test(line) || /^\s*[•●]\s+/.test(line) || isChromeLine(line, kind)) break;
      if (/^\s{2,}\S/.test(line) || !/^[•●›❯✨]/.test(t)) {
        user = `${user} ${t}`.replace(/\s+/g, " ").trim();
        bodyAt += 1;
        continue;
      }
      break;
    }
  }
  const imageFiles = attachedImageFiles(user);
  user = stripAttachedImageNote(user);
  const rest = lines.slice(bodyAt);
  const restMeta = meta ? meta.slice(bodyAt) : null;
  const blocks = [];
  // Kimi renders markdown `- item` bullets as `• item` in the pane. Group
  // consecutive bullets into one text block with single newlines so the web
  // view renders them as a real <ul> instead of detached paragraphs.
  let bullets = [];
  const flushBullets = () => {
    if (!bullets.length) return;
    pushText(blocks, "text", bullets.join("\n"));
    bullets = [];
  };
  let i = 0;
  while (i < rest.length) {
    const line = rest[i];
    const t = line.trim();
    const kimiBullet = kind === "kimi" && t ? line.match(KIMI_INDENTED_BULLET_RE) : null;
    const bulletContinuation = !kimiBullet && bullets.length && kind === "kimi"
      && /^\s{2,}\S/.test(line) && !USER_PROMPT_RE.test(line) && !KIMI_TOOL_RE.test(line);
    if (!kimiBullet && !bulletContinuation && bullets.length) flushBullets();
    if (!t || isChromeLine(line, kind) || TREE_LINE_RE.test(line)) {
      i += 1;
      continue;
    }
    if (isTodoHeaderLine(t) || (isTodoItemLine(t) && i + 1 < rest.length && isTodoItemLine(rest[i + 1].trim()))) {
      const title = isTodoHeaderLine(t) ? t : "Tasks";
      let j = isTodoHeaderLine(t) ? i + 1 : i;
      const parsedTasks = parseTodoItems(rest, j, kind);
      pushTasks(blocks, title, parsedTasks.items);
      i = parsedTasks.next;
      continue;
    }
    // Kimi thinking stream (italic grey in the pane) → thinking chip, never
    // answer prose. Continuations share the same style, so group them.
    if (kind === "kimi" && restMeta && restMeta[i] && restMeta[i].thinking) {
      let text = t.replace(/^•\s+/, "");
      let j = i + 1;
      while (j < rest.length) {
        if (!(restMeta[j] && restMeta[j].thinking)) break;
        const nt = rest[j].trim();
        if (nt) text += `\n${nt.replace(/^•\s+/, "")}`;
        j += 1;
      }
      pushText(blocks, "thinking", text);
      i = j;
      continue;
    }
    if (kind === "kimi") {
      const liveTool = line.match(KIMI_LIVE_TOOL_RE);
      if (liveTool) {
        const detail = kimiToolDetail(liveTool[2]);
        pushTool(blocks, toolItem(kimiToolVerb(liveTool[1]), detail, { running: true, output: detail }));
        i += 1;
        continue;
      }
      const doneTool = line.match(KIMI_TOOL_RE);
      if (doneTool) {
        const toolName = String(doneTool[1] || "");
        const detail = kimiToolDetail(doneTool[2]);
        if (/^(?:SetTodoList|TaskList|TodoWrite)$/i.test(toolName) && /(?:◐|○|✔|✓|☐|☑|pending|completed|in_progress)/i.test(detail)) {
          const items = detail.split(/\s*[;|,]\s*|\n/).map((part) => part.trim()).filter(Boolean)
            .filter((part) => isTodoItemLine(part) || /:\s*\S/.test(part))
            .map((part) => ({
              status: todoStatusFromMarker(part),
              text: todoTextFromLine(part) || part.replace(/^[^:]+:\s*/, "").trim(),
            }))
            .filter((item) => item.text);
          if (items.length) {
            pushTasks(blocks, "Tasks", items);
            i += 1;
            continue;
          }
        }
        pushTool(blocks, toolItem(kimiToolVerb(toolName), detail, { output: detail }));
        i += 1;
        continue;
      }
      if (kimiBullet) {
        bullets.push(`- ${kimiBullet[1].trim()}`);
        i += 1;
        continue;
      }
      // The pane wraps long bullets mid-word onto following indented lines —
      // fold those back into the bullet they belong to.
      if (bulletContinuation) {
        bullets[bullets.length - 1] += ` ${t}`;
        i += 1;
        continue;
      }
    }
    const status = t.match(CODEX_STATUS_RE);
    if (status) {
      pushText(blocks, "thinking", `${status[1]}${status[2] || ""}`.trim());
      i += 1;
      continue;
    }
    const explicitStatus = t.match(EXPLICIT_STATUS_RE);
    if (explicitStatus) {
      pushText(blocks, "thinking", clipStatus(explicitStatus[1]));
      i += 1;
      continue;
    }
    const tool = t.match(CODEX_TOOL_RE);
    if (tool) {
      let detail = (tool[2] || "").replace(/^[|:]\s*/, "").trim();
      // Swallow indented/tree continuations of the tool dump into expandable body.
      const dump = [];
      let j = i + 1;
      while (j < rest.length) {
        const nxt = rest[j];
        const nt = nxt.trim();
        if (!nt) break;
        if (USER_PROMPT_RE.test(nxt) || /^\s*[•●]\s+/.test(nxt)) break;
        if (TREE_LINE_RE.test(nxt) || /^\s{2,}/.test(nxt) || /^[│└├]/.test(nt)) {
          dump.push(nt.replace(/^[│└├─\s]+/, "").trimEnd());
          j += 1;
          continue;
        }
        break;
      }
      const output = dump.filter(Boolean).join("\n").slice(0, 4000);
      pushTool(blocks, toolItem(tool[1], detail, {
        running: /^Calling$/i.test(tool[1]) || (busy && j >= rest.length),
        output: output || detail,
      }));
      i = j;
      continue;
    }
    const answer = t.match(CODEX_ANSWER_RE);
    if (answer) {
      let text = answer[1].trim();
      let j = i + 1;
      while (j < rest.length) {
        const nxt = rest[j];
        const nt = nxt.trim();
        if (!nt) {
          text += "\n";
          j += 1;
          continue;
        }
        if (USER_PROMPT_RE.test(nxt) || /^\s*[•●]\s+/.test(nxt) || isChromeLine(nxt, kind)) break;
        if (kind === "kimi" && restMeta && restMeta[j] && restMeta[j].thinking) break;
        if (kind === "kimi" && KIMI_LIVE_TOOL_RE.test(nxt)) break;
        if (TREE_LINE_RE.test(nxt)) {
          j += 1;
          continue;
        }
        text += `\n${nt}`;
        j += 1;
      }
      pushText(blocks, "text", text);
      i = j;
      continue;
    }
    // Plain prose fallback (Claude sometimes omits bullets).
    if (!/^\s*[•●›❯✨]/.test(line)) {
      let text = t;
      let j = i + 1;
      while (j < rest.length) {
        const nxt = rest[j];
        const nt = nxt.trim();
        if (!nt) {
          text += "\n";
          j += 1;
          continue;
        }
        if (USER_PROMPT_RE.test(nxt) || /^\s*[•●]\s+/.test(nxt) || isChromeLine(nxt, kind)) break;
        if (kind === "kimi" && restMeta && restMeta[j] && restMeta[j].thinking) break;
        if (kind === "kimi" && KIMI_LIVE_TOOL_RE.test(nxt)) break;
        if (TREE_LINE_RE.test(nxt)) {
          j += 1;
          continue;
        }
        text += `\n${nt}`;
        j += 1;
      }
      pushText(blocks, "text", text);
      i = j;
      continue;
    }
    i += 1;
  }
  flushBullets();
  flushTools(blocks);
  return { user, blocks, busy, imageFiles };
}

function isCursorPaddedUserLine(line) {
  // Cursor right-pads the in-pane user echo to the terminal width (older builds).
  return /[^\s].{8,}\s{6,}$/.test(line) && !/^[\$•●›❯]/.test(line.trim()) && !isChromeLine(line, "cursor");
}

function isCursorToolishLine(line) {
  const t = String(line || "").trim();
  if (!t) return false;
  if (CURSOR_TOOL_RE.test(t) || CURSOR_MCP_TOOL_RE.test(line) || CURSOR_PLAN_UPDATE_RE.test(t)
    || CURSOR_SUMMARY_RE.test(t) || CURSOR_FOUND_RE.test(t) || CURSOR_STATUS_RE.test(t)) return true;
  if (/^\$\s/.test(t) || /^cmd\s/i.test(t) || /^SwitchMode\b/i.test(t)) return true;
  if (isTodoHeaderLine(t) || isTodoItemLine(t)) return true;
  if (/^\s{2,}(?:Read|Grepped|Searched|Listed|Edited|Wrote|Created|Deleted|Globbed|Used|WebSearch|Explored|Called|Found)\b/i.test(line)) return true;
  if (/…\s*\d+\s+(?:input|output)\s+lines?\s+hidden/i.test(t)) return true;
  if (/lines?\s+hidden\b/i.test(t) && /ctrl\+o/i.test(t)) return true;
  return false;
}

function isCursorProseCandidateLine(line) {
  const raw = String(line || "");
  const t = raw.trim();
  if (!t || isChromeLine(raw, "cursor") || isCursorToolishLine(raw)) return false;
  // Agent/user prose is usually 0–3 spaces; tool dumps are 4+ spaces.
  if (/^\s{4,}\S/.test(raw) && !/^[A-Za-z“"]/.test(t)) return false;
  if (/^[\$•●›❯│┌└]/.test(t)) return false;
  return true;
}

function findCursorUserEchoes(lines, hints = []) {
  const ranges = [];
  let i = 0;
  while (i < lines.length) {
    if (!isCursorPaddedUserLine(lines[i])) {
      i += 1;
      continue;
    }
    const start = i;
    const chunk = [];
    while (i < lines.length) {
      if (isCursorPaddedUserLine(lines[i])) {
        chunk.push(lines[i].trim());
        i += 1;
        continue;
      }
      // Allow a single blank spacer inside a wrapped echo, but stop otherwise.
      if (!lines[i].trim() && i + 1 < lines.length && isCursorPaddedUserLine(lines[i + 1])) {
        i += 1;
        continue;
      }
      break;
    }
    const text = chunk.join(" ").replace(/\s+/g, " ").trim();
    const cleaned = sanitizeUserFacingText(text);
    if (cleaned.length >= 8) ranges.push({ start, end: i - 1, text: cleaned });
  }
  if (ranges.length) return ranges;

  // Newer Cursor builds (and zen mode) no longer right-pad the echo. Recover
  // turns by matching remembered prompts against contiguous prose lines.
  const hintList = (Array.isArray(hints) ? hints : [])
    .map((entry) => sanitizeUserFacingText(entry))
    .filter((entry) => entry && entry.length >= 8);
  if (!hintList.length) return ranges;

  const occupied = new Set();
  for (const hint of hintList) {
    let best = null;
    for (let start = 0; start < lines.length; start += 1) {
      if (occupied.has(start) || !isCursorProseCandidateLine(lines[start])) continue;
      const chunk = [];
      let end = start;
      let j = start;
      while (j < lines.length && chunk.join(" ").length < hint.length + 80) {
        if (!lines[j].trim()) {
          if (chunk.length && j + 1 < lines.length && isCursorProseCandidateLine(lines[j + 1])) {
            j += 1;
            continue;
          }
          break;
        }
        if (!isCursorProseCandidateLine(lines[j])) break;
        chunk.push(lines[j].trim());
        end = j;
        const joined = sanitizeUserFacingText(chunk.join(" "));
        if (looksLikeUserEcho(joined, hint) || normalizePrompt(joined) === normalizePrompt(hint)) {
          // Keep absorbing soft-wrapped echo lines ("…paste" / "images.") so
          // leftovers do not leak into the agent prose stream.
          let end = j;
          let k = j + 1;
          while (k < lines.length) {
            if (!lines[k].trim()) {
              if (k + 1 < lines.length && isCursorProseCandidateLine(lines[k + 1])) {
                k += 1;
                continue;
              }
              break;
            }
            if (!isCursorProseCandidateLine(lines[k])) break;
            const extended = sanitizeUserFacingText([...chunk, lines[k].trim()].join(" "));
            const hintNorm = normalizePrompt(hint);
            const extNorm = normalizePrompt(extended);
            // Only keep lines that are still covered by the remembered prompt.
            // Using looksLikeUserEcho here would swallow the agent answer that
            // starts with the same stem ("First question… Here is the answer").
            if (hintNorm === extNorm || hintNorm.startsWith(extNorm)) {
              chunk.push(lines[k].trim());
              end = k;
              k += 1;
              continue;
            }
            break;
          }
          best = { start, end, text: hint, score: Math.abs(sanitizeUserFacingText(chunk.join(" ")).length - hint.length) };
          break;
        }
        // Keep growing while the hint still starts with this prefix.
        if (!normalizePrompt(hint).startsWith(normalizePrompt(joined).slice(0, Math.min(48, joined.length)))
          && !normalizePrompt(joined).startsWith(normalizePrompt(hint).slice(0, Math.min(48, hint.length)))) {
          break;
        }
        j += 1;
      }
      if (best && best.start === start) break;
    }
    if (!best) continue;
    for (let k = best.start; k <= best.end; k += 1) occupied.add(k);
    ranges.push({ start: best.start, end: best.end, text: best.text });
  }
  ranges.sort((a, b) => a.start - b.start);
  return ranges;
}

function parseCursorBlocks(lines, busy) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t || isChromeLine(line, "cursor") || isCursorPaddedUserLine(line)) {
      i += 1;
      continue;
    }
    // Mode switch: "SwitchMode → Plan … Mode switch approved" + overview lines.
    const mode = t.match(CURSOR_SWITCH_MODE_RE) || ( /^SwitchMode\b/i.test(t) ? [t, t.replace(/^SwitchMode\s*(?:→|->)\s*/i, "").replace(/\s+Mode\s+switch\s+approved\s*$/i, "").trim()] : null);
    if (mode) {
      const detail = [];
      let j = i + 1;
      while (j < lines.length) {
        const nxt = lines[j];
        const nt = nxt.trim();
        if (!nt) {
          if (detail.length) break;
          j += 1;
          continue;
        }
        if (isChromeLine(nxt, "cursor") || isCursorPaddedUserLine(nxt) || CURSOR_TOOL_RE.test(nt) || CURSOR_MCP_TOOL_RE.test(nxt) || CURSOR_PLAN_UPDATE_RE.test(nt) || CURSOR_SUMMARY_RE.test(nt) || CURSOR_STATUS_RE.test(nt) || /^\$\s/.test(nt) || /^SwitchMode\b/i.test(nt) || isTodoHeaderLine(nt) || isTodoItemLine(nt)) break;
        detail.push(nt);
        j += 1;
      }
      const modeName = String(mode[1] || "Mode").replace(/\s+/g, " ").trim() || "Mode";
      pushMode(blocks, modeName, detail.join(" "));
      i = j;
      continue;
    }
    // Tracked task list: "To-do Working on N to-dos" + ◐/○/✔ items.
    if (isTodoHeaderLine(t) || (isTodoItemLine(t) && i + 1 < lines.length && isTodoItemLine(lines[i + 1].trim()))) {
      let title = "Tasks";
      if (isTodoHeaderLine(t)) {
        title = t.replace(/^[•●]\s+/, "").trim();
      }
      let j = isTodoHeaderLine(t) ? i + 1 : i;
      const parsedTasks = parseTodoItems(lines, j, "cursor");
      pushTasks(blocks, title, parsedTasks.items);
      i = parsedTasks.next;
      continue;
    }
    // Shell command dumps.
    if (/^\$\s/.test(t) || /^cmd\s/i.test(t)) {
      const cmd = t.replace(/^\$\s*/, "").replace(/^cmd\s+/i, "");
      const dump = [];
      let j = i + 1;
      while (j < lines.length) {
        const nt = lines[j].trim();
        if (!nt) break;
        if (/^\d+ms\b/i.test(nt) || /^in\s+\S+/i.test(nt) || /lines?\s+hidden/i.test(nt)) {
          dump.push(nt);
          j += 1;
          continue;
        }
        if (/^\$\s/.test(nt) || CURSOR_TOOL_RE.test(nt) || CURSOR_SUMMARY_RE.test(nt) || CURSOR_STATUS_RE.test(nt)) break;
        if (isChromeLine(lines[j], "cursor") || isCursorPaddedUserLine(lines[j])) break;
        if (/^\s{2,}/.test(lines[j]) || /hidden/i.test(nt)) {
          dump.push(nt);
          j += 1;
          continue;
        }
        break;
      }
      pushTool(blocks, toolItem("Ran", cmd, { output: dump.join("\n").slice(0, 4000) || cmd }));
      i = j;
      continue;
    }
    if (CURSOR_SUMMARY_RE.test(t) || CURSOR_FOUND_RE.test(t)) {
      // Activity summary is mirrored on /code cards via detectLiveStatus —
      // don't also spam the conversation with "Read 2 files" chips.
      i += 1;
      continue;
    }
    if (CURSOR_PLAN_UPDATE_RE.test(t)) {
      i += 1;
      continue;
    }
    // Promote Cursor's human status ("Explored X", "Searching for Y") into a
    // thinking chip so the live view shows intent before the tool cards.
    // 4-space tool dumps like "Explored available MCP tools …" stay for the
    // tool matcher below.
    if (CURSOR_STATUS_RE.test(t) && !/^\s{4,}/.test(line)) {
      pushText(blocks, "thinking", t.replace(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*/, "").trim());
      i += 1;
      continue;
    }
    const explicitStatus = t.match(EXPLICIT_STATUS_RE);
    if (explicitStatus) {
      pushText(blocks, "thinking", clipStatus(explicitStatus[1]));
      i += 1;
      continue;
    }
    const mcpTool = line.match(CURSOR_MCP_TOOL_RE);
    if (mcpTool) {
      const detail = `${mcpTool[1]} · ${mcpTool[2]}`;
      pushTool(blocks, toolItem("Called", detail, { output: detail }));
      i += 1;
      continue;
    }
    const tool = t.match(CURSOR_TOOL_RE);
    if (tool) {
      let detail = tool[1].trim();
      let j = i + 1;
      while (j < lines.length) {
        const nxt = lines[j];
        const nt = nxt.trim();
        if (!nt) break;
        if (CURSOR_TOOL_RE.test(nt) || CURSOR_MCP_TOOL_RE.test(nxt) || CURSOR_PLAN_UPDATE_RE.test(nt) || CURSOR_SUMMARY_RE.test(nt) || CURSOR_FOUND_RE.test(nt) || CURSOR_STATUS_RE.test(nt) || /^\$\s/.test(nt) || isChromeLine(nxt, "cursor") || isCursorPaddedUserLine(nxt)) break;
        if (isTodoHeaderLine(nt) || isTodoItemLine(nt) || /^SwitchMode\b/i.test(nt)) break;
        // Soft wrap continuations for Grepped/WebSearch/Explored paths.
        if (/^\s{4,}\S/.test(nxt) || (/\bin$/i.test(detail) && nt.length < 120)) {
          detail = `${detail} ${nt}`;
          j += 1;
          continue;
        }
        if (/^\s{2,}\S/.test(nxt) && !/^[A-Za-z“"$]/.test(nt) && detail.length < 160) {
          detail = `${detail} ${nt}`;
          j += 1;
          continue;
        }
        break;
      }
      const verbMatch = t.match(/^(Edited|Wrote|Created|Read|Grepped|Searched|Listed|Deleted|Globbed|Used|WebSearch|Explored|Called)/i);
      const verb = verbMatch ? verbMatch[1] : "Tool";
      pushTool(blocks, toolItem(verb, detail, { output: detail }));
      i = j;
      continue;
    }
    if (/^\s{2,}(?:Read|Grepped|Searched|Listed|Edited|Wrote|Created|Deleted|Globbed|Used|WebSearch|Explored|Called)\b/i.test(line)) {
      const ind = t.match(/^(Read|Grepped|Searched|Listed|Edited|Wrote|Created|Deleted|Globbed|Used|WebSearch|Explored|Called)\b(.*)$/i);
      if (ind) {
        let detail = (ind[2] || "").trim();
        let j = i + 1;
        while (j < lines.length) {
          const nxt = lines[j];
          const nt = nxt.trim();
          if (!nt || isChromeLine(nxt, "cursor") || CURSOR_TOOL_RE.test(nt) || CURSOR_FOUND_RE.test(nt) || CURSOR_SUMMARY_RE.test(nt)) break;
          if (/^\s{2,}(?:Read|Grepped|Searched|Listed|Edited|Wrote|Created|Deleted|Globbed|Used|WebSearch|Explored|Called)\b/i.test(nxt)) break;
          if (/^\s{4,}\S/.test(nxt) || /\bin$/i.test(detail)) {
            detail = `${detail} ${nt}`;
            j += 1;
            continue;
          }
          break;
        }
        pushTool(blocks, toolItem(ind[1], detail || ind[1], { output: detail || ind[1] }));
        i = j;
        continue;
      }
    }
    if (!/^\s{4,}\S/.test(line) || /^[A-Za-z“"]/.test(t)) {
      if (/^\s{4,}\S/.test(line) && !/^[A-Za-z“"]/.test(t)) {
        i += 1;
        continue;
      }
      let text = t;
      let j = i + 1;
      while (j < lines.length) {
        const nxt = lines[j];
        const nt = nxt.trim();
        if (!nt) {
          text += "\n";
          j += 1;
          continue;
        }
        if (isChromeLine(nxt, "cursor") || isCursorPaddedUserLine(nxt) || CURSOR_TOOL_RE.test(nt) || CURSOR_MCP_TOOL_RE.test(nxt) || CURSOR_PLAN_UPDATE_RE.test(nt) || CURSOR_SUMMARY_RE.test(nt) || CURSOR_FOUND_RE.test(nt) || CURSOR_STATUS_RE.test(nt) || /^\$\s/.test(nt)) break;
        if (isTodoHeaderLine(nt) || isTodoItemLine(nt) || /^SwitchMode\b/i.test(nt)) break;
        if (/^\s{2,}(?:Read|Grepped|Searched|Listed|Edited|Wrote|Created|Deleted|Globbed|Used|WebSearch|Explored|Called)\b/i.test(nxt)) break;
        if (/^\s{4,}\S/.test(nxt) && !/^[A-Za-z“"*]/.test(nt)) break;
        text += `\n${nt}`;
        j += 1;
      }
      pushText(blocks, "text", text);
      i = j;
      continue;
    }
    i += 1;
  }
  return blocks;
}

function parseCursor(lines, busy, hints = []) {
  const echoes = findCursorUserEchoes(lines, hints);
  if (!echoes.length) {
    return { user: "", blocks: parseCursorBlocks(lines, busy), busy, turns: [] };
  }
  const turns = [];
  for (let t = 0; t < echoes.length; t += 1) {
    const echo = echoes[t];
    const nextStart = t + 1 < echoes.length ? echoes[t + 1].start : lines.length;
    const segment = lines.slice(echo.end + 1, nextStart);
    const blocks = stripUserEcho(parseCursorBlocks(segment, busy && t === echoes.length - 1), echo.text);
    turns.push({ user: echo.text, blocks });
  }
  const last = turns[turns.length - 1];
  return {
    user: last.user,
    blocks: last.blocks,
    busy,
    turns,
  };
}

function normalizePrompt(text) {
  return String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function looksLikeUserEcho(blockText, hintUser) {
  const block = normalizePrompt(blockText);
  const hint = normalizePrompt(hintUser);
  if (!block || !hint || hint.length < 12) return false;
  if (block === hint) return true;
  if (hint.startsWith(block) && block.length >= 24) return true;
  if (block.startsWith(hint) && hint.length >= 24) return true;
  // Cursor often truncates the echo mid-sentence in the pane.
  const stem = hint.slice(0, Math.min(72, hint.length));
  return stem.length >= 24 && block.startsWith(stem);
}

function stripUserEcho(blocks, hintUser) {
  if (!hintUser) return blocks;
  const hint = normalizePrompt(hintUser);
  if (hint.length < 12) return blocks;
  return (blocks || []).map((block) => {
    if (!block || block.type !== "text") return block;
    if (looksLikeUserEcho(block.text, hintUser)) return null;
    // Cursor sometimes glues the echo onto the previous/next prose block.
    const lines = String(block.text || "").split("\n");
    const kept = [];
    let i = 0;
    while (i < lines.length) {
      const slice = [];
      let j = i;
      while (j < lines.length && lines[j].trim()) {
        slice.push(lines[j]);
        j += 1;
      }
      const para = slice.join(" ");
      if (!looksLikeUserEcho(para, hintUser)) {
        if (slice.length) kept.push(slice.join("\n"));
        if (j < lines.length && !lines[j].trim()) kept.push("");
      }
      i = Math.max(j + (j < lines.length && !lines[j].trim() ? 1 : 0), i + 1);
    }
    const text = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) return null;
    return { ...block, text };
  }).filter(Boolean);
}

function extractCursorUserEcho(lines, hints = []) {
  const echoes = findCursorUserEchoes(lines, hints);
  return echoes.length ? echoes[echoes.length - 1].text : "";
}

function parseLiveTranscript(kind, output, options = {}) {
  const provider = kind === "gpt" ? "codex" : (kind || "codex");
  const capturedLines = String(output || "").replace(/\r/g, "").split("\n");
  const rawLines = provider === "kimi"
    ? dedupeRepeatedTailLines(capturedLines)
    : capturedLines;
  // Styled captures (`-e`) carry SGR codes: classify each line (kimi thinking
  // is italic grey, headings bold-underline), then strip codes for content.
  const meta = rawLines.map(classifyPaneLine);
  const decoded = rawLines.map((raw, index) => {
    if (provider !== "kimi") return stripTmuxEscapes(raw);
    const enriched = stripTmuxEscapes(enrichKimiLine(raw));
    return meta[index].heading ? `### ${enriched.trim()}` : enriched;
  });
  // Claude reuses the sent-message marker for its composer, so clear the draft
  // before anything treats it as a turn. Indices are preserved so the style
  // metadata computed above still lines up.
  const composer = provider === "claude" ? extractComposerDraft(decoded) : { lines: decoded, draft: "" };
  const lines = composer.lines;
  const busy = detectBusy(provider, lines);
  const hintUser = sanitizeUserFacingText(options.hintUser || "");
  const userHistory = Array.isArray(options.userHistory)
    ? options.userHistory.map((entry) => sanitizeUserFacingText(entry)).filter(Boolean)
    : [];
  let parsed;
  if (provider === "cursor") {
    const hints = [...userHistory];
    if (hintUser && !hints.some((entry) => normalizePrompt(entry) === normalizePrompt(hintUser))) {
      hints.push(hintUser);
    }
    parsed = parseCursor(lines, busy, hints);
    if (parsed.user) parsed.user = sanitizeUserFacingText(parsed.user);
    if (Array.isArray(parsed.turns)) {
      parsed.turns = parsed.turns.map((turn) => ({
        ...turn,
        user: sanitizeUserFacingText(turn.user),
      })).filter((turn) => turn.user);
    }
    if (!parsed.user) parsed.user = hintUser || extractCursorUserEcho(lines) || "";
    // Prefer the dash's clean remembered prompt when the pane echo still has
    // SwitchMode chrome glued on (sanitize may already have fixed it; if the
    // hint is a strict prefix of a longer polluted echo, keep the hint).
    if (hintUser && parsed.user && normalizePrompt(hintUser) !== normalizePrompt(parsed.user)) {
      if (looksLikeUserEcho(parsed.user, hintUser) || normalizePrompt(parsed.user).startsWith(normalizePrompt(hintUser))) {
        parsed.user = hintUser;
        if (Array.isArray(parsed.turns) && parsed.turns.length) {
          parsed.turns[parsed.turns.length - 1] = {
            ...parsed.turns[parsed.turns.length - 1],
            user: hintUser,
          };
        }
      } else if (!looksLikeUserEcho(parsed.user, hintUser)) {
        const turns = Array.isArray(parsed.turns) && parsed.turns.length
          ? parsed.turns.slice()
          : [{ user: parsed.user, blocks: parsed.blocks || [] }];
        turns.push({ user: hintUser, blocks: [] });
        parsed.turns = turns;
        parsed.user = hintUser;
        parsed.blocks = [];
      }
    } else if (hintUser && !parsed.turns?.length) {
      parsed.user = hintUser;
    }
    if ((!parsed.turns || !parsed.turns.length) && parsed.user) {
      parsed.turns = [{
        user: parsed.user,
        blocks: stripUserEcho(parsed.blocks || [], hintUser || parsed.user),
      }];
      parsed.blocks = parsed.turns[0].blocks;
    }
    // Append any dash-side follow-ups that have not appeared in the pane yet.
    if (userHistory.length && parsed.turns?.length) {
      const newestParsed = normalizePrompt(parsed.turns[parsed.turns.length - 1].user);
      let anchor = -1;
      for (let i = userHistory.length - 1; i >= 0; i -= 1) {
        if (normalizePrompt(userHistory[i]) === newestParsed) {
          anchor = i;
          break;
        }
      }
      if (anchor >= 0) {
        const seen = new Set(parsed.turns.map((turn) => normalizePrompt(turn.user)));
        for (const entry of userHistory.slice(anchor + 1)) {
          const key = normalizePrompt(entry);
          if (key && !seen.has(key)) {
            parsed.turns.push({ user: entry, blocks: [] });
            seen.add(key);
          }
        }
      }
    }
  } else {
    parsed = parseCodexLike(lines, busy, false, provider, meta);
    if (!parsed.user && hintUser) parsed.user = hintUser;
    if (!parsed.turns) parsed.turns = parsed.user
      ? [{ user: parsed.user, blocks: parsed.blocks || [], imageFiles: parsed.imageFiles || [] }]
      : [];
    if (userHistory.length && parsed.turns.length) {
      // The pane is authoritative for completed turns. Only append messages
      // sent after its newest prompt; prepending all unseen history detached
      // old user bubbles from the responses that belonged to them.
      const newestParsed = normalizePrompt(parsed.turns[parsed.turns.length - 1].user);
      let anchor = -1;
      for (let i = userHistory.length - 1; i >= 0; i -= 1) {
        if (normalizePrompt(userHistory[i]) === newestParsed) {
          anchor = i;
          break;
        }
      }
      if (anchor >= 0) {
        const seen = new Set(parsed.turns.map((turn) => normalizePrompt(turn.user)));
        for (const entry of userHistory.slice(anchor + 1)) {
          const key = normalizePrompt(entry);
          if (key && !seen.has(key)) {
            parsed.turns.push({ user: entry, blocks: [] });
            seen.add(key);
          }
        }
      }
    }
  }
  if (hintUser && !parsed.user) parsed.user = hintUser;
  if ((hintUser || parsed.user) && (!parsed.turns || !parsed.turns.length)) {
    parsed.blocks = stripUserEcho(parsed.blocks, hintUser || parsed.user);
  }
  if (provider === "kimi") {
    parsed.blocks = dedupeRepeatedTailBlocks(parsed.blocks);
    if (Array.isArray(parsed.turns)) {
      parsed.turns = parsed.turns.map((turn) => ({
        ...turn,
        blocks: dedupeRepeatedTailBlocks(turn.blocks),
      }));
      if (parsed.turns.length) {
        parsed.blocks = parsed.turns[parsed.turns.length - 1].blocks;
      }
    }
  }
  parsed.busy = busy;
  if (composer.draft) parsed.draft = composer.draft;
  return parsed;
}

function summarizeTools(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return "";
  // Prefer a concrete target from the first few tools ("server.js", "OLLAMA")
  // over a raw verb tally ("2 Shell · Read").
  const targets = [];
  const seen = new Set();
  for (const item of list.slice(0, 4)) {
    const raw = String(item.args || item.detail || "").replace(/\s+/g, " ").trim();
    if (!raw) continue;
    const file = raw.match(/(?:^|[\s/`'"])((?:\/[\w.-]+)+\.\w{1,8}|[\w.-]+\.\w{1,8})\b/);
    const snippet = file ? file[1] : raw.split(/\s+/).slice(0, 4).join(" ");
    const clipped = snippet.length > 36 ? `${snippet.slice(0, 35)}…` : snippet;
    if (!clipped || seen.has(clipped)) continue;
    seen.add(clipped);
    targets.push(clipped);
  }
  if (targets.length) {
    const verb = list[0].verb || "Working";
    return `${verb} ${targets.join(" · ")}`;
  }
  const counts = {};
  for (const item of list) {
    counts[item.verb] = (counts[item.verb] || 0) + 1;
  }
  const parts = Object.entries(counts).map(([verb, n]) => (n === 1 ? verb : `${n} ${verb}`));
  return `${list.length} tool${list.length === 1 ? "" : "s"} · ${parts.join(" · ")}`;
}

function detectLiveStatus(kind, output) {
  const provider = kind === "gpt" ? "codex" : (kind || "codex");
  const lines = String(output || "").replace(/\r/g, "").split("\n");
  const window = lines.slice(-40);
  let explicit = null;
  let activity = null;

  for (const line of window) {
    const t = line.trim();
    if (!t || isChromeLine(line, provider)) continue;

    const statusMatch = t.match(EXPLICIT_STATUS_RE);
    if (statusMatch) {
      const text = clipStatus(statusMatch[1]);
      if (text) explicit = { text, source: "status" };
      continue;
    }

    if (provider === "cursor") {
      if (CURSOR_STATUS_RE.test(t)) {
        const text = clipStatus(t.replace(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*/, ""));
        if (text) activity = { text, source: "thinking" };
        continue;
      }
      const tool = t.match(CURSOR_TOOL_RE);
      if (tool) {
        const text = clipStatus(`${tool[0]}`.replace(/\s+/g, " "));
        if (text) activity = { text, source: "tool" };
        continue;
      }
      if (CURSOR_SUMMARY_RE.test(t)) {
        const text = clipStatus(t);
        if (text) activity = { text, source: "tool" };
      }
      continue;
    }

    const codexStatus = t.match(CODEX_STATUS_RE);
    if (codexStatus) {
      const detail = String(codexStatus[2] || "").replace(/\s+/g, " ").trim();
      const text = clipStatus(detail ? `${codexStatus[1]} ${detail}` : codexStatus[1]);
      if (text) activity = { text, source: "thinking" };
      continue;
    }
    const codexTool = t.match(CODEX_TOOL_RE);
    if (codexTool) {
      const verb = codexTool[1];
      const detail = compactDetail(verb, codexTool[2]);
      const text = clipStatus(detail ? `${verb} ${detail}` : verb);
      if (text) activity = { text, source: "tool" };
    }
  }

  return explicit || activity || null;
}

/** Latest task panel that still has open work — for the sticky dock above the composer. */
function latestActiveTasks(transcript) {
  const data = transcript && typeof transcript === "object" ? transcript : null;
  if (!data) return null;
  const turns = Array.isArray(data.turns) && data.turns.length
    ? data.turns
    : [{ blocks: data.blocks || [] }];
  let latest = null;
  for (const turn of turns) {
    for (const block of turn.blocks || []) {
      if (block && block.type === "tasks" && Array.isArray(block.items) && block.items.length) {
        latest = block;
      }
    }
  }
  if (!latest) return null;
  const open = latest.items.some((item) => {
    const status = String(item?.status || "pending");
    return status === "pending" || status === "in_progress";
  });
  return open ? latest : null;
}

module.exports = {
  compactDetail,
  detectBusy,
  detectLiveStatus,
  extractComposerDraft,
  // Block builders, shared with the session-log transcript so both sources
  // produce exactly the same shapes for the web view.
  pushTasks,
  pushText,
  pushTool,
  latestActiveTasks,
  parseLiveTranscript,
  sanitizeUserFacingText,
  shortPath,
  stripTmuxEscapes,
  summarizeTools,
  toolItem,
};
