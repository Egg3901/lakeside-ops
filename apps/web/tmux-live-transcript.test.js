"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { parseLiveTranscript, summarizeTools } = require("./tmux-live-transcript");

test("cursor transcript keeps prose and collapses tool paths into cards", () => {
  const sample = `
  You want the live TMUX agent view to feel like chat.

    Read, globbed, grepped 3 files, 1 glob, 2 greps
    Grepped "codex|claude" in
    projects/LSGD-ops-dash
    Read projects/LSGD-ops-dash/tmux-terminal-page.js

  $ ls /root/projects/LSGD-ops-dash/*.js
    output lines hidden

  The live page already tries to look like chat.

  ⠋ Running
  `;
  const parsed = parseLiveTranscript("cursor", sample);
  assert.equal(parsed.busy, true);
  assert.ok(parsed.blocks.some((b) => b.type === "text" && /feel like chat/.test(b.text)));
  const tools = parsed.blocks.filter((b) => b.type === "tools").flatMap((b) => b.items);
  assert.ok(tools.length >= 2, "expected tool cards");
  assert.ok(tools.every((t) => !/projects\/LSGD-ops-dash\/tmux-terminal-page\.js$/.test(t.args) || t.verb === "Read"));
  assert.ok(tools.some((t) => t.verb === "Grep"));
  assert.ok(tools.some((t) => t.verb === "Shell"));
  // Full paths should be shortened in the card args.
  const read = tools.find((t) => t.verb === "Read");
  assert.ok(read);
  assert.match(read.args, /tmux-terminal-page\.js/);
  assert.ok(!parsed.blocks.some((b) => b.type === "text" && /Grepped "codex/.test(b.text)));
});

test("cursor status lines become thinking chips instead of vanishing", () => {
  const sample = `
Exploring auth callback routes
    Read projects/LSGD-ops-dash/server.js
Searching for OLLAMA_CLOUD_KEY
    Grepped "OLLAMA_CLOUD_KEY" in
    projects/LSGD-ops-dash
STATUS: Resetting script run status
    Edited projects/LSGD-ops-dash/scripts/reset.js
`;
  const parsed = parseLiveTranscript("cursor", sample);
  const thinking = parsed.blocks.filter((b) => b.type === "thinking").map((b) => b.text);
  assert.ok(thinking.some((t) => /Exploring auth callback routes/.test(t)));
  assert.ok(thinking.some((t) => /Searching for OLLAMA_CLOUD_KEY/.test(t)));
  assert.ok(thinking.some((t) => /Resetting script run status/.test(t)));
  const tools = parsed.blocks.filter((b) => b.type === "tools").flatMap((b) => b.items);
  assert.ok(tools.some((t) => t.verb === "Read"));
  assert.ok(tools.some((t) => t.verb === "Grep"));
});

test("summarizeTools prefers concrete targets over verb tallies", () => {
  const summary = summarizeTools([
    { verb: "Read", args: "projects/LSGD-ops-dash/server.js" },
    { verb: "Grep", args: '"OLLAMA_CLOUD_KEY" in projects/LSGD-ops-dash' },
    { verb: "Shell", args: "systemctl restart ahd-ops-dashboard" },
  ]);
  assert.match(summary, /server\.js/);
  assert.doesNotMatch(summary, /^3 tools ·/);
});

test("codex ignores composer placeholder prompts so the live answer stays visible", () => {
  const sample = `
› Also, the way that cursor streams its response is way too verbose

• I’ll tune both streams at their source.

• Ran sed -n '1,360p' codex-agent-bridge.js

• Working (39s • esc to interrupt)

› Improve documentation in @filename
`;
  const parsed = parseLiveTranscript("codex", sample);
  assert.match(parsed.user, /way too verbose/);
  assert.ok(parsed.blocks.some((b) => b.type === "text" && /tune both streams/.test(b.text)));
});

test("cursor user echoes become a bubble instead of agent stream text", () => {
  const user = "Like, for example, when I send a message to ChatGPT through code agent, it shows up as a bubble when it shows up here, it shows up in the stream of text to the agent or the";
  const pad = (s) => (s + " ".repeat(90)).slice(0, 90);
  const sample = [
    "  Live agent view is updated — hard-refresh the page.",
    "",
    pad("  Like, for example, when I send a message to ChatGPT through code"),
    pad("  agent, it shows up as a bubble when it shows up here, it shows up in"),
    pad("  the stream of text to the agent or the"),
    "",
    "  You’re saying the Code Agent shows your message as a chat bubble.",
    "",
    "  ⠋ Running",
  ].join("\n");
  const parsed = parseLiveTranscript("cursor", sample, { hintUser: user });
  assert.equal(parsed.user, user);
  const answer = parsed.blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  assert.match(answer, /You’re saying the Code Agent/);
  assert.ok(!/Like, for example, when I send a message to ChatGPT/.test(answer),
    "user echo must not remain in the agent stream");
});

test("cursor follow-up echoes become their own turn bubble", () => {
  const pad = (s) => (s + " ".repeat(90)).slice(0, 90);
  const sample = [
    pad("  First question about the live agent view"),
    "",
    "  Here is the first answer with some detail.",
    "",
    pad("  Follow up messages also don’t really display right for cursor."),
    "",
    "  I’ll check how Cursor follow-ups show up in the pane.",
    "",
    "  ⠋ Running",
  ].join("\n");
  const parsed = parseLiveTranscript("cursor", sample);
  assert.equal(parsed.turns.length, 2);
  assert.match(parsed.turns[0].user, /First question/);
  assert.match(parsed.turns[1].user, /Follow up messages/);
  assert.match(parsed.turns[0].blocks.map((b) => b.text || "").join("\n"), /first answer/i);
  assert.match(parsed.user, /Follow up messages/);
  assert.ok(!parsed.turns[1].blocks.some((b) => b.type === "text" && /Follow up messages/.test(b.text || "")));
});

test("fixtures from live panes do not dump raw shell bodies as answer text", () => {
  for (const [kind, file] of [["cursor", "/tmp/cursor-capture.txt"], ["codex", "/tmp/gpt-capture.txt"]]) {
    if (!fs.existsSync(file)) continue;
    const parsed = parseLiveTranscript(kind, fs.readFileSync(file, "utf8"));
    const answer = parsed.blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    assert.ok(!/^\$\s/m.test(answer), `${kind}: shell prompts leaked into answer`);
    assert.ok(!/ctrl\+r to review/i.test(answer), `${kind}: chrome leaked into answer`);
  }
});

test("codex keeps earlier turns when a follow-up is sent", () => {
  const parsed = parseLiveTranscript("codex", [
    "› First question",
    "",
    "• First answer",
    "",
    "› Follow-up question",
    "",
    "• Follow-up answer",
  ].join("\n"), { userHistory: ["First question", "Follow-up question"] });
  assert.equal(parsed.turns.length, 2);
  assert.equal(parsed.turns[0].user, "First question");
  assert.match(parsed.turns[0].blocks.map((b) => b.text || "").join("\n"), /First answer/);
  assert.equal(parsed.turns[1].user, "Follow-up question");
  assert.match(parsed.turns[1].blocks.map((b) => b.text || "").join("\n"), /Follow-up answer/);
});

test("codex appends only genuinely pending history after parsed turns", () => {
  const parsed = parseLiveTranscript("codex", [
    "› First visible question",
    "",
    "• First visible answer",
    "",
    "› Second visible question",
    "",
    "• Second visible answer",
  ].join("\n"), {
    userHistory: [
      "An old prompt outside the pane",
      "First visible question",
      "Second visible question",
      "Pending follow-up",
    ],
  });
  assert.deepEqual(parsed.turns.map((turn) => turn.user), [
    "First visible question",
    "Second visible question",
    "Pending follow-up",
  ]);
  assert.deepEqual(parsed.turns[2].blocks, []);
});

test("codex hides attached-image filesystem notes from the user bubble", () => {
  const parsed = parseLiveTranscript("codex", [
    "› Please inspect this screenshot",
    "  [Attached images for analysis:",
    "  /tmp/ops-agent-1234-aabbccddee.png]",
    "",
    "• The screenshot shows a layout issue.",
  ].join("\n"));
  assert.equal(parsed.user, "Please inspect this screenshot");
  assert.deepEqual(parsed.turns[0].imageFiles, ["ops-agent-1234-aabbccddee.png"]);
  assert.match(parsed.blocks.map((block) => block.text || "").join("\n"), /layout issue/);
});

test("codex tool narration stays in tool cards instead of answer prose", () => {
  const parsed = parseLiveTranscript("codex", [
    "› Check the staging deployment",
    "",
    "• Calling railway.railway_deployments({\"service\":\"Sandbox Staging\",\"limit\":2})",
    "• Called railway.railway_deployments({\"service\":\"Sandbox Staging\",\"limit\":2})",
    "  [{\"status\":\"BUILDING\",\"url\":\"sandbox.example.com\"}]",
    "• Viewed Image",
    "• Viewed Image",
    "",
    "• The deployment is still building.",
  ].join("\n"));
  const prose = parsed.blocks.filter((block) => block.type === "text")
    .map((block) => block.text).join("\n");
  const tools = parsed.blocks.filter((block) => block.type === "tools")
    .flatMap((block) => block.items);
  assert.match(prose, /deployment is still building/i);
  assert.doesNotMatch(prose, /Called railway|Calling railway|Viewed Image|BUILDING.*sandbox/i);
  assert.ok(tools.some((tool) => /railway_deployments/.test(tool.detail)));
  assert.ok(tools.some((tool) => tool.verb === "View"));
});

test("kimi strips the internal ready-close marker from answer prose", () => {
  const parsed = parseLiveTranscript("kimi", [
    "› Wrap up this session",
    "",
    "• Wrap-up complete.",
    "• <!--END_READY-->",
  ].join("\n"));
  const prose = parsed.blocks.filter((block) => block.type === "text")
    .map((block) => block.text).join("\n");
  assert.match(prose, /Wrap-up complete/);
  assert.doesNotMatch(prose, /END_READY|<!--/);
});

test("kimi removes an exactly duplicated wrap-up sequence at the transcript tail", () => {
  const parsed = parseLiveTranscript("kimi", [
    "› Wrap up this session",
    "",
    "• Checking final state.",
    "• Used Shell (git status)",
    "• Wrap-up complete.",
    "• Checking final state.",
    "• Used Shell (git status)",
    "• Wrap-up complete.",
  ].join("\n"));
  const blocks = parsed.turns[0].blocks;
  assert.equal(blocks.filter((block) => block.type === "tools").length, 1);
  assert.equal(blocks.filter((block) => block.type === "text" && /Checking final state/.test(block.text)).length, 1);
  assert.equal(blocks.filter((block) => block.type === "text" && /Wrap-up complete/.test(block.text)).length, 1);
});

test("detectLiveStatus prefers explicit STATUS lines over tool activity", () => {
  const { detectLiveStatus } = require("./tmux-live-transcript");
  const sample = [
    "• Ran sed -n '1,40p' code-list-page.js",
    "• Edited code-list-page.js",
    "STATUS: Wiring live status onto /code cards",
    "• Working (12s • esc to interrupt)",
  ].join("\n");
  const hit = detectLiveStatus("codex", sample);
  assert.equal(hit.source, "status");
  assert.match(hit.text, /Wiring live status/);
});

test("detectLiveStatus falls back to latest Codex tool or thinking line", () => {
  const { detectLiveStatus } = require("./tmux-live-transcript");
  const tool = detectLiveStatus("codex", [
    "› Fix the nav",
    "• Ran rg page-top code-list-page.js",
    "• Working (3s • esc to interrupt)",
  ].join("\n"));
  assert.equal(tool.source, "thinking");
  assert.match(tool.text, /^Working/i);

  const edited = detectLiveStatus("cursor", [
    "  Looking at the header CSS.",
    "  Edited projects/LSGD-ops-dash/code-list-page.js",
    "  ⠋ Running",
  ].join("\n"));
  assert.equal(edited.source, "tool");
  assert.match(edited.text, /Edited/);
});

test("detectLiveStatus returns null when the pane has no activity", () => {
  const { detectLiveStatus } = require("./tmux-live-transcript");
  assert.equal(detectLiveStatus("codex", "Cursor Agent\n~ ~ ~\n"), null);
});

test("sanitizeUserFacingText strips SwitchMode chrome from glued user echoes", () => {
  const { sanitizeUserFacingText } = require("./tmux-live-transcript");
  assert.equal(
    sanitizeUserFacingText("Not sure what’s going on here SwitchMode → Plan Mode switch approved Status updates on live agent cards"),
    "Not sure what’s going on here"
  );
  assert.equal(
    sanitizeUserFacingText("Weird display with plan mode prompts"),
    "Weird display with plan mode prompts"
  );
});

test("cursor footer model/context/token lines stay out of the conversation", () => {
  const sample = `
  The conversation should not repeat the status bar.

  ⠘⠣ Running  3.54k tokens
  Cursor Grok 4.5 High · 65.9% · 7 files edited                 Run Everything
  Reading projects/LSGD-ops-dash/tmux-live-transcript.js
  Grepped, read 2 greps, 1 file
  `;
  const parsed = parseLiveTranscript("cursor", sample);
  assert.equal(parsed.busy, true);
  const text = parsed.blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  assert.match(text, /should not repeat the status bar/);
  assert.ok(!/3\.54k tokens/i.test(text));
  assert.ok(!/Cursor Grok/i.test(text));
  assert.ok(!/65\.9%/i.test(text));
  assert.ok(!/Run Everything/i.test(text));
  assert.ok(!/Grepped, read 2 greps/i.test(text));
  const thinking = parsed.blocks.filter((b) => b.type === "thinking").map((b) => b.text).join("\n");
  assert.match(thinking, /Reading projects\/LSGD-ops-dash/);
});

test("cursor unpadded echoes still become turn bubbles", () => {
  const user = "make cursors display better for output also allow me to copy paste images.";
  const sample = `
  Cursor Agent
  Tip: Hit shift+tab to enable Plan Mode for large or complex changes.

  make cursors display better for output also allow me to copy paste
  images.

  I'll check Cursor CLI config options for better output display.

    Used update-cli-config
    Read .cursor/cli-config.json
    WebSearch Cursor CLI image paste
    Found 1 reference
    Explored available MCP tools ops-knowledge · knowledge_query

  ⠋ Running
  `;
  const parsed = parseLiveTranscript("cursor", sample, {
    hintUser: user,
    userHistory: [user],
  });
  assert.equal(parsed.turns.length, 1);
  assert.equal(parsed.turns[0].user, user);
  const answer = parsed.turns[0].blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  assert.match(answer, /I'll check Cursor CLI config/);
  assert.ok(!/make cursors display better/.test(answer));
  const tools = parsed.turns[0].blocks.filter((b) => b.type === "tools").flatMap((b) => b.items);
  assert.ok(tools.some((t) => t.verb === "Tool" || /update-cli-config/i.test(t.detail || t.args || "")));
  assert.ok(tools.some((t) => t.verb === "Read"));
  assert.ok(tools.some((t) => t.verb === "Search" || /WebSearch/i.test(t.detail || "")));
  assert.ok(tools.some((t) => t.verb === "Explore"));
  assert.ok(!parsed.turns[0].blocks.some((b) => b.type === "text" && /Found 1 reference/.test(b.text || "")));
});

test("cursor follow-up history reconstructs turns without padded echoes", () => {
  const first = "First question about the live agent view";
  const second = "Follow up messages also don't really display right for cursor.";
  const sample = `
  First question about the live agent view

  Here is the first answer with some detail.

  Follow up messages also don't really display right for cursor.

  I'll check how Cursor follow-ups show up in the pane.

  ⠋ Running
  `;
  const parsed = parseLiveTranscript("cursor", sample, {
    hintUser: second,
    userHistory: [first, second],
  });
  assert.equal(parsed.turns.length, 2);
  assert.equal(parsed.turns[0].user, first);
  assert.equal(parsed.turns[1].user, second);
  assert.match(parsed.turns[0].blocks.map((b) => b.text || "").join("\n"), /first answer/i);
  assert.match(parsed.turns[1].blocks.map((b) => b.text || "").join("\n"), /follow-ups show up/i);
});

test("kimi thinking/token and context chrome stay out of answer prose", () => {
  const sample = [
    "• Here is the answer without status chrome.",
    "⠦ Thinking... 5s · 212 tokens",
    "context: 14.3% (149.8k/1m)",
    "yolo  agent (K3 ●)  ~  ctrl-x: toggle mode",
  ].join("\n");
  const parsed = parseLiveTranscript("kimi", sample);
  const text = parsed.blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  assert.match(text, /answer without status chrome/);
  assert.ok(!/212 tokens/i.test(text));
  assert.ok(!/context:\s*14\.3%/i.test(text));
  assert.ok(!/Thinking\.\.\./i.test(text));
});


test("cursor transcript keeps SwitchMode out of the user bubble", () => {
  const { parseLiveTranscript } = require("./tmux-live-transcript");
  const pad = (s) => (s + " ".repeat(90)).slice(0, 90);
  const sample = [
    pad("  Not sure what’s going on here SwitchMode → Plan Mode switch approved"),
    pad("  Status updates on live agent cards plus broader /code UX improvements"),
    pad("  need a short design pass before coding."),
    "",
    "    SwitchMode → Plan                                 Mode switch approved",
    "    Status updates on live agent cards plus broader /code UX improvements",
    "    need a short design pass before coding.",
    "",
    "  I’ll strip the mode-switch chrome from the user bubble.",
    "",
    "  ⠋ Running",
  ].join("\n");
  const parsed = parseLiveTranscript("cursor", sample, {
    hintUser: "Not sure what’s going on here",
  });
  assert.equal(parsed.user, "Not sure what’s going on here");
  assert.ok(!/SwitchMode/i.test(parsed.user));
  const modes = parsed.blocks.filter((b) => b.type === "mode");
  assert.ok(modes.some((m) => m.id === "plan" && /Plan/i.test(m.label)));
  assert.ok(modes.some((m) => /design pass/i.test(m.detail || "")));
});

test("cursor tracked tasks become a task panel instead of chrome", () => {
  const { parseLiveTranscript } = require("./tmux-live-transcript");
  const sample = [
    "  Working on the harness fixes next.",
    "",
    "    To-do Working on 4 to-dos",
    "    ◐ Diagnose why ended sessions still show in new Cursor agent",
    "    ○ Fix tracked tasks display (cursor, Claude, kimi, codex)",
    "    ○ Fix plan mode display / permission-mode toggle",
    "    ✔ Write 5 harness improvement proposals",
    "",
    "  1 task",
    "  ⠋ Running",
  ].join("\n");
  const parsed = parseLiveTranscript("cursor", sample);
  const tasks = parsed.blocks.filter((b) => b.type === "tasks");
  assert.equal(tasks.length, 1);
  assert.match(tasks[0].title, /Working on 4/);
  assert.equal(tasks[0].items.length, 4);
  assert.equal(tasks[0].items[0].status, "in_progress");
  assert.equal(tasks[0].items[3].status, "completed");
  assert.ok(!parsed.blocks.some((b) => b.type === "text" && /To-do Working/.test(b.text || "")));
});

test("cursor joins wrapped task text and promotes MCP calls instead of leaking parser debris", () => {
  const sample = [
    "    To-do Working on 2 to-dos",
    "    ◐ Complete feature-flag route gating (community-voice, backups, db,",
    "      agents, status)",
    "    ○ UI/branding scrub — tenant from config; Lakeside only in bundled",
    "      yaml",
    "",
    "    … 35 input + 126 output lines hidden · ctrl+o to expand",
    "    [ 'nova-game', 'ops' ]",
    "    plan updated",
    "",
    "    ops-knowledge knowledge_save",
    "",
    "    Edited package.json +2 -1",
  ].join("\n");
  const parsed = parseLiveTranscript("cursor", sample);
  const tasks = parsed.blocks.find((block) => block.type === "tasks");
  assert.ok(tasks);
  assert.equal(tasks.items[0].text, "Complete feature-flag route gating (community-voice, backups, db, agents, status)");
  assert.equal(tasks.items[1].text, "UI/branding scrub — tenant from config; Lakeside only in bundled yaml");
  const tools = parsed.blocks.filter((block) => block.type === "tools").flatMap((block) => block.items);
  assert.ok(tools.some((tool) => tool.verb === "Tool" && /ops-knowledge.*knowledge_save/.test(tool.detail)));
  const prose = parsed.blocks.filter((block) => block.type === "text").map((block) => block.text).join("\n");
  assert.doesNotMatch(prose, /agents,\s*status|knowledge_save|^\s*yaml\s*$/m);
});

test("claude-style todo markers parse into a task panel", () => {
  const { parseLiveTranscript } = require("./tmux-live-transcript");
  const sample = [
    "› Fix the harness",
    "",
    "• Update Todos",
    "  ☐ Wire fresh Cursor chats on spawn",
    "  ☑ Render tracked tasks",
    "  ☐ Add Plan permission mode",
    "",
    "• Working (3s • esc to interrupt)",
  ].join("\n");
  const parsed = parseLiveTranscript("claude", sample);
  const tasks = parsed.blocks.filter((b) => b.type === "tasks");
  assert.ok(tasks.length >= 1);
  assert.ok(tasks[0].items.some((item) => item.status === "completed" && /tracked tasks/i.test(item.text)));
  assert.ok(tasks[0].items.some((item) => item.status === "pending" && /Plan permission/i.test(item.text)));
});

test("latestActiveTasks returns the newest open list and hides when all done", () => {
  const { latestActiveTasks } = require("./tmux-live-transcript");
  const open = latestActiveTasks({
    turns: [
      {
        blocks: [{
          type: "tasks",
          title: "Working on 2",
          items: [
            { status: "completed", text: "One" },
            { status: "in_progress", text: "Two" },
          ],
        }],
      },
    ],
  });
  assert.equal(open.items.length, 2);
  assert.equal(open.items[1].status, "in_progress");

  const done = latestActiveTasks({
    blocks: [{
      type: "tasks",
      items: [
        { status: "completed", text: "One" },
        { status: "cancelled", text: "Two" },
      ],
    }],
  });
  assert.equal(done, null);
});

test("kimi parses tools, markdown bullets and pane chrome from a live pane", () => {
  const sample = [
    "• Here is a summary of what I found in the codebase:",
    "  • First point about the parser",
    "  • Second point that wraps onto",
    "    another line entirely",
    "",
    "• Used Shell (ls -la /root/projects)",
    "• Used ReadFile (projects/LSGD-ops-dash/server.js)",
    "• Used Grep (parseLiveTranscript in LSGD-ops-dash)",
    "⠏ Using WriteFile (projects/LSGD-ops-dash/out.js)",
    "── input ──────────────────────────────────────────",
    "yolo  agent (K3 ●)  ~  ctrl-x: toggle mode",
  ].join("\n");
  const parsed = parseLiveTranscript("kimi", sample, { hintUser: "summarize this repo" });
  assert.equal(parsed.busy, true);
  assert.equal(parsed.user, "summarize this repo");
  const tools = parsed.blocks.filter((b) => b.type === "tools").flatMap((b) => b.items);
  assert.deepEqual(tools.map((t) => t.verb), ["Shell", "Read", "Grep", "Write"]);
  assert.ok(tools[3].running, "braille `Using` line is the running tool");
  assert.ok(tools.every((t) => !/^\(/.test(t.args)), "parens stripped from tool args");
  const text = parsed.blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  assert.match(text, /Here is a summary/);
  assert.match(text, /- First point about the parser\n- Second point that wraps onto another line entirely/);
  assert.ok(!/── input|yolo\s+agent/.test(text), "kimi pane chrome must not leak into prose");
});

test("kimi col-0 bullets are prose, not list items", () => {
  const parsed = parseLiveTranscript("kimi", [
    "• The parser threads the provider kind through now.",
    "  and this wrapped continuation belongs to the same paragraph.",
  ].join("\n"));
  const text = parsed.blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  assert.match(text, /^The parser threads/);
  assert.ok(!/^- The parser/m.test(text), "col-0 prose bullets must not become list items");
});

test("kimi completed tool clears the running flag on the same entry", () => {
  const parsed = parseLiveTranscript("kimi", [
    "⠏ Using Shell (npm test)",
    "• Used Shell (npm test)",
  ].join("\n"));
  const tools = parsed.blocks.filter((b) => b.type === "tools").flatMap((b) => b.items);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].verb, "Shell");
  assert.equal(tools[0].running, false);
});

test("kimi tool result boxes are chrome, not answer prose", () => {
  const parsed = parseLiveTranscript("kimi", [
    "• Used StrReplaceFile (projects/LSGD-ops-dash/server.js)",
    "  ╭─  +6 -1 /root/projects/LSGD-ops-dash/server.js  ─────────────╮",
    "  │ 177     const last = blocks[blocks.length - 1];              │",
    "  ╰──────────────────────────────────────────────────────────────╯",
    "• All done with the edit.",
  ].join("\n"));
  const text = parsed.blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  assert.match(text, /All done with the edit/);
  assert.ok(!/╭|╰|│ 177/.test(text), "diff box lines must not leak into prose");
});

test("kimi styled capture: thinking stream becomes chips, not answer prose", () => {
  const T = "\x1b[3m\x1b[38;5;244m"; // italic + grey50 = thinking style
  const R = "\x1b[0m";
  const sample = [
    `${R}• The answer the user should see.`,
    "",
    `  ${T}Let me think through this privately.${R}`,
    `  ${T}It spans two dimmed lines.${R}`,
    "",
    "• Used Shell (npm test)",
  ].join("\n");
  const parsed = parseLiveTranscript("kimi", sample, { hintUser: "what is up" });
  const thinking = parsed.blocks.filter((b) => b.type === "thinking").map((b) => b.text).join("\n");
  assert.match(thinking, /think through this privately/);
  assert.match(thinking, /two dimmed lines/);
  const text = parsed.blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  assert.match(text, /The answer the user should see/);
  assert.ok(!/think through this privately/.test(text), "thinking must not leak into the answer");
});

test("kimi styled capture: inline code and bold are reconstructed as markdown", () => {
  const sample = [
    "\x1b[0m• The \x1b[1m\x1b[96mrenderTranscript()\x1b[0m function is \x1b[1mvery important\x1b[0m here.",
  ].join("\n");
  const parsed = parseLiveTranscript("kimi", sample, { hintUser: "explain" });
  const text = parsed.blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  assert.match(text, /`renderTranscript\(\)`/);
  assert.match(text, /\*\*very important\*\*/);
});

test("kimi styled capture: section headings become markdown headings", () => {
  const sample = [
    "\x1b[0m• Summary follows.",
    "  \x1b[1;4m\x1b[37m1. First big section\x1b[0m",
    "  ──────────────────────────────────────────",
    "  Body text of that section.",
  ].join("\n");
  const parsed = parseLiveTranscript("kimi", sample, { hintUser: "summarize" });
  const text = parsed.blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  assert.match(text, /### 1\. First big section/);
  assert.ok(!/─────/.test(text), "heading rule must stay chrome");
});

test("kimi moon spinner line is busy chrome, never prose", () => {
  const parsed = parseLiveTranscript("kimi", [
    "• Used Shell (npm test)",
    "🌕",
  ].join("\n"), { hintUser: "run the tests" });
  assert.equal(parsed.busy, true);
  const text = parsed.blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  assert.ok(!/🌕/.test(text), "moon spinner must not leak into prose");
});

test("kimi thinking/composing status spinners are chrome", () => {
  const parsed = parseLiveTranscript("kimi", [
    "• Used Shell (npm test)",
    "⠙ Thinking... 12s · 3.2k tokens",
    "⠋ Composing... 4s · 1.1k tokens",
  ].join("\n"), { hintUser: "run the tests" });
  const text = parsed.blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  assert.ok(!/Thinking\.\.\.|Composing\.\.\./.test(text));
});

test("kimi running tool is not absorbed into the preceding prose", () => {
  const parsed = parseLiveTranscript("kimi", [
    "• Let me run the tests for you right now.",
    "⠇ Using Shell (npm test)",
  ].join("\n"), { hintUser: "run the tests" });
  const tools = parsed.blocks.filter((b) => b.type === "tools").flatMap((b) => b.items);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].verb, "Shell");
  assert.equal(tools[0].running, true);
  const text = parsed.blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  assert.ok(!/Using Shell/.test(text), "live tool line must not glue into prose");
});
