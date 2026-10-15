#!/usr/bin/env node
"use strict";
// One-off (re-runnable) backfill of Keir's notebook from past tickets: a
// resolution note per closed ticket and a private note on the player who raised
// it. Moderation tickets are skipped. Duplicates are ignored by the notebook.
// Usage: keir-backfill-tickets.js [--from N] [--to N] [--dry]
const fs = require("node:fs");
const { createMcp } = require("../lib/operator/broker");
const { readAgentToken } = require("../lib/operator/token");
const argv = process.argv.slice(2), opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : undefined; };
const dry = argv.includes("--dry");
const env = Object.fromEntries(fs.readFileSync("/etc/keir-operator.env", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const mcp = createMcp("/root/.claude.json", readAgentToken("/etc/keir-agent.env"));
const post = (note) => dry ? Promise.resolve({ ok: true }) : fetch(`http://127.0.0.1:${env.KEIR_OPERATOR_PORT || 9765}/notebook`, { method: "POST",
  headers: { Authorization: `Bearer ${env.KEIR_OPERATOR_ADMIN_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...note, by: "ticket-backfill" }) });
const short = (t, n) => String(t || "").replace(/\s+/g, " ").replace(/[–—]/g, ",").trim().slice(0, n);
(async () => {
  const from = opt("--from") || 1, to = opt("--to") || 99999;
  let resolutions = 0, players = 0, skipped = 0;
  for (let n = to === 99999 ? 1600 : to; n >= from; n--) {
    let t; try { t = await mcp.call("support", "support_get", { kind: "ticket", number: n }, false); } catch { continue; }
    if (!t || !t.number) continue;
    if (String(t.category).toLowerCase() === "moderation" || !["resolved", "closed"].includes(t.status)) { skipped++; continue; }
    const last = (t.publicUpdates || []).filter((u) => u.kind !== "heal").at(-1)?.message;
    const outcome = short(t.resolution?.message || last || "", 380);
    if (!outcome) { skipped++; continue; }
    const title = short(t.title, 90);
    if ((await post({ kind: "resolution", ticket: n, text: `Ticket ${n} ("${title}", ${t.category}): ${outcome}` })).ok) resolutions++;
    const id = /\/character\/(\d+)/.exec(t.reporter?.profileUrl || "")?.[1];
    if (id && (await post({ kind: "player", player: id, ticket: n, text: `${t.reporter.characterName || "Player"} raised ticket ${n} ("${title}"); outcome: ${short(outcome, 240)}` })).ok) players++;
  }
  console.log(JSON.stringify({ resolutions, players, skipped, dry }));
})();
