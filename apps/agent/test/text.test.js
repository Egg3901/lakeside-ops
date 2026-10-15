"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const t = require("../lib/text");

test("ticket cards retain title, question, fields and ordinary message content", () => {
  const out = t.messageText({ content: "Ticket context", embeds: [{ title: "Mechanics Help #1417", description: "Does the unfinished build continue?", fields: [{ name: "Status", value: "Open" }] }] });
  assert.match(out, /Mechanics Help #1417/);
  assert.match(out, /Does the unfinished build continue/);
  assert.match(out, /Status: Open/);
  assert.match(out, /Ticket context/);
});

test("Starmerisms are gated, singular and suppressed for serious matters", () => {
  assert.equal(t.filterStarmerisms("Let me be clear. The build continues.", false), "The build continues.");
  assert.equal(t.filterStarmerisms("Let me be clear. The build continues.", true), "Let me be clear. The build continues.");
  assert.equal(t.filterStarmerisms("Let me be clear. The refund failed.", true), "The refund failed.");
  const out = t.filterStarmerisms("Let me be clear. It continues. We'll get on with the job.", true);
  assert.equal(out, "Let me be clear. It continues.");
});

test("chunkMessage keeps short text whole and splits long text under the limit", () => {
  assert.deepEqual(t.chunkMessage("hello"), ["hello"]);
  assert.deepEqual(t.chunkMessage("   "), []);
  const long = Array.from({ length: 300 }, (_, i) => `line ${i} of the reply`).join("\n");
  const chunks = t.chunkMessage(long, 500);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 500, `chunk too long: ${c.length}`);
  assert.equal(chunks.join("\n").replace(/\s+/g, " "), long.replace(/\s+/g, " "));
});

test("chunkMessage closes and reopens a code fence cut across chunks", () => {
  const code = ["```ts", ...Array.from({ length: 80 }, (_, i) => `const v${i} = ${i};`), "```"].join("\n");
  const chunks = t.chunkMessage(`Here is the diff:\n${code}\nDone.`, 400);
  assert.ok(chunks.length > 2);
  for (const c of chunks) {
    const fences = (c.match(/^```.*$/gm) || []).length;
    assert.equal(fences % 2, 0, `unbalanced fences in chunk:\n${c}`);
  }
  assert.ok(chunks[1].startsWith("```ts\n"));
});

test("extractFinalText returns the assistant reply and drops tool lines and reasoning", () => {
  assert.equal(
    t.extractFinalText("Showing 1 of 6 activities (limited to 1)\n\n**Done**\n\n- hostname: `x`\n\n[docs](https://example.com)"),
    "**Done**\n\n- hostname: `x`\n\n[docs](https://example.com)",
  );
  assert.equal(t.extractFinalText("Showing 1 of 6 activities (limited to 1)\n\n[Shell] echo hi"), "");
  assert.equal(t.extractFinalText("Showing 1 of 2 activities (limited to 1)\n\n[User] do the thing"), "");
  assert.equal(t.extractFinalText("Showing 2 of 9 activities (limited to 2)\n\nAll merged.\n[Thought] I should stop"), "All merged.");
  assert.equal(t.extractFinalText("Showing 1 of 9 activities (limited to 1)\n\n[Thought] hmm"), "");
  assert.equal(t.extractFinalText(""), "");
});

test("redactSecrets masks credential shapes and leaves prose alone", () => {
  const out = t.redactSecrets(
    "token ahdk_abcdefghijklmnop and ghp_abcdefghijklmnopqrstuvwxyz123 and mongodb://user:pass@host:27017/db fine text",
  );
  assert.ok(!out.includes("ahdk_abcdefghijklmnop"));
  assert.ok(!out.includes("ghp_abcdefghijklmnopqrstuvwxyz123"));
  assert.ok(!out.includes("user:pass"));
  assert.ok(out.includes("mongodb://[redacted]@host:27017/db"));
  assert.ok(out.endsWith("fine text"));
  assert.equal(t.redactSecrets("PR #123 merged at 4f2a9c1"), "PR #123 merged at 4f2a9c1");
});

test("isSilent only matches the bare sentinel", () => {
  assert.equal(t.isSilent("[silent]"), true);
  assert.equal(t.isSilent("  [SILENT]\n"), true);
  assert.equal(t.isSilent("[silent] but also this"), false);
  assert.equal(t.isSilent(""), false);
});

test("parseDuration understands minutes, hours, seconds and combinations", () => {
  assert.equal(t.parseDuration("15m"), 15 * 60000);
  assert.equal(t.parseDuration("2h"), 2 * 3600000);
  assert.equal(t.parseDuration("1h30m"), 90 * 60000);
  assert.equal(t.parseDuration("90s"), 90000);
  assert.equal(t.parseDuration("20"), 20 * 60000);
  assert.equal(t.parseDuration("soon"), null);
  assert.equal(t.parseDuration("10x"), null);
  assert.equal(t.parseDuration(""), null);
});

test("formatInbound labels developers, check-ins and heal results", () => {
  const prompt = t.formatInbound(
    [
      { kind: "message", messageId: "1", authorName: "Egg", trusted: true, content: "what turn is it" },
      { kind: "wakeup", note: "check the turn again" },
      { kind: "heal", note: "applied by Ariane, 3 records changed, verified" },
    ],
    { channelName: "dev-chat" },
  );
  assert.match(prompt, /in #dev-chat/);
  assert.match(prompt, /\[Egg, developer, message 1\]:\nwhat turn is it/);
  assert.match(prompt, /Check-in you scheduled.*check the turn again/);
  assert.match(prompt, /\[Heal result\]: applied by Ariane/);
  assert.doesNotMatch(prompt, /UNTRUSTED/);
});

test("redactSecrets masks private and internal details", () => {
  const out = t.redactSecrets(
    "player bob@example.com from 203.0.113.7 hash $2b$10$abcdefghijklmnopqrstuuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012 at /root/projects/x/.env via localhost:9730 and MONGODB_URI=mongodb://a",
  );
  for (const leak of ["bob@example.com", "203.0.113.7", "$2b$10$", "/root/projects", "localhost:9730", "MONGODB_URI="]) {
    assert.ok(!out.includes(leak), `leaked ${leak}: ${out}`);
  }
  assert.equal(t.redactSecrets("Turn 48, version 1.12.0, 3 records"), "Turn 48, version 1.12.0, 3 records");
});

test("parseCommandFooter reads the despatch-box marker only", () => {
  assert.equal(t.parseCommandFooter("Despatch box · start"), "start");
  assert.equal(t.parseCommandFooter("Despatch box · stop"), "stop");
  assert.equal(t.parseCommandFooter("Despatch box · delete everything"), null);
  assert.equal(t.parseCommandFooter("ahousedividedgame.com"), null);
  assert.equal(t.parseCommandFooter(undefined), null);
});
