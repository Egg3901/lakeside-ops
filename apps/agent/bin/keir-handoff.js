#!/usr/bin/env node
"use strict";
// Hand support work to Keir, or check Keir's support status. For other
// operators on this host (Codex). Reads the admin token from
// /etc/keir-operator.env; Keir must be running.
//   keir-handoff.js status
//   keir-handoff.js hold <operator>            Keir defers ticket work to <operator>
//   keir-handoff.js hold-ticket <n> <owner>    Keir stands down on one ticket (owner "keir" gives it back)
//   keir-handoff.js assign <n> <runner:model[@effort]>   run that ticket on a chosen model from its next activation
//   keir-handoff.js send handoff.json          file a handoff, print the receipt
//   keir-handoff.js receipt <handoff-id>       (via status) incorporation state
// handoff.json: { "id": "codex-1530-1", "from": "codex", "scope": "...",
//   "asks": ["..."], "tickets": [1530], "body": "full state, <= 4000 chars",
//   "document": { "name": "ops-knowledge slug", "digest": "..." },
//   "releasesSupport": false }
// A handoff moves ownership and context. It never approves anything.
const fs = require("node:fs");

const envFile = process.env.KEIR_OPERATOR_ENV || "/etc/keir-operator.env";
const env = Object.fromEntries(fs.readFileSync(envFile, "utf8").split("\n")
  .map((l) => /^([A-Z_]+)=(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].replace(/^"|"$/g, "")]));
const base = `http://127.0.0.1:${env.KEIR_OPERATOR_PORT || 9765}`;
const headers = { Authorization: `Bearer ${env.KEIR_OPERATOR_ADMIN_TOKEN}`, "Content-Type": "application/json" };

async function call(method, route, body) {
  const res = await fetch(base + route, { method, headers, body: body && JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return JSON.parse(text);
}

(async () => {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "status") { const s = await call("GET", "/v3/status"); console.log(JSON.stringify({ supportOwner: s.supportOwner, lanes: s.lanes }, null, 2)); return; }
  if (cmd === "assign" && arg && process.argv[4]) { console.log(JSON.stringify(await call("POST", "/v3/ticket-model", { ticket: Number(arg), model: process.argv[4], by: "keir-handoff" }), null, 2)); return; }
  if (cmd === "hold-ticket" && arg && process.argv[4]) { console.log(JSON.stringify(await call("POST", "/v3/ticket-owner", { ticket: Number(arg), owner: process.argv[4], by: "keir-handoff" }), null, 2)); return; }
  if (cmd === "hold" && arg) { console.log(JSON.stringify(await call("POST", "/v3/support-owner", { owner: arg, by: "keir-handoff" }), null, 2)); return; }
  if (cmd === "send" && arg) { console.log(JSON.stringify(await call("POST", "/v3/handoff", JSON.parse(fs.readFileSync(arg, "utf8"))), null, 2)); return; }
  console.error(fs.readFileSync(__filename, "utf8").split("\n").slice(2, 15).join("\n"));
  process.exit(2);
})().catch((e) => { console.error(e.message); process.exit(1); });
