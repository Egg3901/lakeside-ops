// ─── SHARED LLM CLIENT (Kimi primary → Ollama fallback) ──────────────────
// One entry point — `callChat({ messages, maxTokens, temperature })` — used by
// every LLM caller in the dashboard (PR review, community triage). It tries the
// primary provider (Kimi's coding endpoint) first and, on a retryable failure
// (HTTP 429, any 5xx, or a network/timeout error), transparently falls back to
// Ollama (local via OLLAMA_URL, else Ollama Cloud). If no fallback is
// configured the original error is surfaced unchanged.
//
// `messages` is an OpenAI-style array; each message's `content` may be a plain
// string OR a multimodal array (`[{type:"text",...},{type:"image_url",...}]`),
// so vision-capable models can see ticket screenshots.
//
// Returns `{ content, model, provider }`.

const KIMI_URL = "https://api.kimi.com/coding/v1/chat/completions";
const KIMI_MODEL = "kimi-for-coding";
const OLLAMA_CLOUD_URL = "https://ollama.com/v1/chat/completions";
const DEFAULT_FALLBACK_MODEL = "deepseek-v4-pro";
const TIMEOUT_MS = 240000;

// ─── Fire-and-forget usage logging ──────────────────────────────────
// We record OpenAI-style token usage per provider per day into Mongo so the
// admin dashboard can show a Kimi-vs-Ollama usage bar. This is best-effort:
// a lazy, cached MongoClient that NEVER throws and never blocks the LLM call.
let _usageClient = null;
let _usageConnect = null;
async function getUsageCollection() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;
  try {
    if (!_usageClient) {
      if (!_usageConnect) {
        const { MongoClient } = require("mongodb");
        const client = new MongoClient(uri, { maxPoolSize: 1 });
        _usageConnect = client
          .connect()
          .then(() => { _usageClient = client; return client; })
          .catch((e) => { _usageConnect = null; throw e; });
      }
      await _usageConnect;
    }
    return _usageClient.db("a-house-divided").collection("llm_usage");
  } catch {
    return null;
  }
}

// Log token usage for a single answered call. Swallows all errors; the caller
// must not await this (it is intentionally fire-and-forget).
function logUsage(provider, usage) {
  if (!provider || !usage) return;
  const promptTokens = usage.prompt_tokens || 0;
  const completionTokens = usage.completion_tokens || 0;
  const totalTokens = usage.total_tokens || promptTokens + completionTokens || 0;
  if (!promptTokens && !completionTokens && !totalTokens) return;
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  Promise.resolve()
    .then(async () => {
      const coll = await getUsageCollection();
      if (!coll) return;
      await coll.updateOne(
        { provider, day },
        { $inc: { calls: 1, promptTokens, completionTokens, totalTokens } },
        { upsert: true }
      );
    })
    .catch(() => {});
}

// Is the Ollama fallback usable? Local Ollama (OLLAMA_URL) needs no key; Ollama
// Cloud needs OLLAMA_CLOUD_KEY. Either being present means we can fall back.
function ollamaConfigured() {
  return !!(process.env.OLLAMA_URL || process.env.OLLAMA_CLOUD_KEY);
}

// A failure is retryable (→ try the fallback) when it's a 429, a 403, a 5xx, or
// a transport-level error (no HTTP status: timeout / DNS / connection reset).
// 403 matters specifically because Kimi returns it (NOT 429) when the coding
// plan's usage quota for the billing cycle is exhausted — the whole point of the
// Ollama fallback. Treating it as non-retryable made every ticket hard-fail
// triage for the rest of the cycle instead of falling back (support outage,
// tickets #898/#900/#901). A 403 from a bad key falls back harmlessly too.
function isRetryable(err) {
  const s = err && err.status;
  if (!s) return true; // network / timeout / abort
  return s === 429 || s === 403 || (s >= 500 && s <= 599);
}

async function postChat({ url, headers, model, messages, maxTokens, temperature }) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, stream: false }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // Network/timeout/abort — no HTTP status; mark retryable.
    const err = new Error(e.message || String(e));
    err.cause = e;
    throw err;
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`status ${res.status}${detail ? ": " + detail.slice(0, 200) : ""}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return {
    content: (data.choices?.[0]?.message?.content || "").trim(),
    usage: data.usage || null,
  };
}

async function callKimi({ messages, maxTokens, temperature }) {
  const key = process.env.KIMI_API_KEY || "";
  const { content, usage } = await postChat({
    url: KIMI_URL,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key, "User-Agent": "claude-code/1.0" },
    model: KIMI_MODEL,
    messages,
    maxTokens,
    temperature,
  });
  return { content, model: KIMI_MODEL, provider: "kimi", usage };
}

async function callOllama({ messages, maxTokens, temperature }) {
  const url = process.env.OLLAMA_URL || OLLAMA_CLOUD_URL;
  const model = process.env.LLM_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL;
  const key = process.env.OLLAMA_CLOUD_KEY || "";
  const headers = { "Content-Type": "application/json" };
  if (key) headers.Authorization = "Bearer " + key;
  const { content, usage } = await postChat({ url, headers, model, messages, maxTokens, temperature });
  return { content, model, provider: "ollama", usage };
}

// Provider health, remembered across calls. Without this, a 403 meaning "the
// billing cycle's quota is gone" was re-learned on every single request: each
// one paid a full round trip to an exhausted provider before falling back. The
// failure was already understood within one call (see isRetryable above, and
// tickets #898/#900/#901) — this holds the same lesson between calls.
const { createHealthTracker, orderProviders } = require("./model-router");
const health = createHealthTracker();

const CALLERS = {
  kimi: { call: callKimi, configured: () => !!process.env.KIMI_API_KEY },
  ollama: { call: callOllama, configured: ollamaConfigured },
};

// Which provider gets asked first. Kimi is the default, so nothing changes for
// a deployment that does not set this. Set LLM_PRIMARY=ollama to put the local
// Ollama model in front and keep Kimi as the automatic fallback.
//
// This is separate from server.js's LLM_PROVIDER, which selects the endpoint for
// the ask/chat surface. Reusing that variable here would have moved two surfaces
// at once.
function providerOrder() {
  const primary = String(process.env.LLM_PRIMARY || "").trim().toLowerCase();
  const all = ["kimi", "ollama"];
  if (!CALLERS[primary]) return all;
  return [primary, ...all.filter((n) => n !== primary)];
}

/**
 * Try providers in preference order, skipping any currently benched, and record
 * what happens. Order comes from LLM_PRIMARY (default kimi); what a benched
 * provider means is that "kimi is out of quota" now outlives the request that
 * discovered it.
 */
async function callChat({ messages, maxTokens = 9000, temperature = 1 } = {}) {
  if (!Array.isArray(messages) || !messages.length) throw new Error("callChat requires a non-empty messages array");

  const configured = providerOrder().filter((name) => CALLERS[name].configured());
  if (!configured.length) throw new Error("no LLM provider is configured");
  const candidates = orderProviders(configured, { health });

  let lastError = null;
  for (const name of candidates) {
    if (!health.available(name)) {
      // Everything is cold; a benched provider still beats no answer at all.
      console.warn(`[llm] ${name} is benched (${health.status(name).kind}) — trying anyway, nothing fresher left`);
    }
    try {
      const out = await CALLERS[name].call({ messages, maxTokens, temperature });
      health.record(name, { ok: true });
      console.log(`[llm] answered by ${name} (${out.model})`);
      logUsage(name, out.usage); // fire-and-forget; never awaited
      return out;
    } catch (e) {
      lastError = e;
      // A non-retryable failure is our own malformed request — another provider
      // will fail identically, and benching this one for it would be wrong.
      if (!isRetryable(e)) throw e;
      health.record(name, { status: e.status || 0 });
      console.warn(`[llm] ${name} failed (${e.message}); trying the next provider`);
    }
  }
  console.error(`[llm] every provider failed; last error: ${lastError?.message}`);
  throw lastError;
}

module.exports = { callChat, providerHealth: health };
