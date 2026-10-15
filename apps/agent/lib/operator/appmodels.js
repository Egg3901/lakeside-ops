"use strict";
// Only operator-configured routes appear in the owner's picker. A model change
// takes effect at the next activation, never halfway through an external effect.
const { check } = require("./routing");
const RUNNERS = { claude: "Claude", codex: "Codex", muse: "Muse", agy: "Gemini", ollama: "Ollama" };
function models(config) {
  const defaults = { claude: config.model, codex: "gpt-6-luna", muse: config.museModel || "muse-wonder-1.0", agy: config.agyModel || "gemini-3.8-flash", ollama: "deepseek-v4.1-flash" };
  const specs = [config.quickProvider || "claude", config.workerProvider || "claude", config.codingProvider, config.visionProvider].filter(Boolean).flatMap((s) => String(s).split(","));
  const routes = new Map();
  for (const value of specs) {
    const [spec, effort] = value.trim().split("@");
    const colon = spec.indexOf(":"), runner = colon < 0 ? spec : spec.slice(0, colon);
    const model = colon < 0 ? defaults[runner] : spec.slice(colon + 1);
    if (!RUNNERS[runner] || !model) continue;
    const id = `${runner}:${model}${effort ? `@${effort}` : ""}`;
    const verdict = check("worker", id);
    if (verdict.ok) routes.set(id, { id, label: model, provider: RUNNERS[runner], runner, model, ...(effort ? { effort } : {}) });
  }
  return [{ id: "auto", label: "Auto", provider: "Keir routing" }, ...routes.values()];
}
function resolveModel(config, id) {
  const route = models(config).find((m) => m.id === id);
  if (!route) throw Object.assign(new Error("model route is not available"), { status: 400 });
  return route;
}
function applyModel(job, config, ledger, lane) {
  if (job.replyChannel !== "app" || job.appWatch || job.role !== "owner") return;
  const selected = ledger.data.appThread?.modelSelections?.[job.appThread || "main"] || "auto";
  if (selected === "auto") {
    if (job.provider?.ownerSelected) delete job.provider;
    return;
  }
  const route = resolveModel(config, selected);
  job.provider = { lane, runner: route.runner, model: route.model, ...(route.effort ? { effort: route.effort } : {}), ownerSelected: true, route: selected, at: Date.now() };
}
module.exports = { models, resolveModel, applyModel };
