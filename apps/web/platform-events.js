"use strict";

const { execFile } = require("child_process");

const STREAM = "lakeside:events";
const DEAD_LETTER_STREAM = "lakeside:dead-letter";
const DEDUPE_TTL_SECONDS = 7 * 24 * 60 * 60;
const PUBLISH_SCRIPT = `
local existing = redis.call("GET", KEYS[2])
if existing then return {existing, "1"} end
local streamId = redis.call("XADD", KEYS[1], "MAXLEN", "~", "10000", "*",
  "id", ARGV[1], "type", ARGV[2], "source", ARGV[3], "occurredAt", ARGV[4], "payload", ARGV[5])
redis.call("SET", KEYS[2], streamId, "EX", ARGV[6])
return {streamId, "0"}
`;
const EVENT_TYPES = new Set([
  "turn:completed", "turn:failed", "ticket:created", "ticket:resolved",
  "deploy:started", "deploy:completed", "sim:completed", "anomaly:detected",
]);

function platformEventToken(env = process.env) {
  if (env.PLATFORM_EVENT_TOKEN) return env.PLATFORM_EVENT_TOKEN;
  if (!env.CREDENTIALS_DIRECTORY) return "";
  try {
    return require("fs").readFileSync(require("path").join(env.CREDENTIALS_DIRECTORY, "platform-event-token"), "utf8").trim();
  } catch {
    return "";
  }
}

function normalizeEvent(input) {
  if (!input || typeof input !== "object" || !EVENT_TYPES.has(input.type)) throw new Error("Unsupported event type");
  const source = String(input.source || "").trim();
  if (!source || source.length > 80) throw new Error("Event source is required and must be at most 80 characters");
  const payload = input.payload == null ? {} : input.payload;
  const encoded = JSON.stringify(payload);
  if (encoded.length > 64 * 1024) throw new Error("Event payload exceeds 64 KiB");
  return {
    id: typeof input.id === "string" && input.id ? input.id.slice(0, 160) : `${source}:${input.type}:${Date.now()}`,
    type: input.type,
    source,
    occurredAt: input.occurredAt ? new Date(input.occurredAt).toISOString() : new Date().toISOString(),
    payload: encoded,
  };
}

function redis(args) {
  return new Promise((resolve, reject) => execFile("redis-cli", ["-p", "6380", "--raw", ...args], {
    encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024,
  }, (error, stdout, stderr) => error ? reject(new Error(String(stderr || error.message).trim())) : resolve(stdout.trim())));
}

function redisJson(args) {
  return new Promise((resolve, reject) => execFile("redis-cli", ["-p", "6380", "--json", ...args], {
    encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024,
  }, (error, stdout, stderr) => {
    if (error) return reject(new Error(String(stderr || error.message).trim()));
    if (stdout.startsWith("error:")) return reject(new Error(stdout.slice(6).trim()));
    try { resolve(JSON.parse(stdout)); } catch (parseError) { reject(parseError); }
  }));
}

async function publishEvent(input, options = {}) {
  const event = normalizeEvent(input);
  const execute = options.redisJson || redisJson;
  const dedupeKey = `${STREAM}:dedupe:${event.id}`;
  const result = await execute([
    "EVAL", PUBLISH_SCRIPT, "2", STREAM, dedupeKey,
    event.id, event.type, event.source, event.occurredAt, event.payload,
    String(DEDUPE_TTL_SECONDS),
  ]);
  const [streamId, duplicate] = result;
  return { ...event, payload: JSON.parse(event.payload), streamId, duplicate: duplicate === "1" };
}

function parseStreamRows(rows) {
  return rows.map(([streamId, fields]) => {
    const event = { streamId };
    for (let index = 0; index < fields.length; index += 2) event[fields[index]] = fields[index + 1];
    try { event.payload = JSON.parse(event.payload || "{}"); } catch { event.payload = {}; }
    return event;
  });
}

async function recentEvents(count = 100) {
  const rows = await redisJson(["XREVRANGE", STREAM, "+", "-", "COUNT", String(Math.min(Math.max(count, 1), 500))]);
  return parseStreamRows(rows);
}

module.exports = { DEAD_LETTER_STREAM, EVENT_TYPES, STREAM, normalizeEvent, parseStreamRows, platformEventToken, publishEvent, recentEvents, redisJson };
