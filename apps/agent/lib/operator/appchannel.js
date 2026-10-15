"use strict";
// The owner's private Keir app (Lakeside Ops on iOS). It is one more owner
// channel: requests become owner-directed jobs exactly like an owner DM, and
// every reply that would go to that channel lands in the app thread instead of
// Discord. Nothing here is reachable by anyone but the owner: each request is
// re-authenticated against the ops dashboard with the caller's own session.
const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { quickQuestion, isQuick } = require("./conversation");
const { ownerText } = require("./privacy");
const musePolicy = require("./ownermuse-policy");

const APP_CHANNEL = "app";
const isAppJob = (job) => Boolean(job && job.replyChannel === APP_CHANNEL && job.source?.channelId === APP_CHANNEL);
const CLOSED = ["done", "dismissed", "cancelled"];
const MAX_MESSAGES = 400;
const MAX_TEXT = 6000;

function threadOf(data) {
  const t = data.appThread ||= { seq: 0, messages: [], status: {}, clients: {} };
  t.status ||= {}; t.clients ||= {};
  return t;
}

function append(data, row, now) {
  const t = threadOf(data);
  const message = { seq: ++t.seq, id: row.id || `app-${t.seq}-${crypto.randomBytes(3).toString("hex")}`, at: now, ...row };
  t.messages = [...t.messages, message].slice(-MAX_MESSAGES);
  return message;
}

// The status line for a running app job. The answer replaces it.
function setStatus(data, jobId, text, now) {
  threadOf(data).status[jobId] = { text: String(text || "").slice(0, 1900), at: now };
}
function clearStatus(data, jobId) { delete threadOf(data).status[jobId]; }

function createAppChannel({ ledger, config, conversation, decisions = () => null, agent = () => null, drain = () => {}, now = () => Date.now() }) {
  const d = ledger.data;
  const controls = require("./appcontrols").createControls({ ledger, config, drain, now });
  const record = (row) => conversation?.record({ id: APP_CHANNEL }, { id: row.id, author: row.role === "owner" ? { id: config.ownerId, username: "owner" } : { id: config.botId, bot: true, username: "Keir" },
    content: row.text, timestamp: new Date(row.at).toISOString() });

  function post(text, clientId, threadId = "main", options = {}, authenticated = false) {
    const content = String(text || "").trim();
    if (musePolicy.hasCredentials(content)) throw Object.assign(new Error("Use a secure credential surface; credentials cannot be saved in app chat."), { status: 400 });
    if (content.length > MAX_TEXT) throw Object.assign(new Error(`Message exceeds ${MAX_TEXT} characters. Shorten it before sending.`), { status: 400 });
    if (!content) throw Object.assign(new Error("empty message"), { status: 400 });
    const t = threadOf(d);
    const client = clientId ? String(clientId).slice(0, 80) : null;
    if (client && t.clients[client]) {
      const prior = t.messages.find((m) => m.id === t.clients[client].messageId);
      return { duplicate: true, message: prior || null, jobId: t.clients[client].jobId };
    }
    const thread = String(threadId || "main");
    if (thread === "watches" || (thread !== "main" && !Object.hasOwn(t.threads || {}, thread))) throw Object.assign(new Error("unknown thread"), { status: 404 });
    if (authenticated && content.startsWith("/")) {
      const result = controls.command(content, thread, title => agent().createThread(title));
      if (result) {
        const message = append(d, { role: "keir", text: result.text, thread }, now());
        if (client) t.clients[client] = { messageId: message.id, jobId: null, at: now() };
        ledger.save(); return { message, command: true, ...result };
      }
    }
    if (d.paused) throw Object.assign(new Error("Keir is stopped. Press Start before sending work."), { status: 409 });
    const mode = options.mode || "followup";
    if (!["followup", "steer", "new"].includes(mode)) throw Object.assign(new Error("invalid message mode"), { status: 400 });
    const target = options.taskId && d.jobs[options.taskId];
    if (mode === "steer" && authenticated && !musePolicy.origin(d, target).valid) throw Object.assign(new Error("This saved task needs a new authenticated app request for writes."), { status: 409 });
    if (mode === "steer" && (!isAppJob(target) || target.appWatch || (target.appThread || "main") !== thread || CLOSED.includes(target.state)))
      throw Object.assign(new Error("the task is no longer available to steer"), { status: 409 });
    const message = append(d, { role: "owner", text: content, thread, mode }, now());
    record(message);
    const at = new Date(message.at).toISOString();
    const s = { messageId: message.id, channelId: APP_CHANNEL, channelName: "keir-app", authorId: config.ownerId, author: "owner", content, at, attachments: [], embeds: [] };
    const quick = quickQuestion(content);
    const live = mode === "new" ? null : mode === "steer" ? target : Object.values(d.jobs).find((j) => isAppJob(j) && !j.appWatch && (j.appThread || "main") === thread && (!authenticated || musePolicy.origin(d, j).valid) && isQuick(j) === quick && !CLOSED.includes(j.state));
    let job;
    if (live) {
      job = live; if (mode === "steer") live.appSteering = true; d.seen[`app:${message.id}`] = live.id; (live.inbox ||= []).push(s); delete live.waitingFor;
      if (["waiting", "blocked"].includes(live.state)) live.state = "queued";
    } else {
      job = ledger.createJob(`app:${message.id}`, { kind: quick ? "conversation" : "command", role: "owner", actorId: config.ownerId, channelId: APP_CHANNEL, replyChannel: APP_CHANNEL,
        appThread: thread, source: s, deadline: now() + config.taskLifetimeMs });
      if (authenticated) musePolicy.attest(ledger, config, job, message, now());
      if (!quick) job.needsAck = true;
    }
    message.jobId = job.id;
    if (client) t.clients[client] = { messageId: message.id, jobId: job.id, at: now() };
    for (const [k, v] of Object.entries(t.clients)) if (v.at < now() - 7 * 86400000) delete t.clients[k];
    ledger.audit("app_message", { job: job.id, message: message.id, quick }); ledger.save(); drain();
    return { message, jobId: job.id };
  }

  // Called by the outbox for an entry whose destination job is an app job.
  function deliver(key, entry, job) {
    const text = ownerText(entry.content).replace(/[–—]/g, ",");
    if (key.startsWith("ack:")) { setStatus(d, job.id, text, now()); job.progressMessageId = `app-status-${job.id}`; return [job.progressMessageId]; }
    // A watch speaks only when its condition is met.
    if (job.appWatch && agent() && !agent().onWatchReply(job, text)) { clearStatus(d, job.id); return [`watch-${job.appWatch}-quiet`]; }
    const chart = entry.chart && entry.files?.[0] && /^chart-[a-f0-9]{12}-[a-f0-9]{12}\.png$/.test(path.basename(entry.files[0].path)) ? path.basename(entry.files[0].path) : undefined;
    const cards = agent()?.cardsFor(job) || [];
    const message = append(d, { role: "keir", text, jobId: job.id, thread: job.appThread || "main", ...(job.appWatch ? { watch: job.appWatch } : {}), ...(chart ? { chart } : {}), ...(cards.length ? { cards } : {}) }, now());
    record(message);
    if (/^(channel-reply|finish|error-reply):/.test(key)) { clearStatus(d, job.id); delete job.progressMessageId; }
    return [message.id];
  }

  function updateStatus(job, text) { setStatus(d, job.id, ownerText(text), now()); }

  function view(after = 0, thread = null) {
    const t = threadOf(d);
    for (const id of Object.keys(t.status)) if (!d.jobs[id] || CLOSED.includes(d.jobs[id].state)) delete t.status[id];
    const jobs = Object.values(d.jobs).filter((j) => isAppJob(j) && !CLOSED.includes(j.state));
    const inThread = (x) => !thread || (x || "main") === thread;
    const tasks = jobs.filter((j) => inThread(j.appThread)).map((j) => ({ id: j.id, kind: j.kind, state: j.state, status: t.status[j.id]?.text || null, at: j.at, thread: j.appThread || "main", title: String(j.source?.content || "Task").slice(0, 100), overrides: j.appOverrides || {}, provider: j.provider ? { ...j.provider, effort: j.effort?.effort || j.provider.effort || null } : null, skills: j.activeSkills || [], model: j.provider?.model || null, modelRoute: j.provider?.route || "auto", steering: Boolean(j.appSteering), computer: j.appComputer || null, blocker: j.ownerMuseBlocker || null, approvals: pendingDecisions().filter(x => x.jobId === j.id) }));
    const version = crypto.createHash("sha256").update(JSON.stringify([t.seq, t.questions, tasks, jobs.map((j) => [j.id, j.state, j.updatedAt]), t.modelSelections, t.preferences, d.paused, pendingDecisions()])).digest("hex").slice(0, 16);
    const queued = (thread ? jobs.filter((j) => inThread(j.appThread)) : jobs).reduce((n, j) => n + (j.state === "running" ? (j.inbox || []).length : 0), 0);
    return { activity: require("./appcontrols").activityState(d, now()), controls: controls.view(thread || "main"), cursor: t.seq, version, modelSelection: t.modelSelections?.[thread || "main"] || "auto", questions: Object.values(t.questions || {}).filter((q) => inThread(q.thread)), messages: t.messages.filter((m) => m.seq > after && inThread(m.thread)), tasks, queued, backgroundTasks: jobs.filter((j) => !inThread(j.appThread)).map((j) => ({ id: j.id, thread: j.appThread || "main", title: String(j.source?.content || "Task").slice(0, 100), state: j.state })), working: tasks.some((x) => x.state === "running") };
  }

  function modelOptions(thread = "main") {
    return { models: require("./appmodels").models(config), selection: threadOf(d).modelSelections?.[thread] || "auto" };
  }
  function selectModel(thread, selection) {
    const t = threadOf(d);
    if (thread === "watches" || (thread !== "main" && !Object.hasOwn(t.threads || {}, thread))) throw Object.assign(new Error("unknown thread"), { status: 404 });
    require("./appmodels").resolveModel(config, selection);
    (t.modelSelections ||= {})[thread] = selection;
    ledger.audit("app_model_selected", { thread, selection }); ledger.save();
    return modelOptions(thread);
  }

  function cancel(jobId) {
    const job = d.jobs[String(jobId || "")];
    if (!isAppJob(job)) throw Object.assign(new Error("unknown task"), { status: 404 });
    if (CLOSED.includes(job.state)) return { state: job.state };
    job.state = "cancelled"; job.summary = "Stopped from the app."; clearStatus(d, job.id);
    ledger.audit("app_cancel", { job: job.id }); ledger.save(); drain();
    return { state: job.state };
  }

  // Recent thread rows for the model's source_history tool.
  function history(limit = 20, thread = null) {
    return threadOf(d).messages.filter((m) => !thread || (m.thread || "main") === thread).slice(-limit).map((m) => ({ id: m.id, author: m.role === "owner" ? "owner" : "Keir", authorId: m.role === "owner" ? config.ownerId : config.botId, bot: m.role !== "owner", content: m.text, at: new Date(m.at).toISOString() }));
  }

  // Keir's open questions for the owner, answerable from the app. The answer
  // goes through the same path as the Discord buttons.
  function pendingDecisions() {
    return Object.values(d.decisions || {}).filter((x) => x.state === "pending").sort((a, b) => b.at - a.at)
      .map((x) => ({ id: x.id, question: x.question, tldr: x.tldr || null, at: x.at, ticket: d.jobs[x.jobId]?.ticket || null, signoff: Boolean(x.signoff), jobId: x.jobId, ...(x.actionId ? { actionId: x.actionId, digest: d.actions[x.actionId]?.ownerMuse?.digest || d.actions[x.actionId]?.digest, kind: d.actions[x.actionId]?.kind, args: d.actions[x.actionId]?.args, scope: d.actions[x.actionId]?.ownerMuse?.scope } : {}) }));
  }
  async function answer(id, verdict, text, authenticated = false) {
    const x = d.decisions?.[String(id || "")];
    if (!x) throw Object.assign(new Error("unknown decision"), { status: 404 });
    if (x.state !== "pending") throw Object.assign(new Error(`already ${x.state}`), { status: 409 });
    if (!["approve", "reject", "explain"].includes(verdict)) throw Object.assign(new Error("verdict must be approve, reject or explain"), { status: 400 });
    if (verdict === "explain" && !String(text || "").trim()) throw Object.assign(new Error("say what to explain"), { status: 400 });
    const api = decisions();
    if (!api) throw Object.assign(new Error("decisions unavailable"), { status: 503 });
    try { await (authenticated ? api.applyAuthenticatedApp : api.apply)(x, verdict, config.ownerId, String(text || "").trim().slice(0, 2000)); }
    catch (error) { if (musePolicy.origin(d, d.jobs[x.jobId]).scoped) error.status ||= 409; throw error; }
    x.answeredVia = "app"; ledger.save();
    drain();
    return { id: x.id, state: x.state };
  }
  // Recent owner alerts (the quiet ledger feed that replaced alert DMs).
  function alerts(limit = 50) {
    return (d.alerts || []).slice(-limit).reverse().map((a) => ({ key: a.key, kind: alertKind(a.key), text: ownerText(alertKind(a.key) === "incident" ? require("./notification-policy").describeAlert(a, d, now()).text || "Monitoring event. Diagnostic details are recorded in Ops." : a.content).slice(0, 2000), at: a.at }));
  }
  function register(token, fields = {}) {
    const t = threadOf(d);
    const value = String(token || "");
    if (!/^[a-f0-9]{64,200}$/i.test(value)) throw Object.assign(new Error("invalid device token"), { status: 400 });
    const prefs = { feed: fields.feed !== false, replies: fields.replies !== false, decisions: fields.decisions !== false, incidents: fields.incidents !== false };
    t.devices = [...(t.devices || []).filter((x) => x.token !== value), { token: value, prefs, at: now() }].slice(-5);
    ledger.audit("app_device", { devices: t.devices.length }); ledger.save();
    return { registered: true, prefs };
  }
  function registerActivity(token, activityId) {
    if (!/^[a-f0-9]{64,200}$/i.test(String(token || "")) || !/^[a-zA-Z0-9-]{1,100}$/.test(String(activityId || ""))) throw Object.assign(new Error("Invalid activity registration"), { status: 400 });
    const t = threadOf(d);
    t.activities = [...(t.activities || []).filter(a => a.id !== activityId && a.token !== token && a.expiresAt > now()), { id: activityId, token, expiresAt: now() + 8 * 3600000 }].slice(-8);
    ledger.save(); return { registered: true };
  }
  return { registerActivity, controls, authenticatedPost: (text, clientId, threadId, options) => post(text, clientId, threadId, options, true), authenticatedAnswer: (id, verdict, text) => answer(id, verdict, text, true), modelOptions, selectModel, post, deliver, updateStatus, view, cancel, history, pendingDecisions, answer, alerts, register };
}

function alertKind(key) {
  if (/^(?:error:watch|recovery:watchkeeper)/.test(key)) return "incident";
  if (/^decision:/.test(key)) return "decision";
  if (/^digest:/.test(key)) return "digest";
  return "operator";
}

// Owner identity on the ops dashboard is the Discord-SSO email form.
function ownerIdentity(config) { return config.appOwnerIdentity || `discord_${config.ownerId}@discord.local`; }

function createAuthenticator({ config, checkUrl, fetchImpl = fetch, now = () => Date.now() }) {
  const cache = new Map();
  return async function authenticate(req) {
    const cookie = String(req.headers.cookie || "");
    if (!/(?:^|;\s*)ops_session=[^;]{16,}/.test(cookie)) return false;
    const token = /(?:^|;\s*)ops_session=([^;]+)/.exec(cookie)[1];
    const key = crypto.createHash("sha256").update(token).digest("hex");
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit.ok;
    // "owner" passes; "staff" is a valid admin session that is not the owner's
    // (refused without signing them out); false is no valid session.
    let ok = false;
    try {
      const r = await fetchImpl(checkUrl, { headers: { cookie: `ops_session=${token}` }, redirect: "error", signal: AbortSignal.timeout(5000) });
      if (r.status >= 500) throw Object.assign(new Error("sign-in check is temporarily unavailable"), { status: 503 });
      if (r.status === 200 && r.headers.get("x-auth-role") === "admin") ok = r.headers.get("x-auth-user") === ownerIdentity(config) ? "owner" : "staff";
    } catch { throw Object.assign(new Error("sign-in check is temporarily unavailable"), { status: 503 }); }
    cache.set(key, { ok, until: now() + (ok ? 60000 : 10000) });
    if (cache.size > 64) for (const k of [...cache.keys()].slice(0, cache.size - 64)) cache.delete(k);
    return ok;
  };
}

function createAppServer({ app, authenticate, artifactsDir, agentRoutes = null, log = () => {}, pollMs = 1000 }) {
  const PREFIX = "/api/keir/app";
  return http.createServer(async (req, res) => {
    const reply = (status, value) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url, "http://app.local");
      if (!url.pathname.startsWith(PREFIX)) return reply(404, { error: "not found" });
      const route = url.pathname.slice(PREFIX.length) || "/";
      if (route === "/health" && req.method === "GET") return reply(200, { ok: true });
      const who = await authenticate(req);
      if (who === "staff") return reply(403, { error: "Keir's app channel is for the owner only." });
      if (who !== "owner") return reply(401, { error: "unauthorized" });
      if (route === "/thread" && req.method === "GET") {
        const after = Math.max(0, Number(url.searchParams.get("after")) || 0);
        const wait = Math.min(25, Math.max(0, Number(url.searchParams.get("wait")) || 0)) * 1000;
        const started = Date.now();
        const since = url.searchParams.get("since");
        const thread = url.searchParams.get("thread") || null;
        let view = app.view(after, thread);
        // Long poll: answer as soon as the thread or a task changes from the caller's version.
        while (wait && since && view.version === since && Date.now() - started < wait) {
          if (req.destroyed) return;
          await new Promise((r) => setTimeout(r, pollMs));
          view = app.view(after, thread);
        }
        return reply(200, view);
      }
      if (route === "/controls" && req.method === "GET") return reply(200, app.controls.view(url.searchParams.get("thread") || "main"));
      if (route === "/models" && req.method === "GET") return reply(200, app.modelOptions(url.searchParams.get("thread") || "main"));
      if (route === "/decisions" && req.method === "GET") return reply(200, { decisions: app.pendingDecisions() });
      if (route === "/alerts" && req.method === "GET") return reply(200, { alerts: app.alerts() });
      const decision = /^\/decisions\/([a-f0-9]{12})$/.exec(route);
      if ((route === "/activities" || route === "/controls" || route === "/messages" || route === "/models" || route === "/cancel" || route === "/devices" || decision) && req.method === "POST") {
        let body = ""; for await (const chunk of req) { body += chunk; if (body.length > 32000) return reply(413, { error: "too large" }); }
        let b; try { b = JSON.parse(body || "{}"); } catch { return reply(400, { error: "invalid json" }); }
        if (route === "/activities") return reply(200, app.registerActivity(b.token, b.activityId));
        if (route === "/controls") return reply(200, app.controls.update(b));
        if (route === "/models") return reply(200, app.selectModel(b.thread || "main", b.selection));
        if (route === "/cancel") return reply(200, app.cancel(b.taskId));
        if (route === "/devices") return reply(200, app.register(b.token, b.prefs || {}));
        if (decision) return reply(200, await app.authenticatedAnswer(decision[1], b.verdict, b.text));
        const r = app.authenticatedPost(b.text, b.clientId, b.thread, { mode: b.mode, taskId: b.taskId });
        return reply(r.duplicate ? 200 : 201, r);
      }
      if (agentRoutes) {
        let b = {};
        if (req.method === "POST") { let body = ""; for await (const chunk of req) { body += chunk; if (body.length > 32000) return reply(413, { error: "too large" }); } try { b = JSON.parse(body || "{}"); } catch { return reply(400, { error: "invalid json" }); } }
        const out = await agentRoutes(route, req.method, b, url.searchParams);
        if (out !== undefined) return reply(200, out);
      }
      const art = /^\/artifacts\/((?:chart|computer)-[a-f0-9]{12}-[a-f0-9]{12}\.png)$/.exec(route);
      if (art && req.method === "GET") {
        const file = path.join(artifactsDir, art[1]);
        if (!fs.existsSync(file)) return reply(404, { error: "not found" });
        res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" }); return res.end(fs.readFileSync(file));
      }
      return reply(404, { error: "not found" });
    } catch (e) {
      if (e.status) return reply(e.status, { error: e.message });
      log(`app: ${e.message}`); return reply(500, { error: "server error" });
    }
  });
}

module.exports = { APP_CHANNEL, alertKind, threadOf, isAppJob, createAppChannel, createAuthenticator, createAppServer, ownerIdentity };
