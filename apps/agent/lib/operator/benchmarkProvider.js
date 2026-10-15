"use strict";
// Match the first active worker entry, including a pinned model and effort.
function currentWorker(env) {
  const defaults = { claude: env.KEIR_MODEL || "claude-opus-5-5", codex: "gpt-6-luna", agy: env.KEIR_AGY_MODEL || "gemini-3.8-flash", muse: env.KEIR_MUSE_MODEL || "muse-wonder-1.0" };
  const selected = String(env.KEIR_WORKER_PROVIDER || "claude").split(",").map(s => s.trim()).find(s => defaults[s.split(/[:@]/)[0]]) || "claude";
  const [spec, effort] = selected.split("@"), [runner, model] = spec.split(":");
  return { runner, model: model || defaults[runner], effort: effort || null };
}
module.exports = { currentWorker };
