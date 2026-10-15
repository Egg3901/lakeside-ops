"use strict";
// Only operator-configured routes appear in the owner's picker. A model change
// takes effect at the next activation, never halfway through an external effect.
const { check } = require("./routing");
const RUNNERS = { claude: "Claude", codex: "Codex", muse: "Muse", agy: "Gemini", ollama: "Ollama" };
function models(config, lane = null) {
  const defaults = { claude: config.model, codex: "gpt-6-luna", muse: config.museModel || "muse-wonder-1.0", agy: config.agyModel || "gemini-3.8-flash", ollama: "deepseek-v4.1-flash" };
  const specs = [config.quickProvider || "claude", config.workerProvider || "claude", config.codingProvider, config.investigatorProvider, config.visionProvider, ...(!config.standalone ? ["claude:claude-opus-5-5", "claude:claude-sonnet-5-5", "ollama:deepseek-v4.1-flash"] : []), config.voiceProvider || (!config.standalone && "agy:gemini-3.8-flash@low"), ...(config.availableRoutes || []), config.defaultRoute].filter(Boolean).flatMap((s) => String(s).split(","));
  const routes = new Map();
  for (const value of specs) {
    const [spec, effort] = value.trim().split("@");
    const colon = spec.indexOf(":"), runner = colon < 0 ? spec : spec.slice(0, colon);
    const model = colon < 0 ? defaults[runner] : spec.slice(colon + 1);
    if (!(RUNNERS[runner] || config.standalone && ["antigravity", "opencode", "grok", "gemini", "cursor"].includes(runner)) || !model) continue;
    const id = `${runner}:${model}${effort ? `@${effort}` : ""}`;
    const verdict = check(lane === "conversation" ? "quick" : lane === "investigation" ? "investigator" : (lane === "coordination" ? "worker" : lane) || "quick", id);
    routes.set(id, { id, available: config.standalone || verdict.ok, ...(!config.standalone && !verdict.ok ? { reason: verdict.reason } : {}), effortMode: "jev", label: require("./selfinfo").label(model), provider: RUNNERS[runner] || runner, runner, model, ...(effort ? { effort } : {}) });
  }
  return [{ id: "auto", label: "Auto", provider: "Keir routing" }, ...routes.values()];
}
function resolveModel(config, id, lane = null) {
  const route = models(config, lane).find((m) => m.id === id);
  if (route?.available === false) throw Object.assign(new Error(route.reason), { status: 400 });
  if (!route) throw Object.assign(new Error("model route is not available"), { status: 400 });
  return route;
}
function applyModel(job, config, ledger, lane) {
  const controls = require("./appcontrols");
  const root = controls.rootOf(ledger.data, job);
  if (root?.role !== "owner" || root.actorId !== config.ownerId || root.appWatch) return;
  const workType = controls.laneOf(job, lane === "quick");
  const pref = controls.preferences(ledger.data, job);
  const requested = job.appOverrides?.routes?.[workType] || root.appOverrides?.routes?.[workType] || pref.routes?.[workType] || (!job.codingParent ? ledger.data.appThread?.modelSelections?.[root.appThread || "main"] : null) || (job.voiceMode ? config.voiceProvider || (!config.standalone ? "agy:gemini-3.8-flash@low" : "auto") : "auto");
  const selected = requested === "auto" && job.voiceMode ? config.voiceProvider || (!config.standalone ? "agy:gemini-3.8-flash@low" : "auto") : requested;
  if (selected === "auto") {
    if (job.provider?.ownerSelected) {
      delete job.provider;
      if (job.codingParent) {
        const route = require("./delegation").codingSpec({ codingProvider: job.investigation ? config.investigatorProvider || config.codingProvider : config.codingProvider });
        job.provider = { lane, ...route, at: Date.now() }; job.effortPin = route.effort;
      }
    }
    return;
  }
  const route = resolveModel(config, selected, workType);
  job.provider = { lane, runner: route.runner, model: route.model, ...(route.effort ? { effort: route.effort } : {}), ownerSelected: true, route: selected, at: Date.now() };
  // The selected effort wins over the default inherited at delegation time.
  if (job.codingParent) job.effortPin = route.effort || undefined;
}
module.exports = { models, resolveModel, applyModel };
