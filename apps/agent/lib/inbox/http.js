"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const images = require("./images");

// Two listeners, both loopback only:
//  public: the bot's DM pokes (Caddy routes /api/keir/inbox/poke here)
//  admin:  the ops dashboard's inbox page, bearer token, proxied server-side

const snowflake = (v) => typeof v === "string" && /^\d{15,22}$/.test(v);

async function readJson(req, limit = 16 << 10) {
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > limit) { const e = new Error("body too large"); e.status = 413; throw e; } }
  try { return raw ? JSON.parse(raw) : {}; } catch { const e = new Error("invalid JSON"); e.status = 400; throw e; }
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function createRateLimit({ perMinute = 60, now = () => Date.now() } = {}) {
  const hits = new Map();
  return (key) => {
    const t = now(), list = (hits.get(key) || []).filter((x) => t - x < 60_000);
    list.push(t); hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < 60_000)) hits.delete(k);
    return list.length <= perMinute;
  };
}

function createPublicHandler({ ingest, onNew, log = console.log, allow = createRateLimit() }) {
  return async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/api/keir/inbox/health") return send(res, 200, { ok: true });
      if (req.method === "POST" && url.pathname === "/api/keir/inbox/poke") {
        const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
        if (!allow(ip)) return send(res, 429, { ok: false, error: "slow down" });
        const { channelId, messageId } = await readJson(req, 4096);
        if (!snowflake(channelId) || !snowflake(messageId)) return send(res, 400, { ok: false, error: "invalid ids" });
        const out = await ingest.ingestPoke(channelId, messageId);
        if (out.isNew) Promise.resolve(onNew(out.message)).catch((e) => log(`dm handler: ${e.stack || e.message}`));
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { ok: false, error: "not found" });
    } catch (e) {
      if (!e.status || e.status >= 500) log(`poke failed: ${e.message}`);
      // Discord 404/403 for a bad id means the poke was wrong, not that we are down.
      const status = e.status === 403 || e.status === 404 || e.status === 400 || e.status === 413 ? 400 : 502;
      return send(res, status, { ok: false, error: status === 400 ? "rejected" : "temporarily unavailable" });
    }
  };
}

function createAdminHandler({ token, store, ingest, claims, attachmentsDir, alerts = () => null, log = console.log }) {
  const expected = Buffer.from(`Bearer ${token}`);
  const authorized = (req) => {
    const actual = Buffer.from(String(req.headers.authorization || ""));
    return Boolean(token) && actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  };
  const by = (body, req) => String(body.by || req.headers["x-ops-user"] || "staff").slice(0, 120);

  return async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;
    try {
      if (!authorized(req)) return send(res, 401, { error: "unauthorized" });
      if (req.method === "POST" && p === "/observe") {
        const body = await readJson(req, 1 << 20);
        const recorded = await ingest.observe(body.channelId, body.messages);
        return send(res, 200, { ok: true, added: recorded.filter((r) => r.isNew).length });
      }
      if (req.method === "GET" && p === "/stats") return send(res, 200, store.stats());
      if (req.method === "GET" && p === "/alerts") return send(res, 200, alerts());
      if (req.method === "GET" && p === "/threads") {
        return send(res, 200, { threads: store.listThreads({ limit: url.searchParams.get("limit"), before: url.searchParams.get("before"), q: url.searchParams.get("q") }) });
      }
      let m = /^\/threads\/(\d{15,22})$/.exec(p);
      if (req.method === "GET" && m) {
        const thread = store.thread(m[1]);
        if (!thread) return send(res, 404, { error: "not found" });
        const claim = store.db.prepare("SELECT id FROM claims WHERE channel_id = ? ORDER BY id DESC LIMIT 1").get(m[1]);
        return send(res, 200, { thread, messages: store.messages(m[1], { before: url.searchParams.get("before"), limit: url.searchParams.get("limit") }), claim: claim ? store.claim(claim.id) : null, flagText: claims.FLAG_TEXT });
      }
      m = /^\/threads\/(\d{15,22})\/read$/.exec(p);
      if (req.method === "POST" && m) { store.markRead(m[1]); return send(res, 200, { ok: true }); }
      m = /^\/threads\/(\d{15,22})\/reply$/.exec(p);
      if (req.method === "POST" && m) {
        const body = await readJson(req);
        const content = String(body.content || "").trim();
        if (!content || content.length > 2000) return send(res, 400, { error: "Reply must be 1 to 2000 characters" });
        if (!store.thread(m[1])) return send(res, 404, { error: "not found" });
        await ingest.send(m[1], content, by(body, req));
        store.markRead(m[1]);
        return send(res, 200, { ok: true });
      }
      m = /^\/threads\/(\d{15,22})\/sync$/.exec(p);
      if (req.method === "POST" && m) { const fresh = await ingest.backfill(m[1]); return send(res, 200, { ok: true, added: fresh.length }); }
      if (req.method === "GET" && p === "/claims") {
        const status = (url.searchParams.get("status") || "needs_review").split(",").filter(Boolean);
        return send(res, 200, { claims: store.claimsByStatus(status, 500) });
      }
      m = /^\/claims\/(\d+)\/(approve|reject|recheck)$/.exec(p);
      if (req.method === "POST" && m) {
        const body = await readJson(req);
        const id = Number(m[1]);
        const out = m[2] === "approve" ? await claims.approve(id, by(body, req))
          : m[2] === "reject" ? await claims.reject(id, by(body, req), String(body.message || "").trim().slice(0, 2000) || null)
          : await claims.recheck(id);
        log(`claim ${id} ${m[2]} by ${by(body, req)}: ${out.ok ? out.claim?.status : out.error}`);
        return send(res, out.ok ? 200 : 409, out);
      }
      m = /^\/attachments\/([\w.-]+)$/.exec(p);
      if (req.method === "GET" && m) {
        const file = path.join(attachmentsDir, path.basename(m[1]));
        if (!fs.existsSync(file)) return send(res, 404, { error: "not found" });
        const type = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif" }[file.split(".").pop()];
        if (!type) {
          // HEIC, TIFF and friends do not render in a browser: serve a JPEG preview.
          const jpeg = await require("sharp")(await images.load(file)).jpeg({ quality: 85 }).toBuffer();
          res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
          return res.end(jpeg);
        }
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
        return fs.createReadStream(file).pipe(res);
      }
      return send(res, 404, { error: "not found" });
    } catch (e) {
      log(`admin ${req.method} ${p}: ${e.stack || e.message}`);
      return send(res, e.status && e.status < 500 ? e.status : 500, { error: e.message });
    }
  };
}

module.exports = { createPublicHandler, createAdminHandler, createRateLimit, readJson };
