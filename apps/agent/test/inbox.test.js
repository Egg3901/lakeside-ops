"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { createInboxStore } = require("../lib/inbox/store");
const { createIngest } = require("../lib/inbox/ingest");
const { createClaims, decide, COPY } = require("../lib/inbox/claims");
const { createPublicHandler, createAdminHandler } = require("../lib/inbox/http");

const BOT = "1479984768194969663";
const OLD_USER = "222222222222222222"; // 2016-era snowflake: an established account
const OWNER = "333052320252297216";
let seq = 900000000000000000n;
const nextId = () => String(seq++);

// Each fixture opens a SQLite file and saves attachments; remove them all after the run.
const dirs = [];
test.after(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function fixture({ characters = [{ id: "c1", name: "Senator Ada", createdAt: "2026-01-01T00:00:00Z" }], verdict, active = true, testers = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-")); dirs.push(dir);
  const store = createInboxStore(path.join(dir, "inbox.db"));
  const sent = [], grants = [], channels = {}, messages = {};
  const discord = async (method, route, body) => {
    let m = /^\/channels\/(\d+)$/.exec(route);
    if (method === "GET" && m) { if (!channels[m[1]]) { const e = new Error("404"); e.status = 404; throw e; } return channels[m[1]]; }
    m = /^\/channels\/(\d+)\/messages\/(\d+)$/.exec(route);
    if (method === "GET" && m) return messages[m[2]];
    m = /^\/channels\/(\d+)\/messages\?/.exec(route);
    if (method === "GET" && m) return [];
    m = /^\/channels\/(\d+)\/messages$/.exec(route);
    if (method === "POST" && m) { sent.push({ channelId: m[1], content: body.content }); return { id: nextId(), content: body.content, timestamp: new Date().toISOString() }; }
    throw new Error(`unexpected ${method} ${route}`);
  };
  const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => Buffer.from(`img-${Math.random()}`) });
  const ingest = createIngest({ discord, store, botId: BOT, attachmentsDir: path.join(dir, "att"), fetchImpl });
  const game = {
    characters: async () => characters,
    grant: async (args) => { grants.push(args); return { status: grants.length > 1 ? "already_granted" : "granted", characterName: "Senator Ada", amountAnchor: 5_000_000, currency: "USD", amountLocal: 5_000_000 }; },
  };
  const vision = { inspect: async () => (typeof verdict === "function" ? verdict() : verdict ?? GOOD) };
  const timers = [];
  const claims = createClaims({ store, ingest, game, vision, campaign: "itch-boost-2026-10", active, staffIds: [OWNER], testers, botId: BOT, log: () => {}, setTimer: (fn) => { timers.push(fn); return timers.length; } });
  const dm = (userId) => {
    const channelId = nextId();
    channels[channelId] = { id: channelId, type: 1, recipients: [{ id: userId, username: `u${userId.slice(-3)}` }] };
    return channelId;
  };
  async function receive(channelId, userId, { content = "", images = 0, imageBytes, files = [] } = {}) {
    const id = nextId();
    messages[id] = { id, content, timestamp: new Date().toISOString(), author: { id: userId, username: "player" },
      attachments: [...Array.from({ length: images }, (_, i) => ({ id: `${id}${i}`, filename: "shot.png", content_type: "image/png", size: 100, url: "https://cdn.example/x.png" })),
        ...files.map((f, i) => ({ id: `${id}9${i}`, size: 100, url: "https://cdn.example/f", ...f }))] };
    const fetchFixed = imageBytes ? async () => ({ ok: true, arrayBuffer: async () => Buffer.from(imageBytes) }) : null;
    const ing = fetchFixed ? createIngest({ discord, store, botId: BOT, attachmentsDir: path.join(dir, "att"), fetchImpl: fetchFixed }) : ingest;
    const out = await ing.ingestPoke(channelId, id);
    if (out.isNew) await claims.onMessage(out.message);
    return out;
  }
  const flush = async () => { while (timers.length) await timers.shift()(); await new Promise((r) => setImmediate(r)); };
  return { store, claims, sent, grants, dm, receive, flush, ingest, dir };
}

const GOOD = { is_itch_page: true, game_matches: true, logged_in_username: "ada_plays", in_collection: true, comment_found: true, comment_author: "ada_plays", comment_text: "Loved the election night map, the coalition building is great.", edit_suspicion: "none", notes: "" };

test("decide: clean evidence is approved, missing pieces ask for more", () => {
  assert.equal(decide({ verdict: GOOD, flags: [] }).status, "approved");
  assert.equal(decide({ verdict: { ...GOOD, in_collection: false }, flags: [] }).reply, COPY.needCollection);
  assert.equal(decide({ verdict: { ...GOOD, comment_found: false }, flags: [] }).reply, COPY.needComment);
  assert.equal(decide({ verdict: { ...GOOD, game_matches: false }, flags: [] }).reply, COPY.notItch);
  assert.equal(decide({ verdict: null, flags: [] }).status, "needs_review");
  assert.deepEqual(decide({ verdict: GOOD, flags: ["new_character"] }), { status: "needs_review", flags: ["new_character"] });
});

test("a clean claim is acknowledged, granted once and confirmed", async () => {
  const f = fixture();
  const ch = f.dm(OLD_USER);
  await f.receive(ch, OLD_USER, { images: 1, content: "my character is Senator Ada" });
  assert.equal(f.sent[0].content, COPY.ack);
  await f.flush();
  const claim = f.store.claimFor("itch-boost-2026-10", OLD_USER);
  assert.equal(claim.status, "granted");
  assert.equal(f.grants.length, 1);
  assert.equal(f.grants[0].claimRef, `keir-inbox:${claim.id}`);
  assert.match(f.sent.at(-1).content, /₳5,000,000 has been added to Senator Ada's personal funds/);
  // A second attempt is answered without another grant.
  await f.receive(ch, OLD_USER, { images: 1 });
  assert.equal(f.grants.length, 1);
  assert.equal(f.sent.at(-1).content, COPY.already);
});

test("messages and both directions are recorded in the thread", async () => {
  const f = fixture();
  const ch = f.dm(OLD_USER);
  await f.receive(ch, OLD_USER, { content: "hello" });
  const msgs = f.store.messages(ch);
  assert.deepEqual(msgs.map((m) => m.direction), ["in", "out"]);
  assert.equal(msgs[1].content, COPY.hintActive);
  assert.equal(f.store.thread(ch).unread, 1);
  // The hint is not repeated within a day.
  await f.receive(ch, OLD_USER, { content: "anyone there?" });
  assert.equal(f.sent.length, 1);
});

test("staff DMs are stored but never answered by the claim desk", async () => {
  const f = fixture();
  const ch = f.dm(OWNER);
  await f.receive(ch, OWNER, { images: 1, content: "test" });
  await f.flush();
  assert.equal(f.sent.length, 0);
  assert.equal(f.store.messages(ch).length, 1);
  assert.equal(f.store.claimFor("itch-boost-2026-10", OWNER), null);
});

test("incomplete evidence asks for the missing piece, a resend completes it", async () => {
  let n = 0;
  const f = fixture({ verdict: () => (n++ === 0 ? { ...GOOD, in_collection: false } : GOOD) });
  const ch = f.dm(OLD_USER);
  await f.receive(ch, OLD_USER, { images: 1 });
  await f.flush();
  assert.equal(f.store.claimFor("itch-boost-2026-10", OLD_USER).status, "incomplete");
  assert.equal(f.sent.at(-1).content, COPY.needCollection);
  await f.receive(ch, OLD_USER, { images: 1 });
  await f.flush();
  assert.equal(f.store.claimFor("itch-boost-2026-10", OLD_USER).status, "granted");
});

test("a reused screenshot goes to review instead of paying", async () => {
  const f = fixture();
  const a = f.dm(OLD_USER), bUser = "222222222222222223", b = f.dm(bUser);
  await f.receive(a, OLD_USER, { images: 1, imageBytes: "same-bytes" });
  await f.flush();
  await f.receive(b, bUser, { images: 1, imageBytes: "same-bytes" });
  await f.flush();
  const claim = f.store.claimFor("itch-boost-2026-10", bUser);
  assert.equal(claim.status, "needs_review");
  assert.ok(claim.flags.includes("duplicate_image"));
  assert.ok(claim.flags.includes("itch_username_reused"));
  assert.equal(f.grants.length, 1);
  assert.equal(f.sent.at(-1).content, COPY.review);
});

test("short comments, new characters and new Discord accounts are reviewed", async () => {
  const f = fixture({ verdict: { ...GOOD, comment_text: "cool game" }, characters: [{ id: "c9", name: "Newbie", createdAt: new Date().toISOString() }] });
  const fresh = String((BigInt(Date.now() - 1420070400000) << 22n));
  const ch = f.dm(fresh);
  await f.receive(ch, fresh, { images: 1 });
  await f.flush();
  const claim = f.store.claimFor("itch-boost-2026-10", fresh);
  assert.equal(claim.status, "needs_review");
  for (const flag of ["low_effort_comment", "new_character", "new_discord_account"]) assert.ok(claim.flags.includes(flag), flag);
});

test("a moderator approves a reviewed claim and the player is told", async () => {
  const f = fixture({ verdict: { ...GOOD, comment_text: "nice" } });
  const ch = f.dm(OLD_USER);
  await f.receive(ch, OLD_USER, { images: 1 });
  await f.flush();
  const claim = f.store.claimFor("itch-boost-2026-10", OLD_USER);
  const out = await f.claims.approve(claim.id, "mod@example");
  assert.equal(out.ok, true);
  assert.equal(out.claim.status, "granted");
  assert.equal(out.claim.reviewed_by, "mod@example");
  assert.match(f.sent.at(-1).content, /personal funds/);
  assert.equal((await f.claims.approve(claim.id, "mod@example")).ok, false);
});

test("an unlinked account is told how to link, then rechecked on any message", async () => {
  const chars = [];
  const f = fixture({ characters: chars });
  const ch = f.dm(OLD_USER);
  await f.receive(ch, OLD_USER, { images: 1 });
  await f.flush();
  assert.equal(f.store.claimFor("itch-boost-2026-10", OLD_USER).status, "not_linked");
  assert.equal(f.sent.at(-1).content, COPY.notLinked);
  chars.push({ id: "c1", name: "Senator Ada", createdAt: "2026-01-01T00:00:00Z" });
  await f.receive(ch, OLD_USER, { content: "linked it" });
  await f.flush();
  assert.equal(f.store.claimFor("itch-boost-2026-10", OLD_USER).status, "granted");
});

test("an inactive campaign records DMs and only sends the general hint", async () => {
  const f = fixture({ active: false });
  const ch = f.dm(OLD_USER);
  await f.receive(ch, OLD_USER, { images: 1 });
  await f.flush();
  assert.equal(f.store.claimFor("itch-boost-2026-10", OLD_USER), null);
  assert.deepEqual(f.sent.map((s) => s.content), [COPY.hintIdle]);
});

test("restart recovery re-runs an interrupted grant exactly through the idempotent path", async () => {
  const f = fixture();
  const ch = f.dm(OLD_USER);
  await f.receive(ch, OLD_USER, { images: 1 });
  const claim = f.store.claimFor("itch-boost-2026-10", OLD_USER);
  f.store.updateClaim(claim.id, { status: "granting" });
  f.claims.recover();
  await f.flush();
  assert.equal(f.store.claim(claim.id).status, "granted");
  assert.equal(f.grants.length, 1);
});

async function serve(handler) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

test("public poke rejects bad ids and non-DM channels; admin needs the token", async () => {
  const f = fixture();
  const pub = await serve(createPublicHandler({ ingest: f.ingest, onNew: () => {}, log: () => {} }));
  const admin = await serve(createAdminHandler({ token: "t0k", store: f.store, ingest: f.ingest, claims: f.claims, attachmentsDir: f.dir, log: () => {} }));
  try {
    let r = await fetch(`${pub.url}/api/keir/inbox/poke`, { method: "POST", body: JSON.stringify({ channelId: "x", messageId: "1" }) });
    assert.equal(r.status, 400);
    r = await fetch(`${pub.url}/api/keir/inbox/poke`, { method: "POST", body: JSON.stringify({ channelId: "111111111111111111", messageId: "111111111111111112" }) });
    assert.equal(r.status, 400);
    const ch = f.dm(OLD_USER);
    await f.receive(ch, OLD_USER, { content: "hi" });
    r = await fetch(`${admin.url}/threads`);
    assert.equal(r.status, 401);
    r = await fetch(`${admin.url}/threads`, { headers: { Authorization: "Bearer t0k" } });
    assert.equal((await r.json()).threads.length, 1);
    r = await fetch(`${admin.url}/threads/${ch}/reply`, { method: "POST", headers: { Authorization: "Bearer t0k" }, body: JSON.stringify({ content: "Hello from staff", by: "mod@example" }) });
    assert.equal(r.status, 200);
    const last = f.store.messages(ch).at(-1);
    assert.equal(last.sent_by, "mod@example");
    assert.equal(f.store.thread(ch).unread, 0);
  } finally { pub.close(); admin.close(); }
});

test("guild conversations preserve context, edits and search without reward processing", async () => {
  const f = fixture();
  const guildId = "1465445442987888743", channelId = nextId();
  const ing = createIngest({ discord: async () => {}, store: f.store, botId: BOT, guildId, attachmentsDir: path.join(f.dir, "guild") });
  const ch = { id: channelId, guild_id: guildId, name: "ticket-test-1502", type: 0 };
  const make = (authorId, content) => ({ id: nextId(), author: { id: authorId, username: authorId === BOT ? "Keir" : "Reporter" }, content, timestamp: new Date().toISOString() });
  const inbound = make(OLD_USER, "My widget broke"), reply = make(BOT, "Checking the widget");
  const rows = await ing.recordChannel(ch, [inbound, reply]);
  for (const r of rows) await f.claims.onMessage(r.message);
  assert.equal(f.store.thread(channelId).kind, "ticket");
  assert.deepEqual(f.store.messages(channelId).map((m) => m.direction), ["in", "out"]);
  assert.equal(f.sent.length, 0);
  assert.equal(f.grants.length, 0);
  await ing.recordChannel(ch, [{ ...reply, content: "Widget repaired" }]);
  assert.equal(f.store.messages(channelId).length, 2);
  assert.equal(f.store.messages(channelId).at(-1).content, "Widget repaired");
  assert.equal(f.store.thread(channelId).unread, 1);
  assert.equal(f.store.listThreads({ q: "repaired" }).length, 1);
  assert.equal(f.store.listThreads({ q: "1502" }).length, 1);
  assert.equal(f.store.messages(channelId, { before: reply.id }).length, 1);
  assert.equal(f.store.threadForUser(OLD_USER), null);
  assert.equal(f.store.stats().conversations.ticket, 1);
});

test("ambient chat and other guilds cannot create archive conversations", async () => {
  const f = fixture(), guildId = "1465445442987888743";
  const ing = createIngest({ discord: async () => {}, store: f.store, botId: BOT, guildId, attachmentsDir: path.join(f.dir, "guild") });
  const msg = { id: nextId(), author: { id: OLD_USER, username: "Reporter" }, content: "hello", timestamp: new Date().toISOString() };
  const ch = { id: nextId(), guild_id: guildId, name: "general", type: 0 };
  assert.deepEqual(await ing.recordChannel(ch, [msg]), []);
  assert.deepEqual(await ing.recordChannel({ ...ch, guild_id: "222222222222222222" }, [{ ...msg, author: { id: BOT } }]), []);
  await ing.recordChannel(ch, [{ ...msg, mentions: [{ id: BOT }] }]);
  assert.equal(f.store.thread(ch.id).kind, "channel");
  assert.equal(f.store.stats().threads, 1);
});

test("operator observations are authenticated and cannot trigger claims", async () => {
  const f = fixture();
  let observed = 0;
  const ing = { observe: async () => { observed++; return [{ isNew: true }]; } };
  const admin = await serve(createAdminHandler({ token: "t0k", store: f.store, ingest: ing, claims: f.claims, attachmentsDir: f.dir, log: () => {} }));
  try {
    const opts = { method: "POST", body: JSON.stringify({ channelId: nextId(), messages: [] }) };
    assert.equal((await fetch(admin.url + "/observe", opts)).status, 401);
    assert.equal(observed, 0);
    assert.equal((await fetch(admin.url + "/observe", { ...opts, headers: { Authorization: "Bearer t0k" } })).status, 200);
    assert.equal(observed, 1);
  } finally { admin.close(); }
});

test("discovery retains cursors and catches up guild and active thread conversations", async () => {
  const { createDiscovery } = require("../lib/inbox/discovery");
  const f = fixture(), guildId = "1465445442987888743";
  const ch = { id: nextId(), name: "general", type: 0 }, thread = { id: nextId(), name: "discussion", type: 11 };
  const messages = new Map([ch, thread].map((c) => [c.id, [{ id: nextId(), channel_id: c.id, author: { id: BOT, username: "Keir" }, content: "Answer", timestamp: new Date().toISOString() }]]));
  let requests = 0;
  const discord = async (method, route) => {
    if (route === `/guilds/${guildId}/channels`) return [ch];
    if (route === `/guilds/${guildId}/threads/active`) return { threads: [thread] };
    const id = /^\/channels\/(\d+)/.exec(route)?.[1];
    const c = [ch, thread].find((c) => c.id === id);
    if (route === `/channels/${id}`) return { ...c, guild_id: guildId };
    requests++;
    const after = new URL(route, "http://test").searchParams.get("after");
    return (messages.get(id) || []).filter((m) => !after || BigInt(m.id) > BigInt(after));
  };
  const ingest = createIngest({ discord, store: f.store, botId: BOT, guildId, attachmentsDir: path.join(f.dir, "guild") });
  const discovery = createDiscovery({ discord, ingest, store: f.store, guildId, now: () => Number(seq >> 22n) + 1420070400000, log: () => {} });
  await discovery.scan();
  assert.equal(f.store.stats().threads, 2);
  assert.equal(f.store.thread(thread.id).kind, "thread");
  messages.get(ch.id).push({ id: nextId(), author: { id: OLD_USER }, content: "follow up", timestamp: new Date().toISOString() });
  await discovery.scan();
  assert.equal(f.store.messages(ch.id).length, 2);
  assert.equal(f.store.messages(thread.id).length, 1);
  assert.equal(f.store.thread(ch.id).unread, 1);
  assert.equal(requests, 4);
});

test("Discord response observation preserves delivery receipts on archive failure", async () => {
  const { createDiscord } = require("../lib/operator/discord");
  const { createObserver } = require("../lib/inbox/observer");
  const message = { id: nextId(), author: { id: BOT }, content: "sent", timestamp: new Date().toISOString() };
  let apiCalls = 0, archiveCalls = 0;
  const observer = createObserver({ token: "private", fetchImpl: async () => { archiveCalls++; throw new Error("offline"); }, log: () => {} });
  const discord = createDiscord({ token: "bot", onMessages: observer, fetchImpl: async () => { apiCalls++; return { ok: true, status: 200, json: async () => message }; } });
  assert.deepEqual(await discord("POST", `/channels/${nextId()}/messages`, { content: "sent" }), message);
  assert.equal(apiCalls, 1);
  assert.equal(archiveCalls, 1);
});

test("alerts surface pending approvals, blocked tasks, the prod hold and shadow anomalies", () => {
  const { readAlerts } = require("../lib/inbox/alerts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keir-alerts-"));
  try {
    const now = 10_000_000;
    fs.writeFileSync(path.join(dir, "ledger.json"), JSON.stringify({
      jobs: { a: { id: "a", state: "waiting", ticket: 1506, summary: "waiting" }, b: { id: "b", state: "blocked", kind: "ticket", ticket: 1505, summary: "spawn EAGAIN", updatedAt: now - 5 }, c: { id: "c", state: "done" } },
      actions: { x: { id: "x", jobId: "a", kind: "github", state: "pending", at: now - 10, expiresAt: now + 60_000, args: { summary: "PR 10 changes the economy" } },
        y: { id: "y", jobId: "c", kind: "heal", state: "pending", at: now, expiresAt: now + 60_000 }, z: { id: "z", jobId: "a", kind: "heal", state: "pending", at: now, expiresAt: now - 1 } },
      alerts: [{ key: "effect-error:b:k", content: "x", at: now - 100 }, { key: "digest:1", content: "d", at: now }, { key: "old", content: "o", at: now - 90_000_000 }],
    }));
    fs.writeFileSync(path.join(dir, "hold"), new Date(now + 3_600_000).toISOString());
    fs.writeFileSync(path.join(dir, "shadow.json"), JSON.stringify({ at: now, anomalies: ["Task blocked [b]"] }));
    const r = readAlerts({ ledgerFile: path.join(dir, "ledger.json"), holdFile: path.join(dir, "hold"), shadowFile: path.join(dir, "shadow.json"), now });
    assert.deepEqual(r.pendingApprovals.map((a) => a.id), ["x"]);
    assert.equal(r.pendingApprovals[0].ticket, 1506);
    assert.deepEqual(r.blocked.map((b) => b.id), ["b"]);
    assert.deepEqual(r.alerts.map((a) => a.key), ["effect-error:b:k"]);
    assert.ok(r.prodHold);
    assert.deepEqual(r.shadow.anomalies, ["Task blocked [b]"]);
    assert.deepEqual(readAlerts({ ledgerFile: path.join(dir, "missing"), holdFile: path.join(dir, "missing"), shadowFile: path.join(dir, "missing"), now }), { prodHold: null, pendingApprovals: [], blocked: [], alerts: [], shadow: null });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a tester runs the full check, is never paid, and can test again", async () => {
  const f = fixture({ testers: [OWNER] });
  const ch = f.dm(OWNER);
  await f.receive(ch, OWNER, { content: "itch test" });
  assert.equal(f.sent.at(-1).content, COPY.testStart);
  await f.receive(ch, OWNER, { images: 1 });
  await f.flush();
  const claim = f.store.claimFor("itch-boost-2026-10:test", OWNER);
  assert.equal(claim.status, "granted");
  assert.equal(claim.grant_result.status, "dry_run");
  assert.equal(f.grants.length, 0);
  assert.match(f.sent.at(-1).content, /Test claim passed/);
  assert.equal(f.store.claimFor("itch-boost-2026-10", OWNER), null);
  await f.receive(ch, OWNER, { content: "itch test", images: 1 });
  await f.flush();
  assert.equal(f.grants.length, 0);
  assert.equal(f.sent.filter((m) => /Test claim passed/.test(m.content)).length, 2);
});

test("the same comment on another account is flagged even when the image bytes differ", async () => {
  const f = fixture({ verdict: () => ({ ...GOOD, comment_author: `u${Math.random()}`, logged_in_username: null }) });
  const a = f.dm(OLD_USER), bUser = "222222222222222224", b = f.dm(bUser);
  await f.receive(a, OLD_USER, { images: 1 });
  await f.flush();
  await f.receive(b, bUser, { images: 1 });
  await f.flush();
  const claim = f.store.claimFor("itch-boost-2026-10", bUser);
  assert.equal(claim.status, "needs_review");
  assert.ok(claim.flags.includes("comment_reused"));
});

test("an image that cannot be decoded asks for a PNG or JPG instead of failing", async () => {
  const f = fixture({ verdict: () => { const e = new Error("no readable images"); e.unreadable = ["x.heic"]; throw e; } });
  const ch = f.dm(OLD_USER);
  await f.receive(ch, OLD_USER, { images: 1 });
  await f.flush();
  assert.equal(f.store.claimFor("itch-boost-2026-10", OLD_USER).status, "incomplete");
  assert.equal(f.sent.at(-1).content, COPY.unreadable);
});

test("a non-image attachment gets the PNG/JPG hint; HEIC is accepted by extension", async () => {
  const f = fixture();
  const ch = f.dm(OLD_USER);
  await f.receive(ch, OLD_USER, { files: [{ filename: "proof.pdf", content_type: "application/pdf" }] });
  assert.equal(f.sent.at(-1).content, COPY.unreadable);
  const out = await f.receive(ch, OLD_USER, { files: [{ filename: "IMG_0001.HEIC" }] });
  assert.match(out.message.attachments[0].file, /\.heic$/);
});

test("tall screenshots are tiled to the model's size and HEIC decodes", { skip: !fs.existsSync("/usr/bin/magick") }, async () => {
  const sharp = require("sharp");
  const { tiles, load } = require("../lib/inbox/images");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-")); dirs.push(dir);
  const tall = path.join(dir, "tall.png");
  await sharp({ create: { width: 1170, height: 2532, channels: 3, background: "#fff" } }).png().toFile(tall);
  const parts = await tiles(tall);
  assert.equal(parts.length, 2);
  for (const p of parts) { const m = await sharp(p).metadata(); assert.ok(m.width * m.height <= 1.25e6); }
  const wide = path.join(dir, "wide.png");
  await sharp({ create: { width: 1920, height: 1080, channels: 3, background: "#fff" } }).png().toFile(wide);
  assert.equal((await tiles(wide)).length, 1);
  await assert.rejects(load(path.join(dir, "missing.heic")));
});

test("a tester's normal DMs and images are left to the operator unless they say itch test", async () => {
  const f = fixture({ testers: [OWNER] });
  const ch = f.dm(OWNER);
  await f.receive(ch, OWNER, { content: "do you think they are alts?" });
  await f.receive(ch, OWNER, { content: "here's the bug", images: 1 });
  await f.flush();
  assert.equal(f.sent.length, 0);
  assert.equal(f.store.claimFor("itch-boost-2026-10:test", OWNER), null);
  assert.equal(f.store.messages(ch).length, 2); // still recorded in the inbox
});
