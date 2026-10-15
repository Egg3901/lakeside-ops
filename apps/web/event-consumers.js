"use strict";

const os = require("os");
const {
  STREAM, DEAD_LETTER_STREAM, parseStreamRows, publishEvent, redisJson,
} = require("./platform-events");

const GROUP = "ops-dashboard-v4";
const PUBLIC_TYPES = new Set(["turn:completed", "turn:failed", "deploy:started", "deploy:completed"]);

function createEventConsumers({ execute = redisJson, publish = publishEvent, notify = async () => ({ skipped: true }), consumer = os.hostname(), onError = console.error } = {}) {
  let running = false;
  let loopPromise;
  const listeners = new Set();
  const recent = [];

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  async function dispatch(event) {
    if (PUBLIC_TYPES.has(event.type)) {
      const publicEvent = { streamId: event.streamId, type: event.type, occurredAt: event.occurredAt };
      recent.unshift(publicEvent);
      recent.length = Math.min(recent.length, 100);
      for (const listener of listeners) listener(publicEvent);
    }
    if (event.type.startsWith("ticket:") || event.type === "anomaly:detected") {
      const payload = event.payload || {};
      const result = await notify({
        kind: "status",
        title: event.type === "anomaly:detected" ? "Platform anomaly detected" : `Ticket ${event.type.split(":")[1]}`,
        description: String(payload.summary || payload.message || payload.title || `${event.source} · ${event.id}`).slice(0, 1000),
      });
      if (result && result.error) throw new Error(result.error);
    }
  }

  async function deadLetter(event, error) {
    await execute(["XADD", DEAD_LETTER_STREAM, "MAXLEN", "~", "1000", "*",
      "originalStreamId", event.streamId, "eventId", event.id || "", "type", event.type || "",
      "source", event.source || "", "occurredAt", event.occurredAt || "",
      "payload", JSON.stringify(event.payload || {}), "error", String(error.message || error).slice(0, 1000)]);
  }

  async function processRows(rows) {
    for (const [, entries] of rows || []) {
      for (const event of parseStreamRows(entries)) {
        try {
          await dispatch(event);
        } catch (error) {
          await deadLetter(event, error);
        }
        await execute(["XACK", STREAM, GROUP, event.streamId]);
      }
    }
  }

  async function poll() {
    const rows = await execute(["XREADGROUP", "GROUP", GROUP, consumer, "COUNT", "20", "BLOCK", "1000", "STREAMS", STREAM, ">"]);
    await processRows(rows);
  }

  async function claimStale() {
    const result = await execute(["XAUTOCLAIM", STREAM, GROUP, consumer, "60000", "0-0", "COUNT", "20"]);
    await processRows([[STREAM, result?.[1] || []]]);
  }

  async function start() {
    if (running) return;
    try {
      const history = await execute(["XREVRANGE", STREAM, "+", "-", "COUNT", "100"]);
      recent.push(...parseStreamRows(history).filter(event => PUBLIC_TYPES.has(event.type)).map(event => ({
        streamId: event.streamId, type: event.type, occurredAt: event.occurredAt,
      })));
    } catch (error) { onError("[event-consumers] history unavailable:", error); }
    try {
      await execute(["XGROUP", "CREATE", STREAM, GROUP, "$", "MKSTREAM"]);
    } catch (error) {
      if (!String(error.message).includes("BUSYGROUP")) throw error;
    }
    running = true;
    loopPromise = (async () => {
      let lastClaim = 0;
      while (running) {
        try {
          if (Date.now() - lastClaim >= 60000) {
            await claimStale();
            lastClaim = Date.now();
          }
          await poll();
        }
        catch (error) {
          onError("[event-consumers] poll failed:", error);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    })();
  }

  async function stop() {
    running = false;
    await loopPromise;
  }

  async function listDeadLetters(limit = 100) {
    const rows = await execute(["XREVRANGE", DEAD_LETTER_STREAM, "+", "-", "COUNT", String(Math.min(Math.max(limit, 1), 100))]);
    return parseStreamRows(rows);
  }

  async function replayDeadLetter(streamId) {
    if (!/^\d+-\d+$/.test(streamId)) throw new Error("Invalid stream ID");
    const rows = await execute(["XRANGE", DEAD_LETTER_STREAM, streamId, streamId]);
    const original = parseStreamRows(rows)[0];
    if (!original) throw new Error("Dead letter not found");
    const result = await publish({
      id: `${original.eventId || original.originalStreamId}:replay:${Date.now()}`,
      type: original.type,
      source: original.source,
      payload: original.payload,
    });
    await execute(["XDEL", DEAD_LETTER_STREAM, streamId]);
    return result;
  }

  return { start, stop, subscribe, poll, processRows, listDeadLetters, replayDeadLetter, recent: () => [...recent] };
}

module.exports = { createEventConsumers, PUBLIC_TYPES };
