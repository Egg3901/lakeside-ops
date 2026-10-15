// ollama-summarize.js — best-effort title/description generation for knowledge
// entries saved without them, so semantic search always has good text to match.
//
// Uses the local Ollama HTTP API. Everything here is FAIL-SOFT: any error,
// timeout, or unreachable server returns null and the caller proceeds with its
// own fallbacks. save() must never depend on a model being available.
//
// Model is deepseek-v4-flash:cloud by default (Kimi is rate-capped; this is the
// standing grunt-work fallback), overridable via KNOWLEDGE_SUMMARY_MODEL.

const http = require("http");

const OLLAMA_HOST = process.env.OLLAMA_HOST || "127.0.0.1:11434";
const MODEL = process.env.KNOWLEDGE_SUMMARY_MODEL || "deepseek-v4-flash:cloud";

function ollamaGenerate(prompt, { timeoutMs = 25000, model = MODEL } = {}) {
  return new Promise((resolve) => {
    const [host, port = "11434"] = OLLAMA_HOST.split(":");
    const payload = JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: 0.1 },
    });
    const req = http.request(
      {
        host,
        port: parseInt(port, 10),
        path: "/api/generate",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve(JSON.parse(data).response || null); } catch { resolve(null); }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
    req.write(payload);
    req.end();
  });
}

// Given an entry body (+ optional name), return { title, description, tags } or
// null. Tags are a cheap second retrieval axis (shared-tag neighbors), so they
// are proposed here whenever the caller didn't supply their own.
async function summarizeEntry({ name = "", body = "" } = {}) {
  const text = String(body || "").slice(0, 4000);
  if (!text.trim()) return null;
  const prompt =
    `You are labeling an entry for an engineering team's shared knowledge base.\n` +
    `Output ONLY compact JSON: {"title":"...","description":"...","tags":["...","..."]}.\n` +
    `- title: <= 8 words, specific, no trailing period.\n` +
    `- description: ONE sentence (<= 20 words) stating what the entry is useful for; this is what semantic search matches on.\n` +
    `- tags: 2-5 short lowercase kebab-case topic tags (systems, components, or themes) that group this with related entries.\n` +
    `No text outside the JSON.\n\n` +
    `ENTRY (name: ${name || "n/a"}):\n${text}`;
  const raw = await ollamaGenerate(prompt);
  if (!raw) return null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    const title = typeof o.title === "string" ? o.title.trim().replace(/\.$/, "").slice(0, 100) : "";
    const description = typeof o.description === "string" ? o.description.trim().slice(0, 240) : "";
    const tags = Array.isArray(o.tags)
      ? o.tags
          .filter((t) => typeof t === "string")
          .map((t) => t.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40))
          .filter(Boolean)
          .slice(0, 5)
      : [];
    if (!title && !description && !tags.length) return null;
    return { title: title || undefined, description: description || undefined, tags: tags.length ? tags : undefined };
  } catch {
    return null;
  }
}

module.exports = { summarizeEntry, ollamaGenerate, MODEL };
