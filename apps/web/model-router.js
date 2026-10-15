"use strict";

/**
 * Model routing: pick the right size of model for the work, and don't send work
 * to a provider that is currently out of quota.
 *
 * Two problems this solves, both observed rather than theoretical:
 *
 * 1. **Every question got the same model.** `quality` scaled budgets and prompt
 *    tone but never the model, and tmux agents booted on whatever their CLI
 *    defaulted to. A one-line "where is this defined" and a "trace why this
 *    number is wrong across three subsystems" cost the same and got the same
 *    depth — the cheap question overpaying, the hard one under-served.
 *
 * 2. **Failover had no memory.** `llm.js` tried Kimi first on every single call,
 *    even seconds after Kimi returned 403 meaning the billing cycle's quota was
 *    gone. Every request paid a full round trip to a provider already known to
 *    be exhausted before falling back (tickets #898/#900/#901 are the same
 *    lesson, learned at the level of one call rather than across calls).
 *
 * Everything here is pure and injectable — `now` is a parameter, never read from
 * the clock — so the routing decisions are directly testable.
 */

/**
 * Models this platform must never select automatically.
 *
 * Opus is deliberately excluded: it is reserved for work a human explicitly
 * chooses it for, and an auto-router that can reach it will reach it constantly.
 * This is enforced at selection time, not just left out of the preference lists,
 * so a stored schedule, an API caller, or a future catalog addition cannot route
 * to it by accident.
 */
const DENIED_MODELS = new Set(["opus"]);

/** Work sizes. Ordered — `deep` implies everything `light` can do. */
const TIERS = ["light", "standard", "deep"];

// Signals that a question needs real reasoning across code, not a lookup. These
// are about the *shape* of the work, not the topic.
//
// Split by strength because they are not equal evidence. "Audit this end to end"
// names the work outright; "why" and "across" appear in plenty of one-line
// lookups and only mean something when they stack.
const DEEP_STRONG = [
  /\broot cause\b/i, /\bdebug\b/i, /\btrace\b/i, /\breproduce\b/i,
  /\brace condition\b/i, /\bdeadlock\b/i, /\bmemory leak\b/i, /\bregression\b/i,
  /\brefactor\b/i, /\bmigrat(e|ion)\b/i, /\barchitect(ure|ural)\b/i, /\baudit\b/i,
  /\bend[- ]to[- ]end\b/i, /\binconsistent\b/i, /\bdiscrepanc(y|ies)\b/i,
];
const DEEP_WEAK = [
  /\bwhy\b/i, /\bacross\b/i, /\binteract(s|ion)\b/i, /\bside effects?\b/i,
  /\bshould(n't| not)\b/i,
];

// Signals that a lookup or a one-liner will do.
const LIGHT_PATTERNS = [
  /^\s*(what|where|which|who|when)\s+(is|are|does|do)\b/i,
  /^\s*list\b/i, /^\s*show me\b/i, /^\s*does\s+\w+\s+exist/i,
  /\btypo\b/i, /\brename\b/i, /\bspelling\b/i, /\bwhat does .{1,40} (mean|do)\b/i,
];

const FILE_PATH = /\b[\w.-]+\/[\w./-]+\.\w{1,5}\b/g;
const CODE_FENCE = /```/g;
const STACK_FRAME = /\bat\s+[\w.$]+\s*\(|^\s+at\s|\bError:\s/m;

function count(text, pattern) {
  const matches = String(text).match(pattern);
  return matches ? matches.length : 0;
}

/**
 * Size the work from the text of the request.
 *
 * Returns the tier plus the signals behind it, because a router that cannot
 * explain itself is one nobody trusts enough to leave switched on — and the
 * reasons are what you read when it picks wrong.
 */
function scoreComplexity(text) {
  const source = String(text || "");
  const reasons = [];
  let score = 0;

  const strong = DEEP_STRONG.filter((re) => re.test(source)).length;
  const weak = DEEP_WEAK.filter((re) => re.test(source)).length;
  if (strong) { score += Math.min(4, strong * 2); reasons.push(`investigation cues (${strong})`); }
  if (weak) { score += Math.min(2, weak); reasons.push(`reasoning cues (${weak})`); }

  const lightHits = LIGHT_PATTERNS.filter((re) => re.test(source));
  if (lightHits.length) {
    score -= 2;
    reasons.push("lookup phrasing");
  }

  const paths = count(source, FILE_PATH);
  if (paths >= 3) { score += 2; reasons.push(`${paths} file paths`); }
  else if (paths === 2) { score += 1; reasons.push("2 file paths"); }

  if (count(source, CODE_FENCE) >= 2) { score += 1; reasons.push("code block"); }
  // A pasted stack trace is a debugging session regardless of how little prose
  // came with it — often the whole message is the trace.
  if (STACK_FRAME.test(source)) { score += 3; reasons.push("stack trace"); }

  const questionMarks = count(source, /\?/g);
  if (questionMarks >= 3) { score += 1; reasons.push("multi-part"); }

  if (source.length > 600) { score += 2; reasons.push("long request"); }
  else if (source.length > 240) { score += 1; reasons.push("detailed request"); }
  // Terse *and* unremarkable reads as a lookup. An empty request is not terse,
  // it is absent — there is nothing to size, so it takes the default.
  else if (source.length > 0 && source.length < 60 && !strong) { score -= 1; reasons.push("very short"); }

  const tier = score >= 3 ? "deep" : score <= -1 ? "light" : "standard";
  if (!reasons.length) reasons.push("no strong signals");
  return { tier, score, reasons };
}

/**
 * Per-provider model preferences by tier.
 *
 * `null` means "leave the provider's own default alone" — for CLIs that ignore a
 * model at spawn, naming one here would be a lie the router tells itself.
 */
const PROVIDER_TIERS = {
  claude: { light: "haiku", standard: "sonnet", deep: "sonnet" },
  codex: { light: "gpt-5.4-mini", standard: "gpt-5.6-luna", deep: "gpt-5.6-sol" },
  kimi: { light: "kimi-for-coding-highspeed", standard: "kimi-for-coding", deep: "k3" },
  ollama: { light: "deepseek-v4-flash", standard: "deepseek-v4-flash", deep: "deepseek-v4-pro" },
  opencode: { light: "openrouter/stealth/ox-alpha", standard: "openrouter/stealth/ox-alpha", deep: "openrouter/stealth/ox-alpha" },
  cursor: { light: null, standard: null, deep: null },
  // One model at every tier because it bills at zero: there is no cheap-vs-dear
  // tradeoff left to route around, and picking a weaker sibling to save nothing
  // would be a downgrade with no upside.
  openrouter: { light: "stealth/ox-alpha", standard: "stealth/ox-alpha", deep: "stealth/ox-alpha" },
};

/**
 * Effort per tier, for CLIs that take one alongside the model. Claude's deep
 * tier buys depth through effort rather than through Opus, which is the whole
 * point of capping the model at Sonnet.
 */
const TIER_EFFORT = { light: "low", standard: "medium", deep: "high" };

function isDenied(model) {
  return DENIED_MODELS.has(String(model || "").trim().toLowerCase());
}

/**
 * The model a provider should use for a tier, or null to leave its default.
 * Never returns a denied model, whatever the tables say.
 */
function modelFor(provider, tier) {
  const table = PROVIDER_TIERS[provider];
  if (!table) return null;
  const model = table[TIERS.includes(tier) ? tier : "standard"];
  return isDenied(model) ? null : model;
}

function effortFor(tier) {
  return TIER_EFFORT[TIERS.includes(tier) ? tier : "standard"] || "medium";
}

/**
 * Remove anything denied from a list of selectable models. Used to build the
 * options the UI and the API will accept, so the ban holds even when a human
 * is driving.
 */
function allowedModels(models) {
  return (Array.isArray(models) ? models : []).filter((model) => !isDenied(model));
}

// ─── Provider health ────────────────────────────────────────────────
//
// How long a provider stays benched after a failure. Quota exhaustion lasts
// until the plan resets, so guessing a short cooldown just means hammering an
// exhausted provider every minute; a server error is usually transient.
const COOLDOWN_MS = {
  quota: 30 * 60 * 1000,
  ratelimit: 60 * 1000,
  server: 60 * 1000,
  transport: 30 * 1000,
};

/**
 * Classify a failure.
 *
 * 403 is quota, not auth — Kimi returns it when the coding plan's billing-cycle
 * quota is gone, which is the single most important thing this router has to
 * remember. 402 is the same thing said differently (Kimi answers "unable to
 * verify your membership benefits" with one), so it benches for just as long.
 *
 * 429 used to share that 30-minute bench, and it should not. A rate limit clears
 * in seconds; a spent billing cycle does not clear until it resets. Benching a
 * free, heavily rate-limited model for half an hour over one 429 takes it out of
 * the rotation for the rest of the day, which is indistinguishable from never
 * having configured it.
 */
function classifyFailure(status) {
  if (status === 403 || status === 402) return "quota";
  if (status === 429) return "ratelimit";
  if (status >= 500 && status <= 599) return "server";
  if (!status) return "transport";
  return null;
}

function createHealthTracker() {
  const benched = new Map();

  return {
    /** Record how a call went. A success clears any bench immediately. */
    record(provider, { status = 0, ok = false, resetsAt = null, now = Date.now() } = {}) {
      if (!provider) return;
      if (ok) { benched.delete(provider); return; }
      const kind = classifyFailure(status);
      if (!kind) return; // a 400 is our bug, not the provider's — don't bench it
      // A provider that tells us when it frees up beats any cooldown we guess.
      const until = resetsAt && (kind === "quota" || kind === "ratelimit")
        ? Math.max(now, new Date(resetsAt).getTime() || 0)
        : now + COOLDOWN_MS[kind];
      benched.set(provider, { until, kind, status });
    },

    /** Is this provider worth trying right now? */
    available(provider, now = Date.now()) {
      const entry = benched.get(provider);
      if (!entry) return true;
      if (now >= entry.until) { benched.delete(provider); return true; }
      return false;
    },

    /** Why a provider is benched, for logging and for the UI. */
    status(provider, now = Date.now()) {
      const entry = benched.get(provider);
      if (!entry || now >= entry.until) return { available: true };
      return { available: false, kind: entry.kind, status: entry.status, until: entry.until };
    },

    clear() { benched.clear(); },
  };
}

/**
 * Order the providers to try, best first.
 *
 * Preference order comes first, then anything benched is moved to the back
 * rather than dropped: a benched provider is still better than no answer, so if
 * every candidate is cold we still try them in preference order instead of
 * failing outright.
 */
function orderProviders(candidates, { health, now = Date.now() } = {}) {
  const list = (Array.isArray(candidates) ? candidates : []).filter(Boolean);
  if (!health) return list;
  const fresh = list.filter((p) => health.available(p, now));
  const cold = list.filter((p) => !health.available(p, now));
  return [...fresh, ...cold];
}

/**
 * The whole decision for one request: how big is the work, who should do it,
 * and with what model.
 */
function route({ text = "", candidates = [], health = null, now = Date.now(), tier = null } = {}) {
  const complexity = tier ? { tier, score: 0, reasons: ["tier forced by caller"] } : scoreComplexity(text);
  const providers = orderProviders(candidates, { health, now });
  return {
    tier: complexity.tier,
    reasons: complexity.reasons,
    providers,
    plan: providers.map((provider) => ({
      provider,
      model: modelFor(provider, complexity.tier),
      effort: effortFor(complexity.tier),
      benched: health ? !health.available(provider, now) : false,
    })),
  };
}

module.exports = {
  COOLDOWN_MS,
  DENIED_MODELS,
  PROVIDER_TIERS,
  TIERS,
  TIER_EFFORT,
  allowedModels,
  classifyFailure,
  createHealthTracker,
  effortFor,
  isDenied,
  modelFor,
  orderProviders,
  route,
  scoreComplexity,
};
