#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { MongoClient, ObjectId } = require("mongodb");
const { buildWorldsimDashboard } = require("../worldsim-dashboard");
const { writeWorldsimRunPages } = require("../worldsim-run-pages");
const { readWorldsimQueue } = require("../worldsim-run-timeline");
const { qualifyTelemetry, runQualificationContext } = require("./lib/telemetry-readiness");
const { publishReadinessInventory } = require("./lib/readiness-inventory");
const { nationalTelemetry } = require("../mcp/worldsim-national-telemetry");
const { buildRegionalTelemetry, renderRegionalReport } = require("../mcp/worldsim-regional-telemetry");

const CONTROL_URI = "mongodb://127.0.0.1:27018/sim_control";
const SANDBOX_URI = "mongodb://127.0.0.1:27018";
const PUBLISHED_DIR = process.env.WORLDSIM_PUBLISHED_DIR || "/root/projects/LSGD-ops-dash/reports/published";
const MANIFEST = path.join(PUBLISHED_DIR, "manifest.json");
const PUBLIC_BASE = "https://ops.lakesidegames.net";
const RUN_ID = process.argv[2];
const READER_ROOT = path.resolve(__dirname, "..");
function readerProvenance() {
  try {
    return { commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: READER_ROOT, encoding: "utf8" }).trim(),
      dirty: execFileSync("git", ["status", "--porcelain"], { cwd: READER_ROOT, encoding: "utf8" }).trim().length > 0 };
  } catch { return { commit: null, dirty: null }; }
}
const DURABLE_TELEMETRY_MERGE = "71f44587b682106ac4165092ae1486d08633687b";

function telemetryCapability(sourceCommit) {
  if (!/^[0-9a-f]{40}$/.test(String(sourceCommit || ""))) return "unknown";
  const ancestor = (oldCommit, newCommit) => {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", oldCommit, newCommit], {
        cwd: "/root/projects/AHDGame", stdio: "ignore",
      });
      return true;
    } catch { return false; }
  };
  if (ancestor(DURABLE_TELEMETRY_MERGE, sourceCommit)) return "required";
  if (ancestor(sourceCommit, DURABLE_TELEMETRY_MERGE)) return "legacy";
  return "unknown";
}

if (!RUN_ID || !/^[a-f0-9-]{16,64}$/i.test(RUN_ID)) {
  console.error("usage: lakeside-worldsim-publish <run-id>");
  process.exit(2);
}

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));
const finite = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
const pct = (value, digits = 1) => finite(value) === null ? "Not measured" : `${(value * 100).toFixed(digits)}%`;
const num = (value, digits = 0) => finite(value) === null ? "Not measured" : value.toLocaleString("en-US", { maximumFractionDigits: digits });
const safeDate = (value) => value ? new Date(value).toISOString() : null;
const slugify = (value) => String(value || "worldsim")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 62);

function readManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, "utf8")); } catch { return []; }
}

function atomicWrite(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o644 });
  fs.renameSync(tmp, file);
}

async function writeProgramIndex(manifest, controlDb) {
  const grouped = await controlDb.collection("simJobs").aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]).toArray();
  const statuses = Object.fromEntries(grouped.map((row) => [row._id, row.count]));
  const jobs = await readWorldsimQueue(controlDb);
  writeWorldsimRunPages(PUBLISHED_DIR, jobs, manifest);
  const { html, runs, filed } = buildWorldsimDashboard({ manifest, statuses, jobs });
  atomicWrite(path.join(PUBLISHED_DIR, "worldsim-audit-program.html"), html);
  const entry = {
    slug: "worldsim-audit-program", title: "A House Divided worldsim audit",
    summary: "Public index of sanitized sandbox simulation evidence and reproducible findings.",
    category: "World Simulations", icon: "🧭", badge: `${filed} filed · ${runs.length} runs`, author: "worldsim-audit",
    public: false, publishedAt: new Date().toISOString(), updated: manifest.some((item) => item.slug === "worldsim-audit-program"),
  };
  const index = manifest.findIndex((item) => item.slug === entry.slug);
  if (index >= 0) manifest[index] = entry; else manifest.push(entry);
}

function sparkline(points, key, color) {
  const values = points.map((point) => finite(point[key])).filter((value) => value !== null);
  if (values.length < 2) return '<div class="empty">Not enough samples yet</div>';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coords = points.map((point, index) => {
    const value = finite(point[key]) ?? min;
    const x = points.length === 1 ? 0 : index * 100 / (points.length - 1);
    const y = 36 - ((value - min) / span) * 32;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  return `<svg class="spark" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="${esc(key)} trend"><polyline points="${coords}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><div class="range"><span>${esc(num(min, 3))}</span><span>${esc(num(max, 3))}</span></div>`;
}

function delta(points, key, digits = 1, percent = true) {
  const values = points.map((point) => finite(point[key])).filter((value) => value !== null);
  if (values.length < 2) return "no prior sample";
  const change = values.at(-1) - values.at(-2);
  const rendered = percent ? `${(change * 100).toFixed(digits)} pp` : num(change, digits);
  return `${change >= 0 ? "+" : ""}${rendered} last turn`;
}

function multiChart(points, series, ariaLabel) {
  const available = series.filter((item) => points.some((point) => finite(point[item.key]) !== null));
  if (!available.length || points.length < 2) return '<div class="empty">Not enough samples yet</div>';
  const paths = available.map((item) => {
    const coords = points.map((point, index) => {
      const value = Math.max(0, Math.min(1, finite(point[item.key]) ?? 0));
      const x = index * 100 / (points.length - 1);
      const y = 38 - value * 34;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ");
    return `<polyline points="${coords}" fill="none" stroke="${item.color}" stroke-width="1.8" vector-effect="non-scaling-stroke"/>`;
  }).join("");
  const legend = available.map((item) => `<span><i style="background:${item.color}"></i>${esc(item.label)}</span>`).join("");
  return `<svg class="chart" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="${esc(ariaLabel)}"><path d="M0 4H100M0 21H100M0 38H100" stroke="#20334b" stroke-width=".35" vector-effect="non-scaling-stroke"/>${paths}</svg><div class="legend">${legend}</div>`;
}

function flagRows(requested, effective) {
  const keys = [
    ["allFeatureFlags", "All feature flags"],
    ["marketSystemMode", "Market system"],
    ["labourSystemMode", "Labour system"],
    ["autonomyLevel", "Autonomy"],
    ["freightSettlementMode", "Freight settlement"],
    ["canonicalFreightBillingEnabled", "Canonical freight billing"],
    ["shortageResponsiveSourcingEnabled", "Shortage-responsive sourcing"],
    ["indexFundBondLiquidityEnabled", "Index-fund bond liquidity"],
    ["equityLiquidityFacilityEnabled", "Equity liquidity facility"],
    ["nppMarketCoverageEnabled", "NPP market coverage"],
    ["nppFragileMarketSupplyEnabled", "Fragile-market supply"],
  ];
  return keys.map(([key, label]) => {
    const req = requested[key];
    if (key === "allFeatureFlags") {
      return `<tr><th>${esc(label)}</th><td>${esc(req === undefined ? "Default" : req)}</td><td>Proved by individual rows</td><td><span class="pill ok">Expanded below</span></td></tr>`;
    }
    const actual = effective[key] ?? (key === "autonomyLevel" ? effective.nppAutonomyLevel : undefined);
    const matches = req === undefined || req === actual;
    return `<tr><th>${esc(label)}</th><td>${esc(req === undefined ? "Default" : req)}</td><td>${esc(actual === undefined ? "Not recorded" : actual)}</td><td><span class="pill ${matches ? "ok" : "bad"}">${matches ? "Matches" : "Mismatch"}</span></td></tr>`;
  }).join("");
}

function findingRows(seed) {
  const common = [
    ["#791", "Unemployment ignores measured labour demand and tightness", "https://github.com/Egg3901/AHDGame/issues/791"],
    ["#991", "Durable market access and entrant survival", "https://github.com/Egg3901/AHDGame/issues/991"],
    ["#1001", "Securities depth and one-sided equity books", "https://github.com/Egg3901/AHDGame/issues/1001"],
    ["#992", "NPP investment accruals drive periodic stock-flow reconciliation spikes", "https://github.com/Egg3901/AHDGame/issues/992"],
    ["#1975", "Fiscal surplus and debt source-of-truth divergence", "https://github.com/Egg3901/AHDGame/issues/1975"],
    ["#1993", "Actor-gated mechanics missing from autonomous coverage", "https://github.com/Egg3901/AHDGame/issues/1993"],
    ["#1994", "Excessive autonomous cabinet churn", "https://github.com/Egg3901/AHDGame/issues/1994"],
    ["#1995", "Autonomous bills repeat already-enacted law levels", "https://github.com/Egg3901/AHDGame/issues/1995"],
    ["#2021", "Periodic planned-economy M2 pulses", "https://github.com/Egg3901/AHDGame/issues/2021"],
    ["#2033", "Invalid zero-share listings and non-finite changes", "https://github.com/Egg3901/AHDGame/issues/2033"],
    ["#2054", "Clearing order-book and ledger unit mismatch", "https://github.com/Egg3901/AHDGame/issues/2054"],
    ["#2060", "Country election cycles respawn one turn late", "https://github.com/Egg3901/AHDGame/issues/2060"],
    ["#2074", "Queue progress looks fresh while trailing authoritative turns", "https://github.com/Egg3901/AHDGame/issues/2074"],
    ["#2078", "Audit anomaly scan flags routine settlement as suspicious", "https://github.com/Egg3901/AHDGame/issues/2078"],
    ["#2099", "Long-horizon government approval provenance is truncated", "https://github.com/Egg3901/AHDGame/issues/2099"],
    ["#2100", "Long-horizon GDP and population provenance is truncated", "https://github.com/Egg3901/AHDGame/issues/2100"],
    ["#2101", "Brazil Chamber election cycles collapse national representation to five seats", "https://github.com/Egg3901/AHDGame/issues/2101"],
    ["ops #139", "Macro graph double-deflates the stored real GDP-growth series", "https://github.com/Egg3901/LSGD-ops-dash/issues/139"],
    ["ops #140", "Issue-yield tracker cannot represent cross-repository findings", "https://github.com/Egg3901/LSGD-ops-dash/issues/140"],
  ];
  const r2 = [
    ["#2043", "Command-economy SOE losses lack treasury backing", "https://github.com/Egg3901/AHDGame/issues/2043"],
    ["#2056", "GDP jumps at trailing-revenue baseline rollover", "https://github.com/Egg3901/AHDGame/issues/2056"],
    ["#2059", "Year-gated living conflicts open one turn late", "https://github.com/Egg3901/AHDGame/issues/2059"],
  ];
  const modern = [
    ["#2072", "Modern presets retain orphaned officials and candidate-less elections", "https://github.com/Egg3901/AHDGame/issues/2072"],
    ["#2073", "Modern RU and DD central banks have no federal budgets", "https://github.com/Egg3901/AHDGame/issues/2073"],
  ];
  const modern2019 = [
    ["#2076", "2019 budgets mask inherited 1979 and 1991 fiscal inputs", "https://github.com/Egg3901/AHDGame/issues/2076"],
  ];
  const seedText = String(seed);
  const presetSpecific = [
    ...(seedText.includes("1991") || seedText.includes("2019") ? modern : []),
    ...(seedText.includes("2019") ? modern2019 : []),
    ...(seedText.endsWith("-r3") && ["1953", "1991", "2019"].some((year) => seedText.includes(year)) ? [
      ["#2098", "Concurrent election cycles can exhaust regional NPP pools and leave lower chambers candidate-less", "https://github.com/Egg3901/AHDGame/issues/2098"],
    ] : []),
    ...(seedText.includes("1953") ? [
      ["#2028", "1953 seeds duplicate corporation identities", "https://github.com/Egg3901/AHDGame/issues/2028"],
    ] : []),
    ...(seedText.endsWith("1953-r2") ? r2 : []),
  ];
  return [...common, ...presetSpecific]
    .map(([id, title, url]) => `<li><a href="${url}" rel="noopener">${esc(id)} ${esc(title)}</a></li>`).join("");
}

const NATIONAL_OFFICES = {
  US: "house", UK: "commons", RU: "supremeSovietDeputy", FR: "deputy",
  DE: "bundestag", DD: "volkskammerDeputy", IT: "deputy", JP: "shugiin",
  CN: "npcDelegate", IE: "dail", SE: "member", TR: "deputy", AT: "deputy",
  BR: "chamber", NG: "house", PL: "sejmDeputy", CS: "assemblyDeputy",
  HU: "assemblyDeputy", RO: "assemblyDeputy", BG: "assemblyDeputy", YU: "assemblyDelegate",
};

const COUNTRY_CURRENCIES = {
  US: "USD", UK: "GBP", RU: "SUR", DE: "EUR", DD: "DDM", JP: "JPY",
  CN: "CNY", IE: "IEP", BR: "BRL", NG: "NGN", FR: "FRF", IT: "ITL",
  ES: "ESP", SE: "SEK", TR: "TRL", GR: "GRD", AT: "ATS", FI: "FIM",
  PL: "PLZ", CS: "CSK", HU: "HUF", RO: "ROL", BG: "BGL", YU: "YUD",
};

function publicJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

async function countryExplorerData(db, runId, toTurn, sourceCapability, context) {
  const [states, countryStates, macros, approvals, seats, parties, formations, history, metricHistory, npps, officials, centralBanks, durableApproval, durableMacro] = await Promise.all([
    db.collection("states").find({}, { projection: { _id: 1, countryId: 1, population: 1, gdp: 1 } }).toArray(),
    db.collection("countryGameStates").find({}, { projection: { _id: 1, enabledForPlayers: 1, status: 1 } }).toArray(),
    db.collection("macroCountries").find({}, { projection: { _id: 1, displayName: 1, population: 1 } }).toArray(),
    db.collection("governmentApprovals").find({}, { projection: { _id: 0, countryId: 1, history: 1 } }).toArray(),
    db.collection("parliamentSeatsHistory").find({}, { projection: { _id: 0, countryId: 1, officeType: 1, party: 1, seats: 1, turn: 1 } }).sort({ turn: 1 }).toArray(),
    db.collection("politicalParties").find({}, { projection: { _id: 1, sequentialId: 1, countryId: 1, name: 1, abbreviation: 1, color: 1 } }).toArray(),
    db.collection("governmentFormations").find({}, { projection: { _id: 0, countryId: 1, formedTurn: 1, governingPartyId: 1, formationType: 1 } }).toArray(),
    db.collection("countryHistory").find({ eventType: "leader_change" }, { projection: { _id: 0, countryId: 1, turn: 1, officeType: 1, party: 1, "details.nppId": 1 } }).sort({ turn: 1 }).toArray(),
    db.collection("macroMetricsHistory").find({}, { projection: { _id: 1, "economic.gdpGrowth": 1, "population.populationGrowth": 1 } }).toArray(),
    db.collection("npps").find({}, { projection: { _id: 1, party: 1, partyId: 1 } }).toArray(),
    db.collection("electedOfficials").find({ officeType: "president" }, { projection: { _id: 0, countryId: 1, officeType: 1, party: 1, nppId: 1 } }).toArray(),
    db.collection("centralBanks").find({}, { projection: {
      _id: 1, countryId: 1, gdpGrowthHistory: 1, inflationHistory: 1, interestRateHistory: 1,
    }}).toArray(),
    db.collection("approvalTelemetry").find({ runId, region: null }, { projection: {
      _id: 0, country: 1, region: 1, turn: 1, year: 1, foundingTurn: 1, approval: 1,
      runId: 1, worldId: 1, sourceClass: 1, codeVersion: 1, seed: 1, actorConfiguration: 1,
      retentionPolicy: 1, retentionVersion: 1, schemaVersion: 1, calcVersion: 1,
    }}).sort({ country: 1, turn: 1 }).toArray(),
    db.collection("macroTelemetry").find({ runId, region: null, metric: { $in: ["economic.gdp", "population.population"] } }, { projection: {
      _id: 0, country: 1, region: 1, turn: 1, year: 1, foundingTurn: 1, metric: 1, value: 1, units: 1,
      runId: 1, worldId: 1, sourceClass: 1, codeVersion: 1, seed: 1, actorConfiguration: 1,
      retentionPolicy: 1, retentionVersion: 1, schemaVersion: 1, calcVersion: 1,
    }}).sort({ country: 1, metric: 1, turn: 1 }).toArray(),
  ]);
  const stateById = new Map(states.map((item) => [String(item._id), item]));
  const totals = new Map();
  for (const state of states) {
    const id = String(state.countryId || "");
    if (!id) continue;
    const total = totals.get(id) || { population: 0, gdp: 0 };
    total.population += finite(state.population) || 0;
    total.gdp += finite(state.gdp) || 0;
    totals.set(id, total);
  }
  const names = new Map(macros.map((item) => [String(item._id), item.displayName || item._id]));
  const settings = new Map(countryStates.map((item) => [String(item._id), item]));
  const approvalMap = new Map(approvals.map((item) => [String(item.countryId), (item.history || []).map((p) => ({ turn: p.turn, value: finite(p.approval) }))]));
  const partiesByCountry = new Map();
  const nppParty = new Map(npps.map((item) => [String(item._id), item.party ?? item.partyId ?? null]));
  for (const party of parties) {
    const id = String(party.countryId || "");
    const list = partiesByCountry.get(id) || [];
    list.push({ id: String(party._id), sequentialId: party.sequentialId, name: party.name, abbreviation: party.abbreviation, color: party.color });
    partiesByCountry.set(id, list);
  }
  for (const list of partiesByCountry.values()) list.sort((a, b) => (a.sequentialId || 0) - (b.sequentialId || 0));
  const metricByCountry = new Map();
  for (const item of metricHistory) {
    const state = stateById.get(String(item._id));
    if (!state?.countryId) continue;
    const id = String(state.countryId);
    const bucket = metricByCountry.get(id) || [];
    bucket.push({ weight: finite(state.population) || 1, gdp: item.economic?.gdpGrowth || [], pop: item.population?.populationGrowth || [] });
    metricByCountry.set(id, bucket);
  }
  const allIds = [...new Set([...countryStates.map((x) => String(x._id)), ...states.map((x) => String(x.countryId || "")).filter(Boolean), ...macros.map((x) => String(x._id))])].sort();
  const countriesWithSeats = new Set(seats.map((row) => String(row.countryId)));
  const fallbackIds = [...new Set([
    ...["US", "UK", "RU", "DD", "DE", "JP"],
    ...allIds.filter((id) => countriesWithSeats.has(id)),
  ])].filter((id) => (totals.get(id)?.population || 0) > 0).slice(0, 4);
  const countries = allIds.map((id) => {
    const partyList = partiesByCountry.get(id) || [];
    const partyDisplay = (party) => {
      if (!party) return null;
      if (party.name && party.abbreviation && party.name !== party.abbreviation) {
        return `${party.name} (${party.abbreviation})`;
      }
      return party.name || party.abbreviation || null;
    };
    const partyLookup = new Map(partyList.flatMap((party, index) => [[String(party.sequentialId), party], [String(index + 1), party], [party.id, party]]));
    const countrySeats = seats.filter((item) => String(item.countryId) === id);
    const totalsByOffice = new Map();
    for (const row of countrySeats) totalsByOffice.set(row.officeType, (totalsByOffice.get(row.officeType) || 0) + (finite(row.seats) || 0));
    const office = NATIONAL_OFFICES[id] || [...totalsByOffice].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const seatSeries = countrySeats.filter((row) => row.officeType === office).map((row) => {
      const party = partyLookup.get(String(row.party));
      return { turn: row.turn, party: party?.abbreviation || party?.name || `Party ${row.party}`, seats: finite(row.seats), color: party?.color || "#93a4b8" };
    });
    const countryFormations = formations.filter((item) => String(item.countryId) === id);
    const control = history.filter((item) => String(item.countryId) === id).map((item) => {
      const partyId = item.party ?? nppParty.get(String(item.details?.nppId || ""));
      const party = partyLookup.get(String(partyId));
      return { turn: item.turn, office: item.officeType, party: partyDisplay(party) || (partyId == null ? "Nonpartisan / unknown" : `Party ${partyId}`) };
    });
    const seededExecutive = officials.find((item) => String(item.countryId) === id);
    if (seededExecutive) {
      const partyId = seededExecutive.party ?? nppParty.get(String(seededExecutive.nppId || ""));
      const party = partyLookup.get(String(partyId));
      control.push({ turn: 1, office: seededExecutive.officeType, party: partyDisplay(party) || (partyId == null || partyId === "independent" ? "Independent" : `Party ${partyId}`) });
    }
    for (const formation of countryFormations) {
      if (formation.formedTurn == null) continue;
      const party = partyLookup.get(String(formation.governingPartyId));
      control.push({ turn: formation.formedTurn, office: "government", party: partyDisplay(party) || formation.formationType || "Government" });
    }
    control.sort((a, b) => a.turn - b.turn);
    const metric = metricByCountry.get(id) || [];
    const weighted = (key) => {
      const turns = new Map();
      for (const series of metric) for (const point of series[key]) {
        const row = turns.get(point.turn) || { total: 0, weight: 0 };
        if (finite(point.value) !== null) { row.total += point.value * series.weight; row.weight += series.weight; }
        turns.set(point.turn, row);
      }
      return [...turns].sort((a, b) => a[0] - b[0]).map(([turn, row]) => ({ turn, value: row.weight ? row.total / row.weight : null }));
    };
    const total = totals.get(id) || { population: macros.find((x) => String(x._id) === id)?.population || 0, gdp: 0 };
    const bank = centralBanks.find((item) => String(item.countryId || item._id) === id);
    const nominalGrowth = (bank?.gdpGrowthHistory || []).map((point) => ({ turn: point.turn, value: finite(point.rate) }));
    const inflation = (bank?.inflationHistory || []).map((point) => ({ turn: point.turn, value: finite(point.rate) }));
    const inflationByTurn = new Map(inflation.map((point) => [point.turn, point.value]));
    const realGrowth = nominalGrowth.map((point) => ({
      turn: point.turn,
      value: point.value === null || !Number.isFinite(inflationByTurn.get(point.turn))
        ? null : point.value - inflationByTurn.get(point.turn),
    }));
    const telemetry = nationalTelemetry({
      country: id,
      durableApproval,
      durableMacro,
      hasDurableRun: durableApproval.length > 0 || durableMacro.length > 0,
      sourceCapability,
      legacyApproval: approvalMap.get(id) || [],
      legacyGdpGrowth: weighted("gdp"),
      legacyPopulationGrowth: weighted("pop"),
      toTurn,
    });
    return {
      id, name: names.get(id) || id, playerEnabled: settings.get(id)?.enabledForPlayers === true,
      activeFallback: fallbackIds.includes(id), status: settings.get(id)?.status || "available",
      currencyCode: COUNTRY_CURRENCIES[id] || "LOCAL", currentPopulation: total.population,
      currentGdpMillions: total.gdp, currentGdp: total.gdp,
      ...telemetry, legislature: { office, points: seatSeries }, control,
      macro: {
        nominalGrowth, realGrowth, inflation,
        interestRate: (bank?.interestRateHistory || []).map((point) => ({ turn: point.turn, value: finite(point.rate) })),
      },
    };
  });
  const scopes = [...new Set(states.map((row) => String(row.countryId || "")).filter(Boolean))].map((country) => ({ country, region: null }));
  return { countries, qualification: qualifyTelemetry({ context, scopes, points: [
    ...durableApproval.map((row) => ({ ...row, metric: "approval", value: row.approval })), ...durableMacro,
  ] }) };
}

async function main() {
  const control = new MongoClient(CONTROL_URI);
  const sandbox = new MongoClient(SANDBOX_URI);
  await Promise.all([control.connect(), sandbox.connect()]);
  try {
    const job = await control.db().collection("simJobs").findOne({ _id: RUN_ID });
    if (!job) throw new Error("run not found");
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(job.dbName || "")) throw new Error("unsafe sandbox database name");
    const db = sandbox.db(job.dbName);
    const [state, run, vital, conflicts, health, corporationCount, sectorCount, electionCounts, warningTurns] = await Promise.all([
      db.collection("gameState").findOne({ _id: "current" }, { projection: {
        currentTurn: 1, currentYear: 1, startingYear: 1, preset: 1,
        preIteration: 1, preIterationTurns: 1, isProcessing: 1, lastTurnProcessed: 1,
      } }),
      db.collection("simRuns").findOne({ runId: RUN_ID }),
      db.collection("economicVitalSigns").find({}, { projection: {
        _id: 0, turn: 1, "goods.pooledFillRate.value": 1, "goods.countryScopedFillRate.value": 1,
        "trade.intentFulfillmentRate.value": 1, "marketFormation.emptyShare": 1,
        "marketFormation.emptyCells": 1, "marketFormation.cellsObserved": 1,
        "securities.depthToMarketCap.value": 1, "securities.twoSidedListingShare.value": 1,
        "securities.bondSubscriptionRate.value": 1, "goods.medianPriceMultiple.value": 1,
        "goods.priceScarcityCorrelation.value": 1, "trade.localShare.value": 1,
        "trade.interstateShare.value": 1, "trade.importShare.value": 1,
        "production.sectorsObserved": 1, "production.physicalSellThrough.value": 1,
        "production.labourStaffingRate.value": 1, "production.chronicLowFillShare.value": 1,
        "firms.listings": 1, "firms.lossMakingShare.value": 1,
        "firms.marketCapitalizationAnchor": 1,
      }}).sort({ turn: 1 }).toArray(),
      db.collection("livingConflicts").find({ hasOpened: true }, { projection: { _id: 0, defKey: 1, openedYear: 1, phaseLevel: 1, lastProcessedTurn: 1, "campaign.stage": 1, "campaign.lastOutcomeId": 1 } }).toArray(),
      db.collection("gameHealthSnapshots").find({}).sort({ turn: -1 }).limit(1).next(),
      db.collection("corporations").countDocuments({}),
      db.collection("corporateSectors").countDocuments({}),
      db.collection("elections").aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]).toArray(),
      db.collection("gameHealthSnapshots").countDocuments({ $or: [
        { warningCount: { $gt: 0 } },
        { "turnProcessing.warningCount": { $gt: 0 } },
        { "dataIntegrity.issues": { $elemMatch: { severity: "warning" } } },
      ] }),
    ]);
    const qualificationContext = runQualificationContext(run, job, state, readerProvenance());
    const { countries: countryData, qualification: nationalQualification } = await countryExplorerData(
      db, RUN_ID, Number(state?.currentTurn ?? run?.currentTurn ?? job.currentTurn ?? 0),
      telemetryCapability(run?.source?.executedCommit ?? job.sourceCommitVerified ?? job.sourceCommit), qualificationContext
    );

    const turn = state?.currentTurn ?? run?.currentTurn ?? job.currentTurn ?? 0;
    const turns = Number(job.turns || run?.turns || 0);
    const status = String(job.status || run?.status || "unknown");
    const requested = {
      allFeatureFlags: job.allFeatureFlags,
      marketSystemMode: job.marketSystemMode,
      labourSystemMode: job.labourSystemMode,
      autonomyLevel: job.autonomyLevel,
      freightSettlementMode: job.freightSettlementMode,
      canonicalFreightBillingEnabled: job.canonicalFreightBillingEnabled,
      shortageResponsiveSourcingEnabled: job.shortageResponsiveSourcingEnabled,
      indexFundBondLiquidityEnabled: job.indexFundBondLiquidityEnabled,
      equityLiquidityFacilityEnabled: job.equityLiquidityFacilityEnabled,
      nppMarketCoverageEnabled: job.nppMarketCoverageEnabled,
      nppFragileMarketSupplyEnabled: job.nppFragileMarketSupplyEnabled,
    };
    const effective = {
      ...(run?.effectiveConfigInitial?.gameConfig || {}),
      nppAutonomyLevel: run?.effectiveConfigInitial?.gameState?.nppAutonomyLevel,
    };
    const latest = vital[vital.length - 1] || {};
    const points = vital.map((entry) => ({
      turn: entry.turn,
      pooled: finite(entry.goods?.pooledFillRate?.value),
      country: finite(entry.goods?.countryScopedFillRate?.value),
      intent: finite(entry.trade?.intentFulfillmentRate?.value),
      empty: finite(entry.marketFormation?.emptyShare),
      depth: finite(entry.securities?.depthToMarketCap?.value),
      bonds: finite(entry.securities?.bondSubscriptionRate?.value),
      twoSided: finite(entry.securities?.twoSidedListingShare?.value),
      sellThrough: finite(entry.production?.physicalSellThrough?.value),
      lossMaking: finite(entry.firms?.lossMakingShare?.value),
    }));
    const sourceRevision = run?.source?.executedCommit || run?.sourceRevision || job.sourceRevision || run?.runtimeRevision || "Not recorded";
    // Regional points remain in the sandbox database. Publish only selected,
    // sanitized fields in a separate page so the main report stays lightweight.
    const [regionalStates, regionalApprovals, regionalMacros] = await Promise.all([
      db.collection("states").find({}, { projection: { _id: 1, countryId: 1 } }).toArray(),
      db.collection("approvalTelemetry").find({ runId: RUN_ID, region: { $ne: null } }, { projection: {
        _id: 0, country: 1, region: 1, turn: 1, year: 1, foundingTurn: 1, approval: 1,
      runId: 1, worldId: 1, sourceClass: 1, codeVersion: 1, seed: 1, actorConfiguration: 1,
      retentionPolicy: 1, retentionVersion: 1, schemaVersion: 1, calcVersion: 1,
      }}).toArray(),
      db.collection("macroTelemetry").find({ runId: RUN_ID, region: { $ne: null }, metric: { $in: ["economic.gdp", "population.population"] } }, { projection: {
        _id: 0, country: 1, region: 1, turn: 1, year: 1, foundingTurn: 1, metric: 1, value: 1, units: 1,
      runId: 1, worldId: 1, sourceClass: 1, codeVersion: 1, seed: 1, actorConfiguration: 1,
      retentionPolicy: 1, retentionVersion: 1, schemaVersion: 1, calcVersion: 1,
      }}).toArray(),
    ]);
    const regionalQualification = qualifyTelemetry({ context: qualificationContext,
      scopes: regionalStates.map((row) => ({ country: String(row.countryId || ""), region: String(row._id) })),
      points: [...regionalApprovals.map((row) => ({ ...row, metric: "approval", value: row.approval })), ...regionalMacros],
    });
    const regionalData = buildRegionalTelemetry({
      states: regionalStates, approvals: regionalApprovals, macros: regionalMacros, toTurn: Number(turn),
    });
    const regionalSlug = `${slugify(`worldsim-${job.seed || RUN_ID}`)}-regions`;
    // Fresh preset worlds start at raw turn 1. A request for 240 processed turns
    // therefore terminates at raw turn 241; use completed engine iterations for
    // progress instead of presenting 241/240 as an overrun.
    const executedTurns = Math.max(0, turn - 1);
    const progress = turns > 0 ? Math.min(100, Math.max(0, executedTurns / turns * 100)) : 0;
    const foundingFrozenTurns = Math.max(0, Number(state?.preIterationTurns || 0));
    const advancingTurns = Math.max(0, turns - foundingFrozenTurns);
    const requestedYears = advancingTurns / 48;
    const requestedYearsLabel = Number.isInteger(requestedYears)
      ? String(requestedYears)
      : requestedYears.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    const horizonNote = foundingFrozenTurns > 0
      ? `${turns} requested iterations include ${foundingFrozenTurns} founding-election iterations with the calendar frozen. The remaining ${advancingTurns} iterations advance ${requestedYearsLabel} in-game years at 48 iterations per year.`
      : `${turns} requested iterations advance ${requestedYearsLabel} in-game years at 48 iterations per year.`;
    const slug = `worldsim-${slugify(job.seed || RUN_ID)}`;
    const title = `${job.preset || "World"} sandbox simulation: ${job.seed || RUN_ID}`;
    const updated = new Date().toISOString();
    const terminal = ["completed", "failed", "cancelled"].includes(status);
    const electionMap = Object.fromEntries(electionCounts.map((row) => [row._id || "unknown", row.count]));
    const integrityIssues = Array.isArray(health?.dataIntegrity?.issues)
      ? health.dataIntegrity.issues
      : [];
    const healthWarningCount = Number(health?.warningCount || 0)
      + Number(health?.turnProcessing?.warningCount || 0)
      + integrityIssues.filter((issue) => issue?.severity === "warning").length;
    const healthErrorCount = Number(health?.errorCount || 0)
      + Number(health?.turnProcessing?.errorCount || 0)
      + integrityIssues.filter((issue) => issue?.severity === "error").length;
    const healthIssueSummary = integrityIssues.length
      ? integrityIssues.map((issue) => issue?.message).filter(Boolean).join("; ")
      : "No persisted integrity findings";
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="index,follow">${terminal ? "" : '<meta http-equiv="refresh" content="120">'}<title>${esc(title)}</title><style>
:root{color-scheme:dark;--bg:#07111f;--panel:#0e1c2f;--line:#20334b;--muted:#93a4b8;--text:#eef6ff;--cyan:#39d4d8;--gold:#f6c85f;--green:#55d68b;--red:#ff7185;--violet:#ac8cff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% -10%,#173954 0,transparent 38%),var(--bg);color:var(--text);font:14px/1.45 Inter,ui-sans-serif,system-ui,sans-serif}a{color:#72e6ea}main{max-width:1280px;margin:auto;padding:24px 18px 60px}.eyebrow{text-transform:uppercase;letter-spacing:.14em;color:var(--cyan);font-size:.68rem;font-weight:800}.hero{display:grid;grid-template-columns:1fr auto;gap:18px;align-items:end;margin-bottom:14px}h1{font-size:clamp(1.7rem,4vw,3.1rem);line-height:1.02;margin:.2rem 0}.lede{max-width:820px;color:var(--muted);margin:.3rem 0}.stamp{text-align:right;color:var(--muted);font-size:.78rem}.grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:9px}.card{grid-column:span 4;background:linear-gradient(160deg,rgba(18,39,62,.96),rgba(10,24,41,.96));border:1px solid var(--line);border-radius:11px;padding:13px;min-width:0}.wide{grid-column:span 8}.half{grid-column:span 6}.full{grid-column:1/-1}.kpis{grid-column:1/-1;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}.metric{background:#0b192a;border:1px solid var(--line);border-radius:9px;padding:10px;min-width:0}.metric b{font-size:1.25rem;display:block;white-space:nowrap}.metric span,.muted{color:var(--muted);font-size:.78rem}.delta{color:#b7cadc;font-size:.7rem}.progress{height:8px;background:#13243a;border-radius:99px;overflow:hidden;margin:8px 0}.progress i{display:block;height:100%;width:${progress.toFixed(2)}%;background:linear-gradient(90deg,var(--cyan),var(--gold))}.pill{display:inline-flex;border:1px solid var(--line);border-radius:99px;padding:.18rem .48rem;font-size:.7rem;font-weight:800}.pill.ok{color:var(--green);border-color:#2b7651}.pill.bad{color:var(--red);border-color:#843949}.chart,.spark{width:100%;height:160px;background:#091625;border-radius:7px;padding:5px}.legend{display:flex;flex-wrap:wrap;gap:10px;color:var(--muted);font-size:.7rem;margin-top:5px}.legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px}.range{display:flex;justify-content:space-between;color:var(--muted);font-size:.7rem}.empty{height:90px;display:grid;place-items:center;color:var(--muted)}table{width:100%;border-collapse:collapse;font-size:.82rem}th,td{padding:7px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{color:#c8d8e9;font-weight:650}ul{padding-left:1.1rem;columns:2;column-gap:24px}li{margin:.3rem 0;break-inside:avoid}.note{border-left:3px solid var(--gold);padding:8px 10px;background:#171c24;color:#d9c99b}.conflict{display:flex;justify-content:space-between;gap:8px;padding:7px 0;border-bottom:1px solid var(--line)}h2{font-size:1rem;margin:.1rem 0 .5rem}h3{font-size:.88rem;margin:.1rem 0}footer{margin-top:18px;color:var(--muted);font-size:.75rem}@media(max-width:820px){main{padding:16px 10px 45px}.hero{grid-template-columns:1fr}.stamp{text-align:left}.wide,.half,.card{grid-column:1/-1}.kpis{grid-template-columns:repeat(3,minmax(0,1fr))}.metric b{font-size:1.1rem}.chart,.spark{height:130px}ul{columns:1}.tablewrap{overflow-x:auto;-webkit-overflow-scrolling:touch}}@media(max-width:430px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.metric{padding:8px}.metric b{font-size:1rem}body{font-size:13px}}
.countrybar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0 12px}.countrybar select,.countrybar button,.countrysearch{background:#091625;color:var(--text);border:1px solid var(--line);border-radius:7px;padding:7px 9px}.countrybar select{min-width:220px}.gear{cursor:pointer}.picker{display:none;background:#091625;border:1px solid var(--line);border-radius:8px;padding:9px;margin-bottom:10px}.picker.open{display:block}.countrychoices{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px;max-height:180px;overflow:auto;margin-top:8px}.countrychoices label{display:flex;gap:5px;align-items:center;font-size:.75rem}.countrygrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.countrychart{position:relative;background:#091625;border-radius:8px;padding:8px;min-height:205px}.countrychart svg{width:100%;height:155px;overflow:visible}.macrochart{grid-column:1/-1}.metric-controls{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0}.metric-controls label{font-size:.68rem;color:var(--muted);border:1px solid var(--line);border-radius:99px;padding:3px 7px}.charttitle{display:flex;justify-content:space-between;gap:8px;font-size:.78rem;margin-bottom:3px}.chartvalue{color:var(--cyan);font-variant-numeric:tabular-nums}.tooltip{position:absolute;display:none;pointer-events:none;background:#050c16;border:1px solid #37516e;border-radius:6px;padding:5px 7px;font-size:.7rem;z-index:3}.controltrack{display:flex;height:34px;border-radius:5px;overflow:hidden;margin-top:20px}.controlseg{min-width:3px;display:grid;place-items:center;color:white;font-size:.68rem;text-shadow:0 1px 2px #000}.countryfoot{color:var(--muted);font-size:.7rem;margin-top:8px}.founding-band{fill:#ac8cff;opacity:.12}.metric[title],.countrychart[title],.card[title]{cursor:help}@media(max-width:820px){.countrychoices{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:620px){.countrygrid{grid-template-columns:1fr}.macrochart{grid-column:auto}.countrychoices{grid-template-columns:repeat(2,minmax(0,1fr))}.countrybar select{flex:1;min-width:160px}}
</style></head><body><main><section class="hero"><div><div class="eyebrow">A House Divided · Public worldsim evidence</div><h1>${esc(job.seed || "Sandbox run")}</h1><p class="lede">A continuously generated, sanitized view of an isolated full-world simulation. It contains no live-game data, player identities, private messages, internal hostnames, or raw operational logs.</p></div><div class="stamp"><span class="pill ${status === "completed" ? "ok" : status === "failed" ? "bad" : ""}">${esc(status.toUpperCase())}</span><br>Updated ${esc(updated.replace("T", " ").replace(".000Z", " UTC"))}</div></section>
<section class="grid"><article class="card full"><h2>Live progress</h2><div class="progress"><i></i></div><div><strong>${esc(executedTurns)} / ${esc(turns || "?")} iterations</strong> · raw ${esc(turn)} · year ${esc(state?.currentYear ?? "?")} · ${progress.toFixed(1)}% · ${state?.isProcessing ? "turn processing now" : "between turns"}</div><div class="muted">Preset ${esc(job.preset || "unknown")} · revision <code>${esc(sourceRevision)}</code> · ${terminal ? "terminal snapshot" : "page reloads every 2 minutes"}</div></article>
<div class="kpis"><div class="metric"><span>Pooled fill</span><b>${esc(pct(latest.goods?.pooledFillRate?.value))}</b><div class="delta">${esc(delta(points,"pooled"))}</div></div><div class="metric"><span>Country fill</span><b>${esc(pct(latest.goods?.countryScopedFillRate?.value))}</b><div class="delta">${esc(delta(points,"country"))}</div></div><div class="metric"><span>Intent fulfilled</span><b>${esc(pct(latest.trade?.intentFulfillmentRate?.value))}</b><div class="delta">${esc(delta(points,"intent"))}</div></div><div class="metric"><span>Empty cells</span><b>${esc(num(latest.marketFormation?.emptyCells))}</b><div class="delta">${esc(pct(latest.marketFormation?.emptyShare))} of market</div></div><div class="metric"><span>Price multiple</span><b>${esc(num(latest.goods?.medianPriceMultiple?.value,2))}x</b><div class="delta">scarcity r ${esc(num(latest.goods?.priceScarcityCorrelation?.value,2))}</div></div><div class="metric"><span>Sell-through</span><b>${esc(pct(latest.production?.physicalSellThrough?.value))}</b><div class="delta">${esc(num(latest.production?.sectorsObserved || sectorCount))} sectors</div></div><div class="metric"><span>Listings</span><b>${esc(num(latest.firms?.listings))}</b><div class="delta">${esc(pct(latest.firms?.lossMakingShare?.value))} loss-making</div></div><div class="metric"><span>Market cap</span><b>${esc(num((latest.firms?.marketCapitalizationAnchor || 0)/1e9,2))}B</b><div class="delta">anchor currency</div></div><div class="metric"><span>Bond subscription</span><b>${esc(pct(latest.securities?.bondSubscriptionRate?.value))}</b><div class="delta">depth ${esc(pct(latest.securities?.depthToMarketCap?.value,2))}</div></div><div class="metric"><span>Corporations</span><b>${esc(num(corporationCount))}</b><div class="delta">${esc(num(sectorCount))} sectors</div></div><div class="metric"><span>Active elections</span><b>${esc(num(electionMap.active || electionMap.in_progress || 0))}</b><div class="delta">${esc(num(Object.values(electionMap).reduce((a,b)=>a+b,0)))} stored</div></div><div class="metric"><span>Health</span><b>${esc(healthWarningCount)} / ${esc(healthErrorCount)}</b><div class="delta">warnings / errors latest · ${esc(warningTurns)} warned turns</div></div></div>
<article class="card wide"><h2>Market access over time</h2>${multiChart(points,[{key:"pooled",label:"Pooled fill",color:"#39d4d8"},{key:"country",label:"Country fill",color:"#f6c85f"},{key:"intent",label:"Intent fulfilled",color:"#55d68b"},{key:"empty",label:"Empty share",color:"#ff7185"}],"market access trends")}</article><article class="card"><h2>Securities</h2>${multiChart(points,[{key:"depth",label:"Depth / cap",color:"#ac8cff"},{key:"bonds",label:"Bond subscription",color:"#39d4d8"},{key:"twoSided",label:"Two-sided listings",color:"#f6c85f"}],"securities trends")}</article>
<article class="card half"><h2>Production and firms</h2>${multiChart(points,[{key:"sellThrough",label:"Physical sell-through",color:"#55d68b"},{key:"lossMaking",label:"Loss-making share",color:"#ff7185"}],"production and firm trends")}</article><article class="card half"><h2>Trade mix</h2><div class="kpis"><div class="metric"><span>Local</span><b>${esc(pct(latest.trade?.localShare?.value))}</b></div><div class="metric"><span>Interstate</span><b>${esc(pct(latest.trade?.interstateShare?.value))}</b></div><div class="metric"><span>Imports</span><b>${esc(pct(latest.trade?.importShare?.value))}</b></div></div></article>
<article class="card full"><h2>Country explorer</h2><div class="countrybar"><select id="country-select" aria-label="Country"></select><button class="gear" id="country-gear" type="button" aria-expanded="false">⚙ Countries</button><span class="muted" id="country-default-note"></span></div><div class="picker" id="country-picker"><input class="countrysearch" id="country-search" type="search" placeholder="Search every country" aria-label="Search countries"><div class="countrychoices" id="country-choices"></div></div><div class="countrygrid"><div class="countrychart macrochart" data-chart="macro"></div><div class="countrychart" data-chart="approval"></div><div class="countrychart" data-chart="population"></div><div class="countrychart" data-chart="gdp"></div><div class="countrychart" data-chart="seats"></div><div class="countrychart" data-chart="control"></div></div><p class="countryfoot">GDP is stored in millions of local currency and displayed here in full local-currency units. Where durable points exist, approval, GDP, and population use unsampled observed national values; missing turns remain missing. Older runs are labeled legacy bounded and reconstruct GDP/population from the retained growth projection. The shaded founding-election interval keeps the in-game year frozen. Hover or tap charts for the exact turn and in-game year. No live-game or player data is used.</p><p class="countryfoot" id="telemetry-coverage"></p><p><a href="/reports/${esc(regionalSlug)}">Inspect observed regional approval, GDP, and population trajectories and missing-turn coverage</a></p></article>
<article class="card full"><h2>Telemetry qualification</h2><p>${nationalQualification.passing && regionalQualification.passing ? "Complete attributed approval, observed GDP and population series in the declared scope." : "Not qualifying: " + esc([...new Set([...nationalQualification.reasons, ...regionalQualification.reasons])].join("; "))}</p><p class="muted">Completed engine iterations are separate from this telemetry gate. This is not a full-world balance or release pass.</p><details><summary>Source, seed, actors, effective manifest and exact coverage</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify({national: nationalQualification, regional: regionalQualification}, null, 2))}</pre></details></article>
<article class="card full"><h2>Configuration proof</h2><p class="muted">Requested values versus the immutable turn-one manifest. A mismatch invalidates conclusions about that feature.</p><div class="tablewrap"><table><thead><tr><th>Feature</th><th>Requested</th><th>Effective</th><th>Proof</th></tr></thead><tbody>${flagRows(requested,effective)}</tbody></table></div></article>
<article class="card wide"><h2>Evidence-backed findings</h2><p class="muted">These links lead to specific public issues with reproduction queries, expected behavior, and acceptance criteria. Association does not mean every issue was first discovered in this run.</p><ul>${findingRows(job.seed)}</ul></article><article class="card"><h2>Conflict reachability</h2>${conflicts.length ? conflicts.map((item) => `<div class="conflict"><span>${esc(item.defKey.replaceAll("_", " "))}</span><span>${esc(item.campaign?.stage || `phase ${item.phaseLevel}`)}</span></div>`).join("") : '<div class="empty">No authored conflict has opened yet</div>'}</article>
<article class="card full"><h2>Reading this report</h2><p class="note">${esc(horizonNote)}</p><p>Metrics are deterministic extracts from this run's isolated sandbox database. The page deliberately omits database names, process details, internal paths, player-derived text, and unsanitized logs. Health totals combine turn-processing counters with persisted data-integrity findings.</p><p class="muted">Latest recorded health: ${health ? `${esc(healthWarningCount)} warnings and ${esc(healthErrorCount)} errors at raw turn ${esc(health.turn ?? "unknown")}. ${esc(healthIssueSummary)}` : "no aggregate health snapshot available"}.</p></article></section><footer>Run ID <code>${esc(RUN_ID)}</code> · Generated ${esc(updated)} · <a href="https://github.com/Egg3901/AHDGame/issues" rel="noopener">AHDGame issue tracker</a></footer></main><script id="qualification-data" type="application/json">${publicJson({national: nationalQualification, regional: regionalQualification})}</script><script id="country-data" type="application/json">${publicJson(countryData)}</script><script>
(() => {
  const all = JSON.parse(document.getElementById("country-data").textContent),
    select = document.getElementById("country-select"),
    picker = document.getElementById("country-picker"),
    choices = document.getElementById("country-choices"),
    search = document.getElementById("country-search"),
    gear = document.getElementById("country-gear"),
    key = "worldsim-countries-${esc(slug)}";
  let visible;
  try {
    visible = JSON.parse(localStorage.getItem(key) || "null");
  } catch {}
  const player = all.filter((c) => c.playerEnabled).map((c) => c.id),
    fallback = all.filter((c) => c.activeFallback).map((c) => c.id);
  if (!Array.isArray(visible) || !visible.length)
    visible = player.length ? player : fallback;
  document.getElementById("country-default-note").textContent = player.length
    ? "Default: player-enabled countries"
    : "Headless run: active-country fallback";
  const color = (s) => {
    let h = 0;
    for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
    return "hsl(" + h + " 65% 55%)";
  };
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
  const safeColor = (value, fallback) => /^#[0-9a-fA-F]{6}$/.test(value || "") ? value : fallback;
  const fmt = (v, kind) => {
    if (v == null || !Number.isFinite(v)) return "Not recorded";
    if (kind === "approval" || kind === "growth") return v.toFixed(2) + "%";
    if (kind === "population")
      return Intl.NumberFormat("en", {
        notation: "compact",
        maximumFractionDigits: 2,
      }).format(v);
    if (kind === "gdp")
      return Intl.NumberFormat("en", {
        notation: "compact",
        maximumFractionDigits: 2,
      }).format(v);
    return Math.round(v).toLocaleString();
  };
  function rebuild() {
    select.replaceChildren(...visible
      .map((id) => {
        const c = all.find((x) => x.id === id);
        if (!c) return null;
        const option = document.createElement("option");
        option.value = c.id;
        option.textContent = c.name + " (" + c.id + ")";
        return option;
      })
      .filter(Boolean));
    if (!select.value && visible[0]) select.value = visible[0];
    renderChoices();
    render();
  }
  function renderChoices() {
    const q = search.value.toLowerCase();
    choices.replaceChildren(...all
      .filter((c) => (c.name + " " + c.id).toLowerCase().includes(q))
      .map((c) => {
        const label = document.createElement("label");
        const input = document.createElement("input");
        const span = document.createElement("span");
        input.type = "checkbox";
        input.value = c.id;
        input.checked = visible.includes(c.id);
        span.textContent = c.name + " (" + c.id + ")";
        label.append(input, span);
        return label;
      }));
  }
  function reconstructed(series, current) {
    if (!series.length || !current) return [];
    let value = current,
      out = [];
    for (let i = series.length - 1; i >= 0; i--) {
      out.push({ turn: series[i].turn, value });
      value /= 1 + series[i].value / 100 / 48;
    }
    return out.reverse();
  }
  function line(el, title, points, kind, colorValue) {
    if (points.length < 2) {
      el.innerHTML =
        '<div class="charttitle"><b>' +
        esc(title) +
        '</b></div><div class="empty">Not enough history recorded</div>';
      return;
    }
    const vals = points.map((p) => p.value).filter(Number.isFinite),
      min = Math.min(...vals),
      max = Math.max(...vals),
      span = max - min || 1,
      xmin = points[0].turn,
      xspan = points.at(-1).turn - xmin || 1,
      xy = (p) => [
        5 + ((p.turn - xmin) / xspan) * 90,
        92 - ((p.value - min) / span) * 80,
      ],
      path = points
        .filter((p) => Number.isFinite(p.value))
        .map((p, i) => (i ? "L" : "M") + xy(p).join(","))
        .join(" ");
    el.innerHTML =
      '<div class="charttitle"><b>' +
      esc(title) +
      '</b><span class="chartvalue">' +
      fmt(points.at(-1).value, kind) +
      '</span></div><svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M5 12H95M5 52H95M5 92H95" stroke="#20334b" stroke-width=".4" vector-effect="non-scaling-stroke"/><path d="' +
      path +
      '" fill="none" stroke="' +
      colorValue +
      '" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><div class="range"><span>Turn ' +
      xmin +
      " · " +
      fmt(min, kind) +
      "</span><span>Turn " +
      points.at(-1).turn +
      " · " +
      fmt(max, kind) +
      '</span></div><div class="tooltip"></div>';
    const tip = el.querySelector(".tooltip");
    el.onpointermove = (e) => {
      const r = el.getBoundingClientRect(),
        ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
        target = xmin + ratio * xspan,
        p = points.reduce((a, b) =>
          Math.abs(b.turn - target) < Math.abs(a.turn - target) ? b : a,
        );
      tip.style.display = "block";
      tip.style.left =
        Math.min(r.width - 125, Math.max(4, e.clientX - r.left + 8)) + "px";
      tip.style.top = "38px";
      tip.textContent = "Turn " + p.turn + ": " + fmt(p.value, kind);
    };
    el.onpointerleave = () => (tip.style.display = "none");
  }
  function seats(el, c) {
    const rows = c.legislature.points,
      turns = [...new Set(rows.map((r) => r.turn))].sort((a, b) => a - b),
      parties = [...new Set(rows.map((r) => r.party))];
    if (turns.length < 2) {
      el.innerHTML =
        '<div class="charttitle"><b>Legislature seats</b></div><div class="empty">No seat history recorded</div>';
      return;
    }
    const series = parties.map((p) => ({
      p,
      color: rows.find((r) => r.party === p)?.color || color(p),
      points: turns.map((t) => ({
        turn: t,
        value: rows.find((r) => r.turn === t && r.party === p)?.seats || 0,
      })),
    }));
    el.innerHTML =
      '<div class="charttitle"><b>Legislature seats · ' +
      esc(c.legislature.office || "national") +
      '</b><span class="chartvalue">' +
      series.map((s) => esc(s.p) + " " + s.points.at(-1).value).join(" · ") +
      '</span></div><svg viewBox="0 0 100 100" preserveAspectRatio="none">' +
      series
        .map((s) => {
          const max = Math.max(
            1,
            ...turns.map((t) =>
              rows
                .filter((r) => r.turn === t)
                .reduce((n, r) => n + (r.seats || 0), 0),
            ),
          );
          return (
            '<polyline points="' +
            s.points
              .map(
                (p, i) =>
                  5 +
                  (i / (turns.length - 1)) * 90 +
                  "," +
                  (92 - (p.value / max) * 80),
              )
              .join(" ") +
            '" fill="none" stroke="' +
            safeColor(s.color, color(s.p)) +
            '" stroke-width="2" vector-effect="non-scaling-stroke"/>'
          );
        })
        .join("") +
      '</svg><div class="legend">' +
      series
        .map(
          (s) =>
            '<span><i style="background:' +
            safeColor(s.color, color(s.p)) +
            '"></i>' +
            esc(s.p) +
            "</span>",
        )
        .join("") +
      "</div>";
  }
  function control(el, c) {
    const rows = c.control;
    if (!rows.length) {
      el.innerHTML =
        '<div class="charttitle"><b>Executive control</b></div><div class="empty">No control changes recorded</div>';
      return;
    }
    const end = Math.max(...rows.map((r) => r.turn), ${Number(turn)||0}),
      start = Math.min(...rows.map((r) => r.turn));
    el.innerHTML =
      '<div class="charttitle"><b>Executive control over time</b><span class="chartvalue">' +
      esc(rows.at(-1).party) +
      '</span></div><div class="controltrack">' +
      rows
        .map((r, i) => {
          const next = rows[i + 1]?.turn || end + 1,
            w = Math.max(1, ((next - r.turn) / (end - start + 1)) * 100);
          return (
            '<div class="controlseg" title="Turn ' +
            r.turn +
            ": " +
            esc(r.party) +
            " (" +
            esc(r.office) +
            ')" style="width:' +
            w +
            "%;background:" +
            color(r.party) +
            '">' +
            esc(r.party) +
            "</div>"
          );
        })
        .join("") +
      '</div><div class="range"><span>Turn ' +
      start +
      "</span><span>Turn " +
      end +
      "</span></div>";
  }
  function render() {
    const c = all.find((x) => x.id === select.value) || all[0];
    if (!c) return;
    line(
      document.querySelector("[data-chart=approval]"),
      "Government approval",
      c.approval,
      "approval",
      "#39d4d8",
    );
    line(
      document.querySelector("[data-chart=population]"),
      "Population · reconstructed",
      reconstructed(c.populationGrowth, c.currentPopulation),
      "population",
      "#55d68b",
    );
    line(
      document.querySelector("[data-chart=gdp]"),
      "GDP · reconstructed",
      reconstructed(c.gdpGrowth, c.currentGdp),
      "gdp",
      "#f6c85f",
    );
    seats(document.querySelector("[data-chart=seats]"), c);
    control(document.querySelector("[data-chart=control]"), c);
  }
  gear.onclick = () => {
    picker.classList.toggle("open");
    gear.setAttribute("aria-expanded", picker.classList.contains("open"));
  };
  search.oninput = renderChoices;
  choices.onchange = (e) => {
    if (!e.target.matches("input")) return;
    visible = e.target.checked
      ? [...new Set([...visible, e.target.value])]
      : visible.filter((x) => x !== e.target.value);
    if (!visible.length) {
      visible = [e.target.value];
      e.target.checked = true;
    }
    localStorage.setItem(key, JSON.stringify(visible));
    rebuild();
  };
  select.onchange = render;
  rebuild();
})();
</script><script>
(()=>{
  const countries=JSON.parse(document.getElementById('country-data').textContent);
  const select=document.getElementById('country-select');
  const clock=${publicJson({
    startingYear: state?.startingYear || Number(String(job.preset || "").slice(0, 4)) || null,
    turnsPerYear: 48,
    foundingElection: {
      active: state?.preIteration?.active === true,
      rawEndTurn: state?.preIteration?.active === true
        ? Number(state?.currentTurn || 0)
        : Number(state?.preIterationTurns || 0) || null,
      frozenTurns: Number(state?.preIterationTurns || 0),
    },
  })};
  const why={
    'Pooled fill':'Share of aggregate demand filled. Persistent weakness means the economy cannot supply what buyers request.',
    'Country fill':'Domestic demand fulfilled within countries. It exposes local shortages hidden by world totals.',
    'Intent fulfilled':'Share of intended purchases that actually clear. It connects demand plans to realized activity.',
    'Empty cells':'Country and commodity markets with no usable trade. Empty cells reveal missing economic coverage.',
    'Price multiple':'Median price relative to baseline. It is a compact scarcity and inflation pressure signal.',
    'Sell-through':'Produced output that finds a buyer. Low values point to overcapacity or broken demand.',
    'Listings':'Tradable firms available to investors. Sparse listings weaken capital-market depth.',
    'Market cap':'Aggregate listed equity value in anchor currency. It tracks corporate scale and concentration.',
    'Bond subscription':'Share of sovereign issuance bought. Weak subscription signals fiscal financing stress.',
    'Corporations':'Number of operating firms. Coverage matters for competition and sector resilience.',
    'Active elections':'Contests currently underway. It shows political-system activity and load.',
    'Health':'Persisted warnings and errors. These qualify whether run outcomes are mechanically trustworthy.'
  };
  document.querySelectorAll('.metric').forEach(el=>{const label=el.querySelector('span')?.textContent.trim();if(why[label]){el.title=why[label];el.tabIndex=0}});
  const chartWhy={approval:'Approval tracks government legitimacy and electoral pressure.',population:'Population changes the tax base, workforce, demand, and representation.',gdp:'GDP level measures the scale of domestic production in local currency.',seats:'Legislative seats determine lawmaking power and government viability.',control:'Executive control shows which party can direct government over time.',macro:'Real and nominal growth, inflation, and policy rates show whether expansion is productive, price-driven, or constrained by monetary policy.'};
  const yearAt=turn=>{if(!Number.isFinite(Number(turn))||!clock.startingYear)return'?';const frozen=Number(clock.foundingElection?.frozenTurns||0),cal=Math.max(1,Number(turn)-frozen);return Number(clock.startingYear)+Math.floor((cal-1)/Number(clock.turnsPerYear||48))};
  const labelAt=turn=>'Turn '+turn+' · '+yearAt(turn)+(clock.foundingElection?.rawEndTurn&&turn<=clock.foundingElection.rawEndTurn?' · founding':'');
  const fullAmount=(v,code)=>Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:2}).format(v*1e6)+' '+code;
  const reconstruct=(series,current)=>{if(!series?.length||!current)return[];let value=current,out=[];for(let i=series.length-1;i>=0;i--){out.push({turn:series[i].turn,value});value/=1+(series[i].value/100/48)}return out.reverse()};
  const esc=value=>String(value??'').replace(/[&<>\"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[char]));
  function band(xmin,xspan){const end=Number(clock.foundingElection?.rawEndTurn||0);if(!end||end<xmin||end>xmin+xspan)return'';const width=Math.max(0,Math.min(90,(end-xmin)/xspan*90));return '<rect class="founding-band" x="5" y="12" width="'+width+'" height="80"/><path d="M'+(5+width)+' 12V92" stroke="#ac8cff" stroke-dasharray="2 2" stroke-width=".7" vector-effect="non-scaling-stroke"/>'}
  function line(el,title,points,format,color,help){
    el.title=help;el.tabIndex=0;
    const clean=(points||[]).filter(p=>Number.isFinite(p.value));
    if(clean.length<2){
      const emptyMarkup='<div class="charttitle"><b>'+esc(title)+'</b></div><div class="empty">Not enough history recorded</div>';
      el.innerHTML=emptyMarkup;
      return;
    }
    const vals=clean.map(p=>p.value),min=Math.min(...vals),max=Math.max(...vals),span=max-min||1,xmin=clean[0].turn,xspan=clean.at(-1).turn-xmin||1;
    const xy=p=>[5+(p.turn-xmin)/xspan*90,92-(p.value-min)/span*80];
    const path=clean.map((p,i)=>(i?'L':'M')+xy(p).join(',')).join(' ');
    const chartMarkup='<div class="charttitle"><b>'+esc(title)+'</b><span class="chartvalue">'+esc(format(clean.at(-1).value))+'</span></div><svg viewBox="0 0 100 100" preserveAspectRatio="none">'+band(xmin,xspan)+'<path d="M5 12H95M5 52H95M5 92H95" stroke="#20334b" stroke-width=".4" vector-effect="non-scaling-stroke"/><path d="'+esc(path)+'" fill="none" stroke="'+esc(color)+'" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><div class="range"><span>'+esc(labelAt(xmin))+' · '+esc(format(min))+'</span><span>'+esc(labelAt(clean.at(-1).turn))+' · '+esc(format(max))+'</span></div><div class="tooltip"></div>';
    el.innerHTML=chartMarkup;
    const tip=el.querySelector('.tooltip');el.onpointermove=e=>{const r=el.getBoundingClientRect(),target=xmin+Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*xspan,p=clean.reduce((a,b)=>Math.abs(b.turn-target)<Math.abs(a.turn-target)?b:a);tip.style.display='block';tip.style.left=Math.min(r.width-180,Math.max(4,e.clientX-r.left+8))+'px';tip.style.top='38px';tip.textContent=labelAt(p.turn)+': '+format(p.value)};el.onpointerleave=()=>tip.style.display='none';
  }
  function macro(el,c){
    el.title=chartWhy.macro;el.tabIndex=0;
    const specs={realGrowth:{label:'Real GDP growth',color:'#55d68b'},nominalGrowth:{label:'Nominal GDP growth',color:'#f6c85f'},inflation:{label:'Inflation',color:'#ff7185'},interestRate:{label:'Policy interest rate',color:'#39d4d8'}};
    let selected=['realGrowth','nominalGrowth','interestRate'].filter(k=>c.macro?.[k]?.length>1);
    const render=()=>{const active=selected.map(k=>({key:k,...specs[k],points:(c.macro?.[k]||[]).filter(p=>Number.isFinite(p.value))})).filter(s=>s.points.length>1),all=active.flatMap(s=>s.points);if(!all.length){
      const macroMarkup='<div class="charttitle"><b>Macroeconomic rates</b></div><div class="empty">No central-bank history recorded</div>';
      return;
    }const xmin=Math.min(...all.map(p=>p.turn)),xmax=Math.max(...all.map(p=>p.turn)),xspan=xmax-xmin||1,min=Math.min(...all.map(p=>p.value)),max=Math.max(...all.map(p=>p.value)),span=max-min||1,paths=active.map(s=>'<polyline points="'+s.points.map(p=>(5+(p.turn-xmin)/xspan*90)+','+(92-(p.value-min)/span*80)).join(' ')+'" fill="none" stroke="'+s.color+'" stroke-width="2" vector-effect="non-scaling-stroke"/>').join('');const macroMarkup='<div class="charttitle"><b>Macroeconomic rates</b><span class="chartvalue">annualized %</span></div><div class="metric-controls">'+Object.entries(specs).filter(([k])=>c.macro?.[k]?.length>1).map(([k,s])=>'<label title="'+(k==='realGrowth'?'Nominal GDP growth minus inflation. It approximates growth in actual output.':k==='nominalGrowth'?'Growth in current-price GDP. It combines real output and price change.':k==='inflation'?'Annual price growth. It separates price expansion from real expansion.':'The central bank policy rate. It shows monetary restraint or support.')+'"><input type="checkbox" value="'+k+'" '+(selected.includes(k)?'checked':'')+'>'+s.label+'</label>').join('')+'</div><svg viewBox="0 0 100 100" preserveAspectRatio="none">'+band(xmin,xspan)+'<path d="M5 12H95M5 52H95M5 92H95" stroke="#20334b" stroke-width=".4" vector-effect="non-scaling-stroke"/>'+paths+'</svg><div class="legend">'+active.map(s=>'<span><i style="background:'+s.color+'"></i>'+s.label+'</span>').join('')+'</div><div class="range"><span>'+labelAt(xmin)+' · '+min.toFixed(2)+'%</span><span>'+labelAt(xmax)+' · '+max.toFixed(2)+'%</span></div><div class="tooltip"></div>';
    el.innerHTML=macroMarkup;
    el.querySelectorAll('input').forEach(input=>input.onchange=()=>{if(input.checked&&selected.length>=3){input.checked=false;return}selected=input.checked?[...selected,input.value]:selected.filter(k=>k!==input.value);if(!selected.length){input.checked=true;selected=[input.value];return}render()});const tip=el.querySelector('.tooltip');el.onpointermove=e=>{const r=el.getBoundingClientRect(),turn=Math.round(xmin+Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*xspan),parts=active.map(s=>{const p=s.points.reduce((a,b)=>Math.abs(b.turn-turn)<Math.abs(a.turn-turn)?b:a);return s.label+' '+p.value.toFixed(2)+'%'});tip.style.display='block';tip.style.left=Math.min(r.width-245,Math.max(4,e.clientX-r.left+8))+'px';tip.style.top='70px';tip.textContent=labelAt(turn)+': '+parts.join(' · ')};el.onpointerleave=()=>tip.style.display='none'};
    render();
  }
  function enhance(){const c=countries.find(x=>x.id===select.value)||countries[0];if(!c)return;const coverageEl=document.getElementById('telemetry-coverage');const coverageText=(label,row)=>label+': '+row.observedPoints+' observed; missing turns '+(row.missingTurns.length?row.missingTurns.join(', '):'none');coverageEl.textContent=c.source==='legacy-bounded'?'Legacy bounded projection. Full historical coverage unavailable for this run.':(c.source==='durable'?'Durable national telemetry. ':'Durable national telemetry unavailable. ')+coverageText('Approval',c.coverage.approval)+'; '+coverageText('GDP',c.coverage.gdp)+'; '+coverageText('Population',c.coverage.population);macro(document.querySelector('[data-chart=macro]'),c);line(document.querySelector('[data-chart=approval]'),'Government approval',c.approval,v=>v.toFixed(2)+'%','#39d4d8',chartWhy.approval);line(document.querySelector('[data-chart=population]'),c.source==='durable'?'Population · observed':c.source==='legacy-bounded'?'Population · reconstructed legacy':'Population · unavailable',c.source==='legacy-bounded'?reconstruct(c.populationGrowth,c.currentPopulation):c.populationLevels,v=>Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:2}).format(v),'#55d68b',chartWhy.population);line(document.querySelector('[data-chart=gdp]'),(c.source==='durable'?'GDP · observed (':c.source==='legacy-bounded'?'GDP · reconstructed legacy (':'GDP · unavailable (')+c.currencyCode+')',c.source==='legacy-bounded'?reconstruct(c.gdpGrowth,c.currentGdpMillions):c.gdpLevels,v=>fullAmount(v,c.currencyCode),'#f6c85f',chartWhy.gdp);document.querySelector('[data-chart=seats]').title=chartWhy.seats;document.querySelector('[data-chart=seats]').tabIndex=0;document.querySelector('[data-chart=control]').title=chartWhy.control;document.querySelector('[data-chart=control]').tabIndex=0}
  select.addEventListener('change',()=>queueMicrotask(enhance));queueMicrotask(enhance);
})();
</script></body></html>`;

    const finalReader = readerProvenance();
    if (finalReader.commit !== qualificationContext.collectorCommit || finalReader.dirty !== qualificationContext.collectorDirty)
      throw new Error("Report reader source changed during collection; refusing publication");
    fs.mkdirSync(PUBLISHED_DIR, { recursive: true });
    atomicWrite(path.join(PUBLISHED_DIR, `${regionalSlug}.html`), renderRegionalReport({
      title, runId: RUN_ID, sourceRevision, effectiveManifest: run?.effectiveConfigInitial,
      updated, regions: regionalData, qualification: regionalQualification,
    }));
    atomicWrite(path.join(PUBLISHED_DIR, `${slug}.html`), html);
    const manifest = readManifest();
    const regionalEntry = {
      slug: regionalSlug, title: `${title} · regional trajectories`,
      summary: `Observed country and regional approval, GDP, and population with exact raw-turn coverage and provenance.`,
      category: "World Simulations", icon: "📈", badge: status === "completed" ? "Complete" : `Turn ${turn}`,
      author: "worldsim-audit", public: true, publishedAt: updated,
      updated: manifest.some((item) => item.slug === regionalSlug),
    };
    const regionalIndex = manifest.findIndex((item) => item.slug === regionalSlug);
    if (regionalIndex >= 0) manifest[regionalIndex] = regionalEntry; else manifest.push(regionalEntry);
    const entry = {
      slug, title, summary: `Sanitized ${job.preset || "world"} sandbox simulation evidence, configuration proof, balance trends, and linked findings.`,
      category: "World Simulations", icon: "🌐", badge: status === "completed" ? "Complete" : `Turn ${turn}`,
      author: "worldsim-audit", public: true, publishedAt: updated, updated: manifest.some((item) => item.slug === slug),
      runId: RUN_ID, seed: job.seed || RUN_ID, preset: job.preset || "unknown", status, progress, turn, turns,
      metrics: {
        pooled: finite(latest.goods?.pooledFillRate?.value),
        sellThrough: finite(latest.production?.physicalSellThrough?.value),
        lossMaking: finite(latest.firms?.lossMakingShare?.value),
        warnings: healthWarningCount,
      },
    };
    const index = manifest.findIndex((item) => item.slug === slug);
    if (index >= 0) manifest[index] = entry; else manifest.push(entry);
    await writeProgramIndex(manifest, control.db());
    publishReadinessInventory(PUBLISHED_DIR, manifest);
    atomicWrite(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, runId: RUN_ID, turn, status, slug, url: `${PUBLIC_BASE}/reports/${slug}` }));
  } finally {
    await Promise.allSettled([control.close(), sandbox.close()]);
  }
}

main().catch((error) => { console.error(error?.stack || error); process.exit(1); });
