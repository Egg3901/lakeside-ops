"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  COOLDOWN_MS, allowedModels, classifyFailure, createHealthTracker,
  effortFor, isDenied, modelFor, orderProviders, route, scoreComplexity,
} = require("./model-router");

// ─── The Opus ban ───────────────────────────────────────────────────

test("opus can never be selected, by any route", () => {
  assert.equal(isDenied("opus"), true);
  assert.equal(isDenied("Opus"), true);
  assert.equal(isDenied("  OPUS  "), true);
  assert.equal(isDenied("sonnet"), false);

  // Not reachable through the tier tables at any size of work.
  for (const tier of ["light", "standard", "deep"]) {
    assert.notEqual(modelFor("claude", tier), "opus", tier);
  }
  // The hardest work still tops out at sonnet.
  assert.equal(modelFor("claude", "deep"), "sonnet");
  assert.equal(modelFor("claude", "standard"), "sonnet");
  assert.equal(modelFor("claude", "light"), "haiku");

  // And it is stripped from anything offered to a human too.
  assert.deepEqual(allowedModels(["fable", "opus", "sonnet", "haiku"]), ["fable", "sonnet", "haiku"]);
  assert.deepEqual(allowedModels(null), []);
});

test("deep Claude work buys depth with effort, since the model is capped", () => {
  assert.equal(effortFor("light"), "low");
  assert.equal(effortFor("standard"), "medium");
  assert.equal(effortFor("deep"), "high");
  assert.equal(effortFor(undefined), "medium");
});

// ─── Sizing the work ────────────────────────────────────────────────

test("lookups score light", () => {
  assert.equal(scoreComplexity("Where is the turn loop defined?").tier, "light");
  assert.equal(scoreComplexity("What is TURNS_PER_YEAR?").tier, "light");
  assert.equal(scoreComplexity("list the seed presets").tier, "light");
  assert.equal(scoreComplexity("fix a typo in the README").tier, "light");
});

test("cross-cutting investigation scores deep", () => {
  const why = scoreComplexity(
    "Why is GDP growth inconsistent across src/lib/economy.ts, src/lib/turn/advance.ts and src/lib/metrics/gdp.ts after a turn rolls over?"
  );
  assert.equal(why.tier, "deep");
  assert.ok(why.reasons.some((r) => /file paths/.test(r)));

  assert.equal(scoreComplexity("Trace the root cause of this race condition in turn processing").tier, "deep");
  assert.equal(scoreComplexity("Audit the 1953 seed end-to-end for ahistorical data").tier, "deep");
});

test("a stack trace is treated as debugging even when the text is short", () => {
  const result = scoreComplexity("TypeError: cannot read x\n    at advanceTurn (src/lib/turn.ts:42)");
  assert.equal(result.tier, "deep");
  assert.ok(result.reasons.includes("stack trace"));
});

test("ordinary questions land in the middle", () => {
  assert.equal(scoreComplexity("How does the campaign spending formula work in detail for each region?").tier, "standard");
  assert.equal(scoreComplexity("").tier, "standard");
});

test("every decision explains itself", () => {
  // A router nobody can interrogate is one nobody leaves switched on.
  for (const text of ["", "why is this broken", "where is x"]) {
    const result = scoreComplexity(text);
    assert.ok(Array.isArray(result.reasons) && result.reasons.length > 0, JSON.stringify(text));
  }
});

// ─── Provider health ────────────────────────────────────────────────

test("403 is quota, not auth — the lesson from tickets #898/#900/#901", () => {
  assert.equal(classifyFailure(403), "quota");
  // Kimi says the same thing with a 402 ("unable to verify your membership
  // benefits"), so it has to bench for just as long.
  assert.equal(classifyFailure(402), "quota");
  assert.equal(classifyFailure(503), "server");
  assert.equal(classifyFailure(0), "transport");
  // A 400 is our own malformed request; benching the provider for it would be wrong.
  assert.equal(classifyFailure(400), null);
});

test("a rate limit is not a spent billing cycle and must not bench like one", () => {
  // 429 used to classify as "quota" and take a provider out for 30 minutes. A
  // free, heavily rate-limited model (Ox Alpha) 429s routinely and recovers in
  // seconds; the long bench made one blip look like a provider nobody configured.
  assert.equal(classifyFailure(429), "ratelimit");
  assert.ok(COOLDOWN_MS.ratelimit < COOLDOWN_MS.quota);

  const health = createHealthTracker();
  const t0 = 9_000_000;
  health.record("openrouter", { status: 429, now: t0 });
  assert.equal(health.available("openrouter", t0 + 1000), false);
  assert.equal(health.available("openrouter", t0 + COOLDOWN_MS.ratelimit + 1), true);
  // Well inside the old 30-minute quota bench, it is already back in rotation.
  assert.equal(health.available("openrouter", t0 + COOLDOWN_MS.quota - 1), true);
});

test("a provider that says when it frees up beats the cooldown we would guess", () => {
  const health = createHealthTracker();
  const t0 = 11_000_000;
  const resetsAt = new Date(t0 + 5000).toISOString();

  health.record("openrouter", { status: 429, resetsAt, now: t0 });
  assert.equal(health.available("openrouter", t0 + 4000), false);
  assert.equal(health.available("openrouter", t0 + 6000), true);
});

test("an exhausted provider is not retried on the very next call", () => {
  const health = createHealthTracker();
  const t0 = 1_000_000;

  assert.equal(health.available("kimi", t0), true);
  health.record("kimi", { status: 403, now: t0 });
  // This is the bug: previously every subsequent call still tried kimi first.
  assert.equal(health.available("kimi", t0 + 1000), false);
  assert.equal(health.status("kimi", t0 + 1000).kind, "quota");

  // Still benched well into the cooldown, free again after it.
  assert.equal(health.available("kimi", t0 + COOLDOWN_MS.quota - 1), false);
  assert.equal(health.available("kimi", t0 + COOLDOWN_MS.quota + 1), true);
});

test("a server blip benches briefly, a 400 not at all", () => {
  const health = createHealthTracker();
  const t0 = 5_000_000;
  health.record("ollama", { status: 503, now: t0 });
  assert.equal(health.available("ollama", t0 + 1000), false);
  assert.equal(health.available("ollama", t0 + COOLDOWN_MS.server + 1), true);

  health.record("ollama", { status: 400, now: t0 });
  assert.equal(health.available("ollama", t0), true);
});

test("a real reset time beats the guessed cooldown", () => {
  const health = createHealthTracker();
  const t0 = 2_000_000;
  const resetsAt = new Date(t0 + 6 * 60 * 60 * 1000).toISOString();
  health.record("codex", { status: 429, resetsAt, now: t0 });
  // Guessing 30 minutes would hammer a provider that is out for six hours.
  assert.equal(health.available("codex", t0 + COOLDOWN_MS.quota + 1), false);
  assert.equal(health.available("codex", new Date(resetsAt).getTime() + 1), true);
});

test("success clears a bench immediately", () => {
  const health = createHealthTracker();
  const t0 = 3_000_000;
  health.record("kimi", { status: 429, now: t0 });
  assert.equal(health.available("kimi", t0 + 5), false);
  health.record("kimi", { ok: true, now: t0 + 10 });
  assert.equal(health.available("kimi", t0 + 15), true);
});

// ─── Ordering and the whole decision ────────────────────────────────

test("benched providers go last but are never dropped", () => {
  const health = createHealthTracker();
  const t0 = 4_000_000;
  health.record("kimi", { status: 403, now: t0 });

  const order = orderProviders(["kimi", "ollama", "codex"], { health, now: t0 + 1 });
  assert.deepEqual(order, ["ollama", "codex", "kimi"]);

  // With everything cold we still try, in preference order — a benched
  // provider beats no answer at all.
  health.record("ollama", { status: 500, now: t0 });
  health.record("codex", { status: 429, now: t0 });
  assert.deepEqual(orderProviders(["kimi", "ollama", "codex"], { health, now: t0 + 1 }), ["kimi", "ollama", "codex"]);
});

test("route ties sizing and health together into one plan", () => {
  const health = createHealthTracker();
  const t0 = 6_000_000;
  health.record("kimi", { status: 403, now: t0 });

  const decision = route({
    text: "Why do turn totals disagree between src/lib/turn.ts and src/lib/metrics.ts and src/lib/economy.ts?",
    candidates: ["kimi", "claude", "ollama"],
    health,
    now: t0 + 1,
  });

  assert.equal(decision.tier, "deep");
  assert.equal(decision.providers[0], "claude");
  assert.equal(decision.providers.at(-1), "kimi");

  const claude = decision.plan.find((p) => p.provider === "claude");
  assert.equal(claude.model, "sonnet");
  assert.equal(claude.effort, "high");
  assert.equal(claude.benched, false);
  assert.equal(decision.plan.find((p) => p.provider === "kimi").benched, true);
  // Whatever the tier, opus is never in a plan.
  assert.ok(!decision.plan.some((p) => p.model === "opus"));
});

test("a caller may force the tier and still gets a routed plan", () => {
  const decision = route({ text: "where is x", candidates: ["claude"], tier: "deep" });
  assert.equal(decision.tier, "deep");
  assert.equal(decision.plan[0].model, "sonnet");
  assert.match(decision.reasons[0], /forced/);
});

test("a provider with no model table leaves its own default alone", () => {
  // Cursor ignores a model at spawn; naming one would be a lie.
  assert.equal(modelFor("cursor", "deep"), null);
  assert.equal(modelFor("unknown-provider", "deep"), null);
});
