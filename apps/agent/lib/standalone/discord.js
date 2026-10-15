"use strict";
const { createDiscord } = require("../operator/discord");
const { catchUp, snowflake } = require("../operator/gateway");
const crypto = require("node:crypto");

function discordSettings(env) {
  const token = env.LAKESIDE_DISCORD_BOT_TOKEN, ownerId = env.LAKESIDE_DISCORD_OWNER_ID;
  if (!token && !ownerId) return null;
  if (!token || !snowflake(ownerId)) throw new Error("Discord requires LAKESIDE_DISCORD_BOT_TOKEN and LAKESIDE_DISCORD_OWNER_ID");
  return { token, ownerId };
}

// Port the operator's owner-DM channel using its existing REST transport and
// catch-up reader. Studio guild/ticket routing stays in operator/gateway.js.
function createDiscordChannel({ runtime, token, ownerId, call = createDiscord({ token }), log = console.error, intervalMs = 3000 }) {
  if (!token || !snowflake(ownerId)) throw new Error("Discord requires a bot token and an explicit owner ID");
  const { ledger, app } = runtime;
  let state, stopped = false, running = null, timer;
  const originalDeliver = app.deliver;
  app.deliver = (key, entry, job) => {
    const result = originalDeliver(key, entry, job);
    if (state && job.appThread === state.thread && !key.startsWith("ack:")) {
      const message = app.view(0, state.thread).messages.find(m => m.id === result[0]);
      if (message) enqueue(message.id, message.text);
    }
    return result;
  };
  function enqueue(id, text, controlResponse = false) {
    if (!state.outbox.some(x => x.id === id)) {
      state.outbox.push({ id, text, part: 0, controlResponse }); ledger.save();
    }
  }
  async function initialize() {
    const bot = await call("GET", "/users/@me");
    if (stopped) return;
    if (!bot.bot || !snowflake(bot.id)) throw new Error("Discord credentials must identify a bot");
    const dm = await call("POST", "/users/@me/channels", { recipient_id: ownerId });
    if (stopped) return;
    if (!snowflake(dm.id) || dm.type !== 1 || !dm.recipients?.some(x => x.id === ownerId)) throw new Error("Discord owner DM validation failed");
    const channels = ledger.data.discordChannels ||= {};
    const key = `${bot.id}:${ownerId}`;
    state = channels[key];
    if (state && state.channel !== dm.id) throw new Error("Discord DM changed; inspect saved connector state");
    if (!state) {
      // A first connection never interprets old DM history as new instructions.
      const latest = await call("GET", `/channels/${dm.id}/messages?limit=1`);
      if (stopped) return;
      state = channels[key] = { channel: dm.id, thread: runtime.createThread("Discord").id,
        cursor: latest[0]?.id || "0", outbox: [] };
      ledger.save();
    }
  }
  async function ingest(message) {
    if (stopped) throw new Error("Discord connector stopped");
    if (BigInt(message.id) <= BigInt(state.cursor)) return;
    if (message.author?.id === ownerId && !message.author.bot && !message.webhook_id && message.channel_id === state.channel && message.content?.trim()) {
      const text = message.content.trim();
      try {
        const command = text.startsWith("/") && !text.startsWith("/stop ") ? app.controls.command(text, state.thread, runtime.createThread) : null;
        if (command) { enqueue(message.id, command.text, true); }
        else if (text === "/tasks") {
          const jobs = Object.values(ledger.data.jobs).filter(j => j.appThread === state.thread).slice(-10);
          enqueue(message.id, jobs.map(j => `${j.id}: ${j.state}`).join("\n") || "No Discord tasks yet.");
        } else if (text.startsWith("/stop ")) {
          const id = text.slice(6).trim();
          if (ledger.data.jobs[id]?.appThread !== state.thread) throw Object.assign(new Error("Unknown Discord task"), { status: 404 });
          app.cancel(id); enqueue(message.id, `Task ${id}: stopped.`);
        } else {
          app.authenticatedPost(text, `discord:${message.id}`, state.thread);
        }
      } catch (error) {
        if (![400, 404, 409].includes(error.status)) throw error;
        enqueue(message.id, "Message rejected. Check its length, avoid credentials, or use /tasks to find a task to stop.");
      }
    }
    state.cursor = message.id; ledger.save();
  }
  async function flush() {
    while (!stopped && state.outbox.length) {
      const entry = state.outbox[0];
      if (ledger.data.control?.stopped && !entry.controlResponse) { state.outbox.shift(); ledger.save(); continue; }
      const chunks = entry.text.match(/[\s\S]{1,1900}/g) || ["(empty reply)"];
      while (!stopped && state.outbox[0] === entry && entry.part < chunks.length) {
        if (ledger.data.control?.stopped && !entry.controlResponse) { state.outbox.shift(); break; }
        const result = await call("POST", `/channels/${state.channel}/messages`, { content: chunks[entry.part],
          allowed_mentions: { parse: [] }, nonce: crypto.createHash("sha256").update(`${state.channel}:${entry.id}:${entry.part}`).digest("hex").slice(0, 24), enforce_nonce: true });
        if (!result?.id) throw new Error("Discord did not return a delivery receipt");
        entry.part++; ledger.save();
      }
      if (state.outbox[0] === entry && entry.part === chunks.length) { state.outbox.shift(); ledger.save(); }
    }
  }
  async function cycle() {
    if (!state) await initialize();
    if (stopped) return;
    await catchUp(call, state.channel, state.cursor, ingest);
    if (!stopped) await flush();
  }
  function poll() {
    if (stopped) return Promise.resolve();
    if (!running) running = cycle().finally(() => { running = null; });
    return running;
  }
  function start() {
    if (timer || stopped) return;
    const tick = () => poll().catch(error => log(`Discord connector unavailable (${error.status || error.name || "error"})`));
    tick(); timer = setInterval(tick, intervalMs); timer.unref();
  }
  return { poll, start, stop() { stopped = true; clearInterval(timer); app.deliver = originalDeliver; } };
}

module.exports = { createDiscordChannel, discordSettings };
