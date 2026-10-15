"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildWorldsimDashboard } = require("./worldsim-dashboard");

test("renders retained multiplayer legislature aggregates without player records", () => {
  const legislature = {
    countryId: "UK",
    officeType: "commons",
    totalSeats: 625,
    parties: [
      { partyId: "1", name: "Labour Party", abbreviation: "LAB", seats: 181 },
      { partyId: "2", name: "Conservative Party", abbreviation: "CON", seats: 242 },
    ],
  };
  const live = {
    status: "ok",
    snapshots: [{
      iteration: "Iteration 4",
      turnStart: 852,
      turnEnd: 947,
      currentYear: 1971,
      capturedAt: "2026-09-18T00:00:00.000Z",
      provenance: { completeness: "partial-legacy" },
      headline: { playerEnabledCountries: 1, latestLegislativeSeatsObserved: 625 },
      politics: { legislatures: [legislature] },
      macroSeries: {
        realGrowth: [{ turn: 946, value: 1.2 }, { turn: 947, value: 1.4 }],
        nominalGrowth: [{ turn: 946, value: 4.2 }, { turn: 947, value: 4.5 }],
        inflation: [{ turn: 946, value: 3.0 }, { turn: 947, value: 3.1 }],
        policyRate: [{ turn: 946, value: 5.0 }, { turn: 947, value: 5.25 }],
      },
      series: [],
    }],
    observations: [{
      iteration: "Iteration 4",
      turn: 947,
      year: 1971,
      governmentApproval: 55.87,
      activeElections: 613,
      recentGovernmentFormations: 3,
      legislatures: [legislature],
    }],
  };

  const { html } = buildWorldsimDashboard({
    manifest: [],
    statuses: {},
    artifacts: { live, singleplayer: { status: "not-connected", cohorts: [] } },
  });

  assert.match(html, /Player-country political control/);
  assert.match(html, /<td>UK<\/td><td>commons<\/td><td>625<\/td>/);
  assert.match(html, /LAB 181/);
  assert.match(html, /CON 242/);
  assert.match(html, /Multiplayer macro rates/);
  assert.match(html, /Policy rate/);
  assert.match(html, /5\.25%/);
  assert.match(html, />1<\/b><span>MP observations/);
  assert.doesNotMatch(html, /characterId|characterName|userId|email/);
});
