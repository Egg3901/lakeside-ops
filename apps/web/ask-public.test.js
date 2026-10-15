"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeAskPreferences, publicAskPolicy, liveSourcePolicy, buildAskIdentityContext, isToolCallArtifact, runPublicAskConversation, protectPublicAnswer, isPublicAskAuthorized } = require("./ask-public");

test("Ask preferences default to concise output and normal thinking", () => {
  assert.deepEqual(
    normalizeAskPreferences({}),
    {
      responseLength: "concise",
      thinking: "normal",
      instruction: "Keep the answer concise. Lead with the answer, use at most 2-4 short paragraphs or a compact list unless more detail is essential.",
      answerTokens: 2200,
      effort: "low",
      rounds: 3,
      calls: 5,
      reasoningTokens: 3000,
    },
  );
});

test("legacy deep requests still select deep thinking", () => {
  const preferences = normalizeAskPreferences({ deep: true, responseLength: "detailed" });
  assert.equal(preferences.thinking, "deep");
  assert.equal(preferences.responseLength, "detailed");
});

test("public Ask permits useful visualizations by default without requiring them", () => {
  const policy = publicAskPolicy({});
  assert.match(policy, /may include at most one fenced visualization/);
  assert.match(policy, /fenced ```ahd-map block/);
  assert.match(policy, /Do not add one when concise prose is clearer/);
  assert.match(policy, /at most six labeled categories or series/);
  assert.match(policy, /combine the remainder into one accurately calculated "Other" slice/);
  assert.match(publicAskPolicy({ visualizations: false }), /Do not include Mermaid diagrams, AHD maps/);
});

test("public Ask refuses exploit abuse and unfair player targeting", () => {
  const policy = publicAskPolicy({});
  assert.match(policy, /exact best position against a named opponent/);
  assert.match(policy, /opponent's weakest group/);
  assert.match(policy, /unfair automation/);
  assert.match(policy, /help reporting a suspected exploit are allowed/);
});

test("public Ask explicitly permits generic military mechanics", () => {
  const policy = publicAskPolicy({});
  assert.match(policy, /General military mechanics are allowed/);
  assert.match(policy, /What does a Logistics Command do/);
});

test("public Ask removes live force composition before Discord can publish it", () => {
  const leaked = "East has no Logistics Command and no Airlift Wing in its live roster.";
  const answer = protectPublicAnswer(leaked, "Why was the front cut off from supply?");

  assert.doesNotMatch(answer, /East|Logistics Command|Airlift Wing/i);
  assert.match(answer, /fog of war|private military|public war record/i);
});

test("public Ask removes asset presence claims even when the model omits the word roster", () => {
  const leaked = "East lacks a Logistics Command and fields zero Airlift Wings.";
  const answer = protectPublicAnswer(leaked);

  assert.doesNotMatch(answer, /East|Logistics Command|Airlift Wing/i);
  assert.match(answer, /public/);
});

test("public Ask removes natural paraphrases of live military intelligence", () => {
  const sensitive = [
    "Northland currently operates three armored corps.",
    "Northland's army consists of twelve infantry battalions.",
    "Northland is at 43% readiness.",
    "The Airlift Wing is absent from Northland forces.",
    "Northland is missing a Logistics Command.",
    "Northland maintains two carrier groups near the coast.",
  ];
  for (const answer of sensitive) {
    assert.notEqual(protectPublicAnswer(answer), answer, answer);
  }
});

test("private military questions are refused even when the answer uses a euphemism", () => {
  const answer = protectPublicAnswer(
    "They are well prepared.",
    "How many battalions does Northland currently deploy?",
  );
  assert.match(answer, /public/);
  assert.doesNotMatch(answer, /well prepared/i);
});

test("public Ask still explains military mechanics without live roster claims", () => {
  const mechanics = "A Logistics Command adds regional supply throughput when assigned correctly.";
  assert.equal(protectPublicAnswer(mechanics, "How does a Logistics Command work?"), mechanics);

  const quantifiedMechanic = "A division contains three brigades in the formation model.";
  assert.equal(protectPublicAnswer(quantifiedMechanic, "How are divisions composed?"), quantifiedMechanic);

  const commandMechanic = "A Logistics Command adds regional supply throughput.";
  assert.equal(protectPublicAnswer(commandMechanic, "What does a Logistics Command do?"), commandMechanic);

  const requirement = "You need to have a Logistics Command assigned to support regional supply.";
  assert.equal(protectPublicAnswer(requirement, "What does a Logistics Command do?"), requirement);

  const hypothetical = "If your country has no Logistics Command, regional supply throughput falls.";
  assert.equal(protectPublicAnswer(hypothetical, "What does a Logistics Command do?"), hypothetical);

  const namedLeak = "East has no Logistics Command assigned to the region.";
  assert.notEqual(protectPublicAnswer(namedLeak, "How does regional supply work?"), namedLeak);
});

test("a generic mechanics sentence cannot hide a later live roster disclosure", () => {
  const mixed = "A division contains three brigades in the formation model. Northland operates three armored corps.";
  assert.notEqual(protectPublicAnswer(mixed, "How are divisions composed?"), mixed);
});

test("public Ask authorization fails closed when its secret is missing", () => {
  assert.equal(isPublicAskAuthorized("", ""), false);
  assert.equal(isPublicAskAuthorized(undefined, undefined), false);
  assert.equal(isPublicAskAuthorized("secret", "wrong"), false);
  assert.equal(isPublicAskAuthorized("secret", "secret"), true);
});

test("public Ask allows public corporation and country analysis but protects private finances", () => {
  const policy = publicAskPolicy({});
  assert.match(policy, /why a publicly traded corporation is performing or valued highly/);
  assert.match(policy, /aggregate economic data for any country/);
  assert.match(policy, /Refuse private-corporation balance sheets/);
  assert.match(policy, /If public status or visibility is not established/);
  assert.match(policy, /Never compare raw local-currency values across countries/);
  assert.match(policy, /display-ready live values/);
});

test("public Ask plans only public entity, FX, economy, chart, and map lookups", () => {
  const policy = liveSourcePolicy(true);
  assert.doesNotMatch(policy, /trace_corp|trace_sector/);
  assert.match(policy, /do not have support history, Discord history/);
  assert.match(policy, /public exchange-visible rankings and aggregate market data/);
  assert.match(policy, /call gamestate entity_search/);
  assert.match(policy, /call gamestate fx_quote/);
  assert.match(policy, /gamestate countries for broader per-country economic comparisons/);
  assert.match(policy, /engine economy_pulse/);
  assert.match(policy, /call gamestate map_snapshot/);
  assert.match(policy, /world scope for comparisons between countries/);
  assert.match(policy, /canonical game colors/);
  assert.match(policy, /candidate_roster/);
  assert.match(policy, /GOP Senate Class 1 map/);
  assert.match(policy, /playersOnly/);
  assert.match(policy, /xychart-beta diagram from those exact chart-ready values/);
  assert.match(policy, /Do not substitute a different available metric/);
  assert.equal(liveSourcePolicy(false), "");
});

test("selected Discord users are subjects without gaining requester privacy", () => {
  const context = buildAskIdentityContext({
    requester: {
      discordUsername: "asker",
      characterId: "requester-id",
      characterName: "Requesting Player",
    },
    subject: {
      discordUsername: "target",
      characterId: "subject-id",
      characterName: "Selected Player",
      country: "DD",
      corporationName: "Selected Corp",
    },
  });

  assert.match(context, /Treat "my" and "mine" as referring to this identity/);
  assert.match(context, /SELECTED USER CONTEXT/);
  assert.match(context, /character id: subject-id/);
  assert.match(context, /query public live stats/);
  assert.match(context, /not automatically the requester/);
  assert.equal(buildAskIdentityContext({}), "");
});

test("public Ask calls live tools and returns their sources", async () => {
  let modelCall = 0;
  let lookupNotices = 0;
  const result = await runPublicAskConversation({
    messages: [{ role: "user", content: "What turn is it?" }],
    tools: [{ type: "function", function: { name: "gamestate__game_overview" } }],
    preferences: normalizeAskPreferences({ thinking: "quick" }),
    onLookup: async () => { lookupNotices += 1; },
    callModel: async () => {
      modelCall += 1;
      return modelCall === 1
        ? {
            message: {
              content: null,
              tool_calls: [{ id: "call-1", function: { name: "gamestate__game_overview", arguments: "{}" } }],
            },
            usage: { prompt_tokens: 10, completion_tokens: 2 },
          }
        : {
            message: { content: "The live game is on turn 900." },
            usage: { prompt_tokens: 12, completion_tokens: 8 },
          };
    },
    callTool: async () => ({
      text: '{"turn":900}',
      source: { kind: "state", label: "gamestate: game_overview" },
    }),
  });

  assert.equal(result.answer, "The live game is on turn 900.");
  assert.equal(lookupNotices, 1);
  assert.deepEqual(result.sources, [{ kind: "state", label: "gamestate: game_overview" }]);
  assert.deepEqual(result.usage, { prompt_tokens: 22, completion_tokens: 10 });
});

test("public Ask forces a tool-free final answer after the round budget", async () => {
  const toolOffers = [];
  const result = await runPublicAskConversation({
    messages: [{ role: "user", content: "Question" }],
    tools: [{ type: "function", function: { name: "gamestate__game_overview" } }],
    preferences: { ...normalizeAskPreferences({ thinking: "quick" }), rounds: 1 },
    callModel: async (_messages, tools, forceNoReasoning) => {
      toolOffers.push({ tools: Boolean(tools), forceNoReasoning });
      if (tools) {
        return {
          message: { tool_calls: [{ id: "call-1", function: { name: "gamestate__game_overview", arguments: "{}" } }] },
          usage: {},
        };
      }
      return { message: { content: "Final answer" }, usage: {} };
    },
    callTool: async () => ({ text: "{}", source: null }),
  });

  assert.equal(result.answer, "Final answer");
  assert.deepEqual(toolOffers, [
    { tools: true, forceNoReasoning: false },
    { tools: false, forceNoReasoning: true },
  ]);
});

test("public Ask recovers when the provider emits a DSML tool-call artifact as text", async () => {
  let modelCall = 0;
  const result = await runPublicAskConversation({
    messages: [{ role: "user", content: "Why is Tinky valued highly?" }],
    tools: [{ type: "function", function: { name: "gamestate__trace_corp" } }],
    preferences: normalizeAskPreferences({ thinking: "quick" }),
    callModel: async (_messages, tools) => {
      modelCall += 1;
      if (modelCall === 1) return {
        message: { tool_calls: [{ id: "call-1", function: { name: "gamestate__trace_corp", arguments: "{\"corporation\":\"Tinky\"}" } }] },
        usage: {},
      };
      if (tools) return {
        message: { content: '<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="gamestate__trace_corp">...</｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>' },
        usage: {},
      };
      return { message: { content: "Tinky is highly valued because its public revenue supports its market cap." }, usage: {} };
    },
    callTool: async () => ({ text: '{"public":true,"revenue":100}', source: { kind: "state", label: "gamestate: trace_corp" } }),
  });

  assert.equal(isToolCallArtifact("<｜｜DSML｜｜tool_calls>bad</｜｜DSML｜｜tool_calls>"), true);
  assert.match(result.answer, /highly valued because/);
});
