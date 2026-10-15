"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

// Keir conversation archive: DMs, tickets and guild threads, plus reward
// claims. SQLite so the ops dashboard can page through history cheaply.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS threads (
  channel_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT,
  display_name TEXT,
  last_message_id TEXT,
  last_message_at INTEGER,
  last_inbound_at INTEGER,
  unread INTEGER NOT NULL DEFAULT 0,
  hint_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS threads_recent ON threads(last_message_at DESC);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  content TEXT NOT NULL DEFAULT '',
  attachments TEXT NOT NULL DEFAULT '[]',
  sent_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_thread ON messages(channel_id, created_at);
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign TEXT NOT NULL,
  discord_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  status TEXT NOT NULL,
  character_id TEXT,
  character_name TEXT,
  itch_username TEXT,
  evidence TEXT NOT NULL DEFAULT '[]',
  verdict TEXT,
  flags TEXT NOT NULL DEFAULT '[]',
  grant_result TEXT,
  note TEXT,
  reviewed_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (campaign, discord_id)
);
CREATE INDEX IF NOT EXISTS claims_status ON claims(status, updated_at);
CREATE TABLE IF NOT EXISTS image_hashes (
  sha256 TEXT NOT NULL,
  claim_id INTEGER NOT NULL,
  PRIMARY KEY (sha256, claim_id)
);
`;

const json = (v, fallback) => { try { return v == null ? fallback : JSON.parse(v); } catch { return fallback; } };

function rowClaim(r) {
  if (!r) return null;
  return { ...r, evidence: json(r.evidence, []), verdict: json(r.verdict, null), flags: json(r.flags, []), grant_result: json(r.grant_result, null) };
}

function createInboxStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  const columns = new Set(db.prepare("PRAGMA table_info(threads)").all().map((r) => r.name));
  for (const [name, type] of [["kind", "TEXT NOT NULL DEFAULT 'dm'"], ["channel_name", "TEXT"], ["guild_id", "TEXT"]]) {
    if (!columns.has(name)) db.exec(`ALTER TABLE threads ADD COLUMN ${name} ${type}`);
  }
  db.exec("CREATE TABLE IF NOT EXISTS discovery (channel_id TEXT PRIMARY KEY, cursor TEXT NOT NULL)");

  function upsertThread({ channelId, userId = "", username, displayName, at, kind = "dm", channelName, guildId }) {
    db.prepare(`INSERT INTO threads (channel_id, user_id, username, display_name, created_at, kind, channel_name, guild_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET username = COALESCE(excluded.username, username), display_name = COALESCE(excluded.display_name, display_name),
      kind = excluded.kind, channel_name = COALESCE(excluded.channel_name, channel_name), guild_id = COALESCE(excluded.guild_id, guild_id)`)
      .run(channelId, userId, username ?? null, displayName ?? null, at, kind, channelName ?? null, guildId ?? null);
  }

  /** Returns true when the message is new. */
  function addMessage(m) {
    const r = db.prepare(`INSERT OR IGNORE INTO messages (id, channel_id, author_id, author_name, direction, content, attachments, sent_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(m.id, m.channelId, m.authorId, m.authorName ?? null, m.direction, m.content || "", JSON.stringify(m.attachments || []), m.sentBy ?? null, m.at);
    if (!r.changes) {
      db.prepare("UPDATE messages SET content = ?, attachments = ?, author_name = COALESCE(?, author_name) WHERE id = ?")
        .run(m.content || "", JSON.stringify(m.attachments || []), m.authorName ?? null, m.id);
      return false;
    }
    db.prepare(`UPDATE threads SET
        last_message_id = CASE WHEN last_message_at IS NULL OR ? >= last_message_at THEN ? ELSE last_message_id END,
        last_message_at = MAX(COALESCE(last_message_at, 0), ?),
        last_inbound_at = CASE WHEN ? = 'in' THEN MAX(COALESCE(last_inbound_at, 0), ?) ELSE last_inbound_at END,
        unread = unread + CASE WHEN ? = 'in' THEN 1 ELSE 0 END
      WHERE channel_id = ?`)
      .run(m.at, m.id, m.at, m.direction, m.at, m.direction, m.channelId);
    return true;
  }

  const hasMessage = (id) => Boolean(db.prepare("SELECT 1 FROM messages WHERE id = ?").get(id));
  const thread = (channelId) => db.prepare("SELECT * FROM threads WHERE channel_id = ?").get(channelId) || null;
  const threadForUser = (userId) => db.prepare("SELECT * FROM threads WHERE user_id = ? AND kind = 'dm' ORDER BY last_message_at DESC LIMIT 1").get(userId) || null;
  const markRead = (channelId) => db.prepare("UPDATE threads SET unread = 0 WHERE channel_id = ?").run(channelId);
  const setHint = (channelId, at) => db.prepare("UPDATE threads SET hint_at = ? WHERE channel_id = ?").run(at, channelId);

  function listThreads({ limit = 100, before = null, q = null } = {}) {
    const where = [], args = [];
    if (before) { where.push("t.last_message_at < ?"); args.push(Number(before)); }
    if (q) { where.push("(t.username LIKE ? OR t.display_name LIKE ? OR t.user_id = ? OR c.character_name LIKE ? OR c.itch_username LIKE ? OR t.channel_name LIKE ? OR EXISTS (SELECT 1 FROM messages sm WHERE sm.channel_id = t.channel_id AND (sm.content LIKE ? OR sm.author_name LIKE ?)))"); const like = `%${q}%`; args.push(like, like, q, like, like, like, like, like); }
    const sql = `SELECT t.*, c.id AS claim_id, c.status AS claim_status, c.character_name,
        (SELECT content FROM messages m WHERE m.channel_id = t.channel_id ORDER BY created_at DESC LIMIT 1) AS preview
      FROM threads t LEFT JOIN claims c ON c.channel_id = t.channel_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY t.last_message_at DESC LIMIT ?`;
    return db.prepare(sql).all(...args, Math.min(Number(limit) || 100, 500));
  }

  function messages(channelId, { limit = 500, before = null } = {}) {
    return db.prepare("SELECT * FROM messages WHERE channel_id = ? AND (? IS NULL OR length(id) < length(?) OR (length(id) = length(?) AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?")
      .all(channelId, before, before, before, before, Math.max(1, Math.min(Number(limit) || 500, 500)))
      .reverse().map((m) => ({ ...m, attachments: json(m.attachments, []) }));
  }

  function recentInbound(channelId, sinceMs) {
    return db.prepare("SELECT * FROM messages WHERE channel_id = ? AND direction = 'in' AND created_at >= ? ORDER BY created_at")
      .all(channelId, sinceMs).map((m) => ({ ...m, attachments: json(m.attachments, []) }));
  }

  const activeThreads = (sinceMs) => db.prepare("SELECT * FROM threads WHERE last_message_at >= ?").all(sinceMs);

  // ── claims ──
  const claim = (id) => rowClaim(db.prepare("SELECT * FROM claims WHERE id = ?").get(id));
  const claimFor = (campaign, discordId) => rowClaim(db.prepare("SELECT * FROM claims WHERE campaign = ? AND discord_id = ?").get(campaign, discordId));
  const claimsByStatus = (statuses, limit = 200) =>
    db.prepare(`SELECT * FROM claims WHERE status IN (${statuses.map(() => "?").join(",")}) ORDER BY updated_at DESC LIMIT ?`).all(...statuses, limit).map(rowClaim);

  function openClaim({ campaign, discordId, channelId, at }) {
    db.prepare(`INSERT OR IGNORE INTO claims (campaign, discord_id, channel_id, status, created_at, updated_at) VALUES (?, ?, ?, 'collecting', ?, ?)`)
      .run(campaign, discordId, channelId, at, at);
    return claimFor(campaign, discordId);
  }

  const CLAIM_FIELDS = new Set(["status", "character_id", "character_name", "itch_username", "evidence", "verdict", "flags", "grant_result", "note", "reviewed_by"]);
  function updateClaim(id, fields, at = Date.now()) {
    const keys = Object.keys(fields).filter((k) => CLAIM_FIELDS.has(k));
    if (!keys.length) return claim(id);
    const values = keys.map((k) => (["evidence", "verdict", "flags", "grant_result"].includes(k) ? JSON.stringify(fields[k]) : fields[k]));
    db.prepare(`UPDATE claims SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...values, at, id);
    return claim(id);
  }

  /** Atomic status transition; returns the claim when this caller won it. */
  function transitionClaim(id, from, to, at = Date.now()) {
    const r = db.prepare(`UPDATE claims SET status = ?, updated_at = ? WHERE id = ? AND status IN (${from.map(() => "?").join(",")})`).run(to, at, id, ...from);
    return r.changes ? claim(id) : null;
  }

  function recordHashes(claimId, hashes) {
    const stmt = db.prepare("INSERT OR IGNORE INTO image_hashes (sha256, claim_id) VALUES (?, ?)");
    for (const h of hashes) stmt.run(h, claimId);
  }
  const hashOwners = (hashes, exceptClaimId) => hashes.length
    ? db.prepare(`SELECT DISTINCT claim_id FROM image_hashes WHERE sha256 IN (${hashes.map(() => "?").join(",")}) AND claim_id != ?`).all(...hashes, exceptClaimId).map((r) => r.claim_id)
    : [];
  const itchUsernameOwners = (campaign, itch, exceptClaimId) =>
    db.prepare("SELECT id, discord_id, status FROM claims WHERE campaign = ? AND lower(itch_username) = lower(?) AND id != ? AND status NOT IN ('rejected')").all(campaign, itch, exceptClaimId);
  const normalizeComment = (t) => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  function commentOwners(campaign, text, exceptClaimId) {
    const want = normalizeComment(text);
    if (want.length < 12) return []; // "great game!" is a coincidence, not a reuse
    return db.prepare("SELECT id, discord_id, json_extract(verdict, '$.comment_text') AS t FROM claims WHERE campaign = ? AND id != ? AND status != 'rejected' AND verdict IS NOT NULL")
      .all(campaign, exceptClaimId).filter((r) => normalizeComment(r.t) === want).map(({ id, discord_id }) => ({ id, discord_id }));
  }
  const characterOwners = (campaign, characterId, exceptClaimId) =>
    db.prepare("SELECT id, discord_id, status FROM claims WHERE campaign = ? AND character_id = ? AND id != ? AND status NOT IN ('rejected')").all(campaign, characterId, exceptClaimId);

  function stats() {
    const byStatus = Object.fromEntries(db.prepare("SELECT status, COUNT(*) n FROM claims GROUP BY status").all().map((r) => [r.status, r.n]));
    const unread = db.prepare("SELECT COALESCE(SUM(unread), 0) n FROM threads").get().n;
    const threads = db.prepare("SELECT COUNT(*) n FROM threads").get().n;
    const conversations = Object.fromEntries(db.prepare("SELECT kind, COUNT(*) n FROM threads GROUP BY kind").all().map((r) => [r.kind, r.n]));
    return { threads, unread, conversations, claims: byStatus };
  }

  return {
    discoveryCursor: (channelId) => db.prepare("SELECT cursor FROM discovery WHERE channel_id = ?").get(channelId)?.cursor,
    setDiscoveryCursor: (channelId, cursor) => db.prepare("INSERT INTO discovery VALUES (?, ?) ON CONFLICT(channel_id) DO UPDATE SET cursor = excluded.cursor").run(channelId, cursor),
    db, upsertThread, addMessage, hasMessage, thread, threadForUser, markRead, setHint, listThreads, messages, recentInbound, activeThreads,
    claim, claimFor, claimsByStatus, openClaim, updateClaim, transitionClaim, recordHashes, hashOwners, itchUsernameOwners, characterOwners, commentOwners, stats,
    close: () => db.close(),
  };
}

module.exports = { createInboxStore };
