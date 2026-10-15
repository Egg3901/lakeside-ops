// Game State MCP — game-literate, READ-ONLY queries over the live AHD game DB.
// Not raw Mongo: domain tools (overview, countries, parties, players, elections)
// so agents/bots/narrators can understand the world. Streamable HTTP + scoped
// bearer-token auth. Only reads (find/aggregate/count/distinct) — never writes.
//   node mcp/gamestate-server.js   (default :9730)
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { z } = require("zod");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { createServer } = require("../packages/mcp-server");
const store = require("../knowledge-store");
const tokens = require("../agent-tokens");
const { ObjectId } = require("mongodb");
const { loadRates, toAnchor } = require("../fx");
const { computeExtractionAudit } = require("../extraction-audit");
const {
  buildCountryFx,
  convertSectorRevenue,
  rankPublicSectorCorporations,
} = require("./sector-fx");
const { loadEconomyMetricSnapshot } = require("./economy-metrics");

const PORT = parseInt(process.env.GAMESTATE_MCP_PORT || "9730", 10);
const ACTIVE_ELECTION = { status: { $nin: ["completed", "closed", "cancelled", "finished"] } };

function fxMetadata(currency, rates) {
  const rate = Number(rates[currency]);
  const available = Number.isFinite(rate) && rate !== 0;
  return {
    localCurrency: currency || null,
    anchorCurrency: "anchor",
    localPerAnchor: available ? rate : 1,
    rateAvailable: available,
    source: "live exchangeRates",
    formula: "anchor = local / localPerAnchor",
  };
}

function anchorValue(amount, currency, rates) {
  const rate = Number(rates[currency]);
  if (typeof amount !== "number" || !Number.isFinite(amount) || !Number.isFinite(rate) || rate === 0) return undefined;
  return round2(amount / rate);
}

async function loadCountryFx(db) {
  const rows = await db.collection("exchangeRates")
    .find({}, { projection: { countryId: 1, currencyCode: 1, rate: 1 } }).toArray();
  return buildCountryFx(rows);
}

// Cloudflare edge ranges — a registration captured behind the CDN records the CF edge
// as the client IP, so two unrelated users can "share" one. Mirrors the game's
// isCloudflareEdgeIp guard: these must never count as an alt link.
const CF_V4 = [["173.245.48.0",20],["103.21.244.0",22],["103.22.200.0",22],["103.31.4.0",22],["141.101.64.0",18],["108.162.192.0",18],["190.93.240.0",20],["188.114.96.0",20],["197.234.240.0",22],["198.41.128.0",17],["162.158.0.0",15],["104.16.0.0",13],["104.24.0.0",14],["172.64.0.0",13],["131.0.72.0",22]];
const CF_V6_PREFIXES = ["2400:cb00:","2606:4700:","2803:f800:","2405:b500:","2405:8100:","2a06:98c0:","2c0f:f248:"];
function ip4ToInt(ip) { const p = String(ip).split("."); if (p.length !== 4) return null; let n = 0; for (const x of p) { const v = parseInt(x, 10); if (!(v >= 0 && v <= 255)) return null; n = n * 256 + v; } return n >>> 0; }
function isCloudflareIp(ip) {
  if (!ip) return false;
  const s = String(ip).toLowerCase();
  if (s.includes(":")) return CF_V6_PREFIXES.some((p) => s.startsWith(p));
  const n = ip4ToInt(s);
  if (n === null) return false;
  return CF_V4.some(([base, bits]) => (n >>> (32 - bits)) === (ip4ToInt(base) >>> (32 - bits)));
}

async function main() {
  const db = await store.getDb(process.env.MONGODB_URI);
  await tokens.ensureIndexes(db);
  const game = db; // same a-house-divided DB

  function buildServer() {
    const server = new McpServer({ name: "ops-gamestate", version: "1.0.0" });

    server.tool("game_overview", "Current state of the game world: turn, year, iteration, whether paused, and headline counts (players, parties, NPP politicians, active elections).", {}, async () => {
      const gs = await game.collection("gameState").findOne({ _id: "current" }) || await game.collection("gameState").findOne({ isActive: true }) || await game.collection("gameState").findOne({});
      const [players, parties, npps, activeElections] = await Promise.all([
        game.collection("characters").countDocuments({}),
        game.collection("politicalParties").countDocuments({}),
        game.collection("npps").countDocuments({ retiredAt: null }),
        game.collection("elections").countDocuments(ACTIVE_ELECTION),
      ]);
      return jsonResult({ turn: gs && gs.currentTurn, year: gs && gs.currentYear, iteration: gs && gs.iteration, paused: !!(gs && gs.pausedAt), pauseReason: gs && gs.pauseReason, nextTurn: gs && gs.nextScheduledTurn, players, parties, npps, activeElections });
    });

    server.tool("countries", "Compare playable countries using live population, participation, macroeconomic metrics, currency, and foreign exchange data.", {}, async () => {
      const groupCounts = (collection) => game.collection(collection).aggregate([
        { $group: { _id: "$countryId", count: { $sum: 1 } } },
      ]).toArray();
      const [stateRows, partyRows, playerRows, metricSnapshot, exchangeRows, budgetRows, bankRows] = await Promise.all([
        game.collection("states").aggregate([
          { $group: { _id: "$countryId", states: { $sum: 1 }, population: { $sum: { $ifNull: ["$population", 0] } } } },
        ]).toArray(),
        groupCounts("politicalParties"),
        groupCounts("characters"),
        loadEconomyMetricSnapshot(game),
        game.collection("exchangeRates").find({}, { projection: { currencyCode: 1, rate: 1 } }).toArray(),
        game.collection("federalBudget").find({}, { projection: { economicFactors: 1, creditRating: 1, debtToGdpRatio: 1 } }).toArray(),
        game.collection("centralBanks").find({}, { projection: { countryId: 1, primeRate: 1 } }).toArray(),
      ]);
      const byCountry = (rows) => new Map(rows.map((row) => [String(row._id), row]));
      const parties = byCountry(partyRows);
      const players = byCountry(playerRows);
      const metrics = new Map(metricSnapshot.countries.map((row) => [row.countryId, row]));
      const exchange = byCountry(exchangeRows);
      const budgets = byCountry(budgetRows);
      const banks = new Map(bankRows.flatMap((row) => [
        [String(row._id), row],
        ...(row.countryId ? [[String(row.countryId), row]] : []),
      ]));
      const out = stateRows.map((state) => {
        const countryId = String(state._id);
        const economy = metrics.get(countryId)?.metrics || {};
        const rate = exchange.get(countryId) || {};
        const budget = budgets.get(countryId === "US" ? "federal" : countryId) || {};
        const bank = banks.get(countryId) || {};
        return {
          countryId,
          states: state.states,
          population: state.population,
          parties: parties.get(countryId)?.count,
          players: players.get(countryId)?.count,
          currency: rate.currencyCode || "",
          fx: fxMetadata(rate.currencyCode || "", rate.currencyCode ? { [rate.currencyCode]: rate.rate } : {}),
          economy: {
            gdpGrowth: economy.gdpGrowth,
            inflationRate: round2(budget.economicFactors?.inflationRate),
            unemploymentRate: economy.unemploymentRate,
            medianIncome: economy.medianIncomeLocal,
            medianIncomeAnchor: economy.medianIncomeAnchor,
            povertyRate: economy.povertyRate,
            costOfLiving: economy.costOfLiving,
            wageGrowth: round2(budget.economicFactors?.wageGrowth),
            tradeGrowth: round2(budget.economicFactors?.tradeGrowth),
            primeRate: round2(bank.primeRate),
            creditRating: budget.creditRating,
            debtToGdpRatio: round2(budget.debtToGdpRatio),
          },
        };
      });
      return jsonResult(out);
    });

    server.tool("parties", "List political parties in a country with ideology and treasury.", { country: z.string().describe("countryId, e.g. US / UK") }, async ({ country }) => {
      const p = await game.collection("politicalParties").find({ countryId: country }, { projection: { name: 1, abbreviation: 1, economicPosition: 1, socialPosition: 1, foreignPolicy: 1, treasury: 1, color: 1 } }).limit(60).toArray();
      return jsonResult(p);
    });

    server.tool("top_players", "Top player characters by REAL net worth (currencyBalances personal + savings, FX-converted to anchor ₳). IMPORTANT: `funds` is the deprecated legacy scalar / campaign war chest — political operating money, NOT wealth — surfaced here as `campaignFunds` and never used as the wealth signal (ranking by it was the classic 'wealth looks flat' mistake). Also supports politicalInfluence / favorability / infamy / campaignFunds.", {
      country: z.string().optional(), by: z.enum(["netWorth", "politicalInfluence", "favorability", "infamy", "campaignFunds"]).optional().default("netWorth"), limit: z.number().int().min(1).max(40).optional().default(15),
    }, async ({ country, by, limit }) => {
      const q = country ? { countryId: country } : {};
      const rates = await loadRates(game);
      const rows = await game.collection("characters").find(q, { projection: { name: 1, homeState: 1, countryId: 1, politicalInfluence: 1, funds: 1, favorability: 1, infamy: 1, currencyBalances: 1 } }).toArray();
      const enriched = rows.map((r) => {
        let netWorth = 0;
        for (const [ccy, amt] of Object.entries(r.currencyBalances?.personal || {})) netWorth += toAnchor(amt, ccy, rates);
        for (const [ccy, amt] of Object.entries(r.currencyBalances?.savings || {})) netWorth += toAnchor(amt, ccy, rates);
        return { name: r.name, countryId: r.countryId, homeState: r.homeState, netWorthAnchor: Math.round(netWorth), campaignFunds: Math.round(r.funds ?? 0), politicalInfluence: r.politicalInfluence, favorability: r.favorability, infamy: r.infamy };
      });
      const key = by === "netWorth" ? "netWorthAnchor" : by;
      enriched.sort((a, b) => (b[key] || 0) - (a[key] || 0));
      return jsonResult({ rankedBy: by, note: "netWorthAnchor = personal + savings, forex-converted to ₳; campaignFunds is operating money, NOT wealth", players: enriched.slice(0, limit) });
    });

    server.tool("elections", "Active / upcoming elections (optionally filtered by country).", { country: z.string().optional(), limit: z.number().int().min(1).max(40).optional().default(20) }, async ({ country, limit }) => {
      const q = { ...ACTIVE_ELECTION }; if (country) q.countryId = country;
      const e = await game.collection("elections").find(q, { projection: { electionType: 1, state: 1, countryId: 1, status: 1, electionYear: 1, totalSeats: 1, endTime: 1 } }).sort({ endTime: 1 }).limit(limit).toArray();
      return jsonResult(e);
    });

    server.tool("extraction_market", "Extraction / raw-commodity market intelligence: per-resource global supply/demand, reachable vs idle per-state capacity, and a verdict (ok / re-strategize / place-sectors / bump-capacity) with the top target states for fixing a shortage. Answers 'is copper still short and why', 'which states have idle deposits with no miners', and 'is a given state maxed on capacity'. This is the placement/adoption view the raw price tools can't give — capacity is enforced PER STATE, so a resource can be globally un-bound yet locally maxed. Optionally filter to one resource (copper, iron, oil, natural_gas, coal, timber, rare_earth); omit for all seven.", {
      resource: z.enum(["copper", "iron", "oil", "natural_gas", "coal", "timber", "rare_earth"]).optional().describe("Restrict to one extractable resource; omit for all seven."),
    }, async ({ resource }) => {
      const audit = await computeExtractionAudit(game);
      const perResource = resource ? audit.perResource.filter((r) => r.resource === resource) : audit.perResource;
      return jsonResult({ currentTurn: audit.currentTurn, summary: audit.summary, perResource });
    });

    // ── Forensics: entity time-lines with causes (read-only) ──────────────
    // Folded onto the existing gamestate MCP (anti-sprawl: no new mcp_forensics
    // server). Makes triage / audit / support investigations far faster.
    async function currentTurn() {
      // isActive is false on the live singleton; _id:"current" is the real key.
      const gs = await game.collection("gameState").findOne({ _id: "current" }, { projection: { currentTurn: 1 } }) || await game.collection("gameState").findOne({ isActive: true }, { projection: { currentTurn: 1 } }) || {};
      return gs.currentTurn ?? 0;
    }
    async function resolveCharacter(idOrName) {
      if (ObjectId.isValid(idOrName)) { const c = await game.collection("characters").findOne({ _id: new ObjectId(idOrName) }); if (c) return c; }
      return game.collection("characters").findOne({ name: new RegExp("^" + String(idOrName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i") });
    }

    // ── Shared account-forensics helpers (trace_account + alt_ring_audit) ──
    const crypto = require("crypto");
    const maskIp = (ip) => !ip ? "—" : (String(ip).includes(".") ? String(ip).split(".").slice(0, 2).join(".") + ".x.x" : String(ip).slice(0, 6) + "…");
    const fpx = (s) => !s ? "—" : String(s).slice(0, 10);
    const emailH = (e) => !e ? "—" : crypto.createHash("sha1").update(String(e)).digest("hex").slice(0, 8);
    const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Defensive PII masking for free-form evidence blobs written by the alt-scoring engine
    // (src/lib/altDetection) and the audit spine's `net` envelope — masks by KEY NAME so it
    // stays correct even if the writer's evidence shape changes. Cloudflare-edge IPs are
    // called out rather than silently masked, mirroring the isCloudflareIp guard used elsewhere.
    function maskEvidence(v) {
      if (v == null) return v;
      if (Array.isArray(v)) return v.map(maskEvidence);
      if (typeof v !== "object") return v;
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        if (typeof val === "string" && /(^|[_.])ip($|[_.A-Z])|ipaddress/i.test(k)) { out[k] = isCloudflareIp(val) ? "(cloudflare edge — excluded, not a real signal)" : maskIp(val); continue; }
        if (typeof val === "string" && /fingerprint|devicekey|trackingid/i.test(k)) { out[k] = fpx(val); continue; }
        if (typeof val === "string" && /email/i.test(k)) { out[k] = emailH(val); continue; }
        out[k] = typeof val === "object" ? maskEvidence(val) : val;
      }
      return out;
    }
    const maskContribution = (c) => !c ? c : { type: c.type, weight: c.weight, contribution: c.contribution, detectedAt: c.detectedAt, evidence: maskEvidence(c.evidence) };
    const acctSummary = (u, name) => ({
      userId: String(u._id), character: name,
      createdAt: u.createdAt, lastLogin: u.lastLogin || null, lastActivity: u.lastActivity || null,
      banned: !!u.isBanned, banReason: u.banReason || null,
      discord: u.discordUsername || (u.discordId ? "(id only)" : null),
      emailHash: emailH(u.email), device: u.lastDevice || null,
      ip: { reg: maskIp(u.registrationIp), last: maskIp(u.lastKnownIp) },
      cloudflareIp: [u.registrationIp, u.lastKnownIp].some(isCloudflareIp) || undefined,
      fp: { reg: fpx(u.registrationFingerprint), last: fpx(u.lastFingerprint) },
      deviceKey: fpx(u.deviceKey), trackingId: fpx(u.trackingId),
      referredBy: u.referredBy ? String(u.referredBy) : null,
    });
    async function linkedAccounts(u) {
      const users = game.collection("users");
      const chars = game.collection("characters");
      const fpSet = [u.registrationFingerprint, u.lastFingerprint, ...(u.fingerprintHistory || [])].filter(Boolean);
      // Cloudflare edge addresses are the CDN, not the user — never a link signal.
      const ipSet = [u.registrationIp, u.lastKnownIp].filter(Boolean).filter((ip) => !isCloudflareIp(ip));
      const or = [];
      if (fpSet.length) or.push({ registrationFingerprint: { $in: fpSet } }, { lastFingerprint: { $in: fpSet } }, { fingerprintHistory: { $in: fpSet } });
      if (u.deviceKey) or.push({ deviceKey: u.deviceKey });
      if (u.trackingId) or.push({ trackingId: u.trackingId });
      if (ipSet.length) or.push({ registrationIp: { $in: ipSet } }, { lastKnownIp: { $in: ipSet } });
      if (u.referredBy) or.push({ referredBy: u.referredBy });
      if (!or.length) return [];
      const others = await users.find({ $or: or, _id: { $ne: u._id } }).limit(25).toArray();
      const out = [];
      for (const o of others) {
        const why = [];
        if (fpSet.includes(o.registrationFingerprint) || fpSet.includes(o.lastFingerprint) || (o.fingerprintHistory || []).some((h) => fpSet.includes(h))) why.push("fingerprint");
        if (u.deviceKey && o.deviceKey === u.deviceKey) why.push("deviceKey");
        if (u.trackingId && o.trackingId === u.trackingId) why.push("trackingId");
        if (ipSet.includes(o.registrationIp) || ipSet.includes(o.lastKnownIp)) why.push("ip");
        if (u.referredBy && o.referredBy && String(o.referredBy) === String(u.referredBy)) why.push("same-referrer");
        if (!why.length) continue;
        const ocs = await chars.find({ userId: o._id }).project({ name: 1 }).limit(10).toArray();
        out.push({ userId: String(o._id), characters: ocs.map((c) => c.name), banned: !!o.isBanned, banReason: o.banReason || null, discord: o.discordUsername || (o.discordId ? "(id only)" : null), linkedVia: why, strength: why.some((w) => w === "fingerprint" || w === "deviceKey" || w === "trackingId") ? "strong (device)" : why.includes("ip") ? "weak (shared IP — could be VPN/carrier)" : "circumstantial (same referrer)" });
      }
      return out;
    }

    server.tool("trace_character", "Forensic wealth time-line for a player character: per-turn savings balance with cause breakdown (interest/deposit/withdraw) plus share-trade activity. Answers 'how did this player get rich' — the classic minted-interest investigation. Accepts a character id or exact name.", {
      character: z.string().describe("character ObjectId or exact name"),
      fromTurn: z.number().int().optional().describe("start turn (default: last 20 turns)"),
      toTurn: z.number().int().optional().describe("end turn (default: current)"),
    }, async ({ character, fromTurn, toTurn }) => {
      const ch = await resolveCharacter(character);
      if (!ch) return jsonResult({ error: "character not found: " + character });
      const to = toTurn ?? await currentTurn();
      const from = fromTurn ?? Math.max(0, to - 20);
      const cid = ch._id;
      const rates = await loadRates(game);
      const [savingsRaw, buys, sells] = await Promise.all([
        // Group by turn AND currency so we can convert each to the anchor ₳
        // before combining — savings can span multiple currency accounts.
        game.collection("savingsLedger").aggregate([
          { $match: { characterId: cid, turn: { $gte: from, $lte: to } } },
          { $group: { _id: { turn: "$turn", ccy: "$currencyCode" }, lastBalance: { $last: "$balanceAfter" }, interest: { $sum: { $cond: [{ $eq: ["$type", "interest"] }, "$amount", 0] } }, deposits: { $sum: { $cond: [{ $eq: ["$type", "deposit"] }, "$amount", 0] } }, withdrawals: { $sum: { $cond: [{ $eq: ["$type", "withdraw"] }, "$amount", 0] } } } },
        ]).toArray(),
        game.collection("shareTradeHistory").aggregate([{ $match: { "to.characterId": cid, turn: { $gte: from, $lte: to } } }, { $group: { _id: "$turn", n: { $sum: 1 }, value: { $sum: "$totalAnchor" } } }]).toArray(),
        game.collection("shareTradeHistory").aggregate([{ $match: { "from.characterId": cid, turn: { $gte: from, $lte: to } } }, { $group: { _id: "$turn", n: { $sum: 1 }, value: { $sum: "$totalAnchor" } } }]).toArray(),
      ]);
      // Fold per-(turn,currency) savings rows into per-turn anchor totals.
      const savings = {};
      for (const s of savingsRaw) {
        const t = s._id.turn, ccy = s._id.ccy;
        const row = savings[t] || (savings[t] = { _id: t, lastBalance: 0, interest: 0, deposits: 0, withdrawals: 0, currencies: new Set() });
        row.lastBalance += toAnchor(s.lastBalance, ccy, rates);
        row.interest += toAnchor(s.interest, ccy, rates);
        row.deposits += toAnchor(s.deposits, ccy, rates);
        row.withdrawals += toAnchor(s.withdrawals, ccy, rates);
        row.currencies.add(ccy);
      }
      const byTurn = {};
      for (const s of Object.values(savings)) byTurn[s._id] = { turn: s._id, savingsBalanceAnchor: round2(s.lastBalance), interestAnchor: round2(s.interest), depositsAnchor: round2(s.deposits), withdrawalsAnchor: round2(s.withdrawals), currencies: [...s.currencies], bought: 0, boughtValue: 0, sold: 0, soldValue: 0 };
      const blank = (t) => ({ turn: t, savingsBalanceAnchor: null, interestAnchor: 0, depositsAnchor: 0, withdrawalsAnchor: 0, currencies: [], bought: 0, boughtValue: 0, sold: 0, soldValue: 0 });
      for (const b of buys) { (byTurn[b._id] = byTurn[b._id] || blank(b._id)); byTurn[b._id].bought = b.n; byTurn[b._id].boughtValue = round2(b.value); }
      for (const s of sells) { (byTurn[s._id] = byTurn[s._id] || blank(s._id)); byTurn[s._id].sold = s.n; byTurn[s._id].soldValue = round2(s.value); }
      const timeline = Object.values(byTurn).sort((a, b) => a.turn - b.turn);
      const totalInterest = round2(Object.values(savings).reduce((a, s) => a + (s.interest || 0), 0));
      return jsonResult({
        character: (() => {
          let nw = 0;
          for (const [ccy, amt] of Object.entries(ch.currencyBalances?.personal || {})) nw += toAnchor(amt, ccy, rates);
          for (const [ccy, amt] of Object.entries(ch.currencyBalances?.savings || {})) nw += toAnchor(amt, ccy, rates);
          return { id: String(cid), name: ch.name, countryId: ch.countryId, netWorthAnchor: Math.round(nw), campaignFunds: Math.round(ch.funds ?? 0), _note: "campaignFunds is operating/political money, NOT wealth — netWorthAnchor is the wealth signal" };
        })(),
        window: { from, to },
        currency: "all savings values converted to anchor ₳ (forex-aware)",
        summary: { totalInterestEarnedAnchor: totalInterest, tradeTurns: buys.length + sells.length },
        timeline,
      });
    });

    server.tool("trace_bonds", "Forensic bond-holding breakdown for a player character: every bond they hold, native-currency vs anchor-₳ value, cost basis vs current market price, and a per-turn price history so a value swing can be attributed to bond-price movement vs FX (currency) drift. Answers 'why did my bond portfolio value change' — the classic foreign-currency-bond support question (a bond's own price barely moves but its anchor-converted value swings with the currency). Accepts a character id or exact name.", {
      character: z.string().describe("character ObjectId or exact name"),
      historyTurns: z.number().int().min(0).max(100).optional().default(20).describe("how many recent per-turn price points to include per bond (default 20)"),
    }, async ({ character, historyTurns }) => {
      const ch = await resolveCharacter(character);
      if (!ch) return jsonResult({ error: "character not found: " + character });
      const cid = ch._id;
      const BOND_UNIT_FACE_VALUE = 1000; // src/lib/db/types/bond.ts — face value per unit, in the bond's own currencyCode
      const to = await currentTurn();
      const rates = await loadRates(game);
      const bonds = await game.collection("bonds").find({ "holders.characterId": cid }).toArray();
      if (bonds.length === 0) return jsonResult({ character: { id: String(cid), name: ch.name, countryId: ch.countryId }, note: "no bond holdings found (checked holders.characterId across matured and unmatured bonds)", bonds: [] });

      const corpIds = [...new Set(bonds.map((b) => b.corporationId && String(b.corporationId)).filter(Boolean))];
      const corps = await game.collection("corporations").find({ _id: { $in: corpIds.map((id) => new ObjectId(id)) } }, { projection: { name: 1 } }).toArray();
      const corpNameById = new Map(corps.map((c) => [String(c._id), c.name]));

      const out = [];
      for (const b of bonds) {
        const holder = (b.holders || []).find((h) => h.characterId && String(h.characterId) === String(cid));
        if (!holder || !(holder.units > 0)) continue;
        const ccy = b.currencyCode || null;
        const rate = ccy ? rates[ccy] : undefined; // "units of ccy per 1 anchor ₳"; undefined => rate unknown, treat 1:1
        const currentValueLocal = holder.units * BOND_UNIT_FACE_VALUE * b.marketPrice;
        const costBasisLocal = holder.avgCostPerUnit != null ? holder.units * holder.avgCostPerUnit : null;
        const history = await game.collection("bondHistory").find({ bondId: b._id }, { projection: { turn: 1, marketPrice: 1 } }).sort({ turn: -1 }).limit(historyTurns).toArray();
        history.sort((a, c2) => a.turn - c2.turn);
        const priceNow = b.marketPrice;
        const priceAtHistoryStart = history.length ? history[0].marketPrice : null;
        out.push({
          bondId: String(b._id),
          issuer: b.issuerType === "sovereign" ? `${b.countryId || "?"} sovereign` : (corpNameById.get(String(b.corporationId)) || b.issuerName || "corporate"),
          issuerType: b.issuerType || "corporation",
          countryId: b.countryId || null,
          currencyCode: ccy,
          fxRateNow: rate ?? null,
          fxNote: rate == null ? "no exchangeRates row for this currency — value below is left un-converted (treated 1:1), do not trust cross-currency comparisons" : "rate = units of " + ccy + " per 1 anchor ₳; anchor value = local / rate",
          units: holder.units,
          faceValuePerUnit: BOND_UNIT_FACE_VALUE,
          marketPriceNow: priceNow,
          marketPriceAtHistoryStart: priceAtHistoryStart,
          priceChangePercent: priceAtHistoryStart ? round2(((priceNow - priceAtHistoryStart) / priceAtHistoryStart) * 100) : null,
          avgCostPerUnit: holder.avgCostPerUnit ?? null,
          currentValueLocal: round2(currentValueLocal),
          currentValueAnchor: round2(rate ? currentValueLocal / rate : currentValueLocal),
          costBasisLocal: costBasisLocal != null ? round2(costBasisLocal) : null,
          costBasisAnchorAtCURRENTFxRate: costBasisLocal != null ? round2(rate ? costBasisLocal / rate : costBasisLocal) : "avgCostPerUnit not tracked on this holding (pre-tracking position)",
          costBasisCaveat: "costBasisAnchorAtCURRENTFxRate re-prices the ORIGINAL local cost using TODAY's FX rate (no FX-rate history is stored) — it isolates bond-price gain/loss in local terms, but does NOT isolate how much of the anchor-value swing is FX vs price. Compare marketPriceNow vs marketPriceAtHistoryStart for the price-only component; the residual between that and the anchor swing is FX drift.",
          defaulted: !!b.defaulted,
          matured: !!b.matured,
          maturityTurn: b.maturityTurn,
          turnsRemaining: Math.max(0, (b.maturityTurn || 0) - to),
          priceHistory: history.map((h) => ({ turn: h.turn, marketPrice: h.marketPrice })),
        });
      }
      return jsonResult({ character: { id: String(cid), name: ch.name, countryId: ch.countryId }, currentTurn: to, bonds: out });
    });

    server.tool("trace_account", "Account-forensics / alt-detection for a player. Resolves a character to its owner account and surfaces (a) the account's age + activity + MASKED device signals, (b) OTHER accounts linked by a shared device fingerprint, deviceKey, trackingId or IP — the alt / puppet-master link, and (c) with attackers:true, everyone who has hit this character's reputation (player_attack notifications) grouped by attacker, each annotated with account age/activity and whether it links to another account. Answers the classic 'is this player being ground down by alts / who is behind the throwaways' moderation question that the game-state tools alone can't. PII is masked (partial IP, fingerprint prefix, hashed email) — enough to see clustering, never raw. Read-only. Accepts a character id or exact name.", {
      character: z.string().describe("character ObjectId or exact name (the subject / suspected victim)"),
      attackers: z.boolean().optional().default(false).describe("also break down who has attacked this character's reputation and whether those accounts link to others"),
    }, async ({ character, attackers }) => {
      const users = game.collection("users");
      const chars = game.collection("characters");
      const ch = await resolveCharacter(character);
      if (!ch) return jsonResult({ error: "character not found: " + character });
      const subjUser = await users.findOne({ _id: ch.userId });
      if (!subjUser) return jsonResult({ error: "owner account not found for character " + ch.name });
      const subjChars = await chars.find({ userId: subjUser._id }).project({ name: 1, countryId: 1 }).toArray();
      const result = {
        subject: { ...acctSummary(subjUser, ch.name), allCharacters: subjChars.map((c) => c.name) },
        linkedAccounts: await linkedAccounts(subjUser),
        note: "Device (fingerprint/deviceKey/trackingId) links are strong alt evidence; IP-only links are weak (shared VPN/carrier/household). Fingerprint collisions on default mobile browsers are possible — treat as leads, not proof.",
      };
      if (attackers) {
        const notifs = await game.collection("notifications").find({ userId: subjUser._id, type: "player_attack" }).toArray();
        const byAtk = new Map();
        for (const n of notifs) {
          const m = n.metadata || {};
          if (!m.attackerId) continue;
          const e = byAtk.get(m.attackerId) || { name: m.attackerName || "?", count: 0, first: n.createdAt, last: n.createdAt };
          e.count++; if (n.createdAt < e.first) e.first = n.createdAt; if (n.createdAt > e.last) e.last = n.createdAt;
          byAtk.set(m.attackerId, e);
        }
        const attackerRows = [];
        for (const [cid, e] of [...byAtk.entries()].sort((a, b) => b[1].count - a[1].count)) {
          let acct = null, linked = [];
          const ac = ObjectId.isValid(cid) ? await chars.findOne({ _id: new ObjectId(cid) }) : null;
          if (ac) { const au = await users.findOne({ _id: ac.userId }); if (au) { acct = acctSummary(au, ac.name); linked = await linkedAccounts(au); } }
          attackerRows.push({ attacker: e.name, attacks: e.count, window: { first: e.first, last: e.last }, account: acct, linkedAccounts: linked });
        }
        result.reputationAttackers = { totalAttacks: notifs.length, distinctAttackers: byAtk.size, attackers: attackerRows };
      }
      return jsonResult(result);
    });

    const ALT_LINKS = "altLinks";
    const ALT_CLUSTERS = "altClusters";

    server.tool("alt_ring_audit", "Multi-account RING audit — feed it the suspected alt characters (1-8 names/ids) and get one merged forensic case file: (0) PRECOMPUTED confidence — if the altScoring engine has already scored these accounts, its authoritative confidence % + per-signal marginal-contribution breakdown + evidence for any matching altClusters/altLinks (empty until `gameConfig.altScoringEnabled` is on; falls back to on-demand analysis below when nothing is precomputed yet), (a) per-account summary with ban state and MASKED device signals, (b) the abuse engine's own suspiciousCharacters flags, (c) a pairwise shared-signal matrix (fingerprint/deviceKey/trackingId/non-Cloudflare IP), (d) the REFERRAL cluster — accounts sharing a referrer, plus every other account that referrer created, with ban states (burner farms show up as a wave of banned siblings), (e) ring expansion to accounts outside the input set, (f) coordinated behavior: attack victims hit by 2+ ring members (last 45 days) and same-party switches within a 48h window (vote-stacking bloc detection). Use trace_account for a single subject; use alt_rank to find candidate rings first; use this when reviewing a moderation case with several named suspects. Read-only, PII-masked.", {
      characters: z.array(z.string()).min(1).max(8).describe("character ObjectIds or exact names (the suspected ring)"),
    }, async ({ characters }) => {
      const users = game.collection("users");
      const chars = game.collection("characters");
      const subjects = [];
      const notFound = [];
      for (const c of characters) {
        const ch = await resolveCharacter(c);
        if (!ch) { notFound.push(c); continue; }
        const u = await users.findOne({ _id: ch.userId });
        if (u) subjects.push({ ch, u });
      }
      if (!subjects.length) return jsonResult({ error: "no characters resolved", notFound });

      // (0) precomputed alt-detection confidence (Goal-2: altScoring engine, noisy-OR over
      // weighted signals). Read first; the on-demand sections below (a-f) remain as a
      // fallback / supporting-evidence view when nothing has been precomputed for these
      // accounts yet (feature flag off, scorer hasn't run, or genuinely below threshold).
      const subjectUserIds = subjects.map((s) => s.u._id);
      const userNameById = new Map(subjects.map((s) => [String(s.u._id), s.ch.name]));
      const nameFor = (id) => userNameById.get(String(id)) || String(id);
      const [preClusters, preLinks] = await Promise.all([
        game.collection(ALT_CLUSTERS).find({ memberUserIds: { $in: subjectUserIds } }).sort({ confidence: -1 }).limit(10).toArray(),
        game.collection(ALT_LINKS).find({ $or: [{ userA: { $in: subjectUserIds } }, { userB: { $in: subjectUserIds } }] }).sort({ confidence: -1 }).limit(50).toArray(),
      ]);
      const precomputed = {
        clusters: preClusters.map((c) => ({
          id: String(c._id), confidencePct: Math.round((c.confidence || 0) * 1000) / 10,
          size: c.size ?? (c.memberUserIds || []).length, status: c.status || "open",
          roles: c.roles ? {
            operator: c.roles.operator != null ? nameFor(c.roles.operator) : undefined,
            burners: (c.roles.burners || []).map(nameFor),
            associates: (c.roles.associates || []).map(nameFor),
          } : undefined,
          members: (c.memberUserIds || []).map(nameFor),
          signalBreakdown: (c.contributions || c.signalSummary || []).map(maskContribution),
          topEvidence: (c.topEvidence || []).map(maskEvidence),
          reviewedBy: c.reviewedBy, reviewNote: c.reviewNote,
          updatedAt: c.updatedAt, turn: c.turn,
        })),
        links: preLinks.map((l) => ({
          pair: [nameFor(l.userA), nameFor(l.userB)],
          confidencePct: Math.round((l.confidence || 0) * 1000) / 10,
          signalBreakdown: (l.signals || []).map(maskContribution),
          updatedAt: l.updatedAt, turn: l.turn,
        })),
        note: (preClusters.length || preLinks.length)
          ? "authoritative — computed by the altScoring engine's noisy-OR confidence model. Sections (a)-(f) below are supporting/on-demand detail, not a second opinion."
          : "no precomputed cluster/link for these accounts yet (gameConfig.altScoringEnabled likely off for this world, the scorer hasn't run, or these accounts score below the link threshold) — falling back to the on-demand pairwise/referral/ring analysis in (a)-(f) below.",
      };

      // (a) account summaries + party posture
      const accounts = subjects.map(({ ch, u }) => ({
        ...acctSummary(u, ch.name),
        party: ch.party ?? null,
        partyJoinedAt: ch.partyJoinedAt ?? null,
        lastPartySwitchAt: ch.lastPartySwitchAt ?? null,
        office: ch.currentOffice ?? ch.office ?? null,
      }));

      // (b) abuse-engine flags
      const susp = await game.collection("suspiciousCharacters").find({ _id: { $in: subjects.map((s) => s.ch._id) } }).toArray();
      const suspiciousFlags = susp.map((s) => ({
        character: subjects.find((x) => String(x.ch._id) === String(s._id))?.ch.name,
        pool: s.pool ?? "active", highestSeverity: s.highestSeverity, dismissed: !!s.dismissed,
        flags: (s.flags || []).map((f) => ({ type: f.type, severity: f.severity, detail: f.detail })),
      }));

      // (c) pairwise shared signals inside the ring
      const sharedSignals = [];
      for (let i = 0; i < subjects.length; i++) for (let j = i + 1; j < subjects.length; j++) {
        const a = subjects[i].u, b = subjects[j].u;
        const why = [];
        const aFp = [a.registrationFingerprint, a.lastFingerprint, ...(a.fingerprintHistory || [])].filter(Boolean);
        const bFp = [b.registrationFingerprint, b.lastFingerprint, ...(b.fingerprintHistory || [])].filter(Boolean);
        const fpHit = aFp.find((f) => bFp.includes(f));
        if (fpHit) why.push("fingerprint:" + fpx(fpHit));
        if (a.deviceKey && a.deviceKey === b.deviceKey) why.push("deviceKey");
        if (a.trackingId && a.trackingId === b.trackingId) why.push("trackingId");
        const aIp = [a.registrationIp, a.lastKnownIp].filter(Boolean).filter((ip) => !isCloudflareIp(ip));
        const bIp = [b.registrationIp, b.lastKnownIp].filter(Boolean).filter((ip) => !isCloudflareIp(ip));
        const ipHit = aIp.find((ip) => bIp.includes(ip));
        if (ipHit) why.push("ip:" + maskIp(ipHit));
        if (a.referredBy && b.referredBy && String(a.referredBy) === String(b.referredBy)) why.push("same-referrer");
        if (why.length) sharedSignals.push({ pair: [subjects[i].ch.name, subjects[j].ch.name], via: why });
      }

      // (d) referral clusters: every account each shared referrer ever referred
      const refIds = [...new Set(subjects.map((s) => s.u.referredBy && String(s.u.referredBy)).filter(Boolean))];
      const referralClusters = [];
      for (const rid of refIds) {
        const refUser = await users.findOne({ _id: new ObjectId(rid) });
        const refChars = refUser ? await chars.find({ userId: refUser._id }).project({ name: 1 }).limit(5).toArray() : [];
        const siblings = await users.find({ referredBy: new ObjectId(rid) }).limit(30).toArray();
        const rows = [];
        for (const sib of siblings) {
          const scs = await chars.find({ userId: sib._id }).project({ name: 1 }).limit(5).toArray();
          rows.push({ userId: String(sib._id), characters: scs.map((c) => c.name), banned: !!sib.isBanned, banReason: sib.banReason || null, createdAt: sib.createdAt, lastLogin: sib.lastLogin || null, inRing: subjects.some((s) => String(s.u._id) === String(sib._id)) });
        }
        referralClusters.push({
          referrer: refUser ? { ...acctSummary(refUser, refChars.map((c) => c.name).join(", ") || "(no character)"), referralCount: refUser.referralCount ?? rows.length } : { userId: rid, note: "referrer account missing" },
          referredAccounts: rows.sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt)),
          bannedSiblings: rows.filter((r) => r.banned).length,
        });
      }

      // (e) ring expansion beyond the input set
      const subjectIds = new Set(subjects.map((s) => String(s.u._id)));
      const expansion = new Map();
      for (const s of subjects) {
        for (const link of await linkedAccounts(s.u)) {
          if (subjectIds.has(link.userId)) continue;
          const prev = expansion.get(link.userId);
          if (prev) prev.linkedToSubjects.push(s.ch.name);
          else expansion.set(link.userId, { ...link, linkedToSubjects: [s.ch.name] });
        }
      }

      // (f) coordinated behavior
      const since = new Date(Date.now() - 45 * 86400 * 1000);
      const atk = await game.collection("actionLogs").find({
        characterId: { $in: subjects.map((s) => s.ch._id) },
        actionType: { $regex: /attack/i }, createdAt: { $gte: since },
      }).project({ characterId: 1, actionType: 1, "result.message": 1 }).limit(5000).toArray();
      const nameByChar = new Map(subjects.map((s) => [String(s.ch._id), s.ch.name]));
      const victims = new Map();
      for (const l of atk) {
        const m = (l.result && l.result.message) || "";
        let v = (m.match(/(?:Attacked|against|on|targeting)\s+([A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+){0,3})/) || [])[1];
        if (!v) continue;
        v = v.replace(/'s$/, "");
        const e = victims.get(v) || { attacks: 0, by: new Set() };
        e.attacks++; e.by.add(nameByChar.get(String(l.characterId)));
        victims.set(v, e);
      }
      const commonVictims = [...victims.entries()].filter(([, e]) => e.by.size >= 2)
        .map(([v, e]) => ({ victim: v, attacks: e.attacks, attackedBy: [...e.by] }))
        .sort((x, y) => y.attackedBy.length - x.attackedBy.length || y.attacks - x.attacks).slice(0, 15);
      const switches = subjects.map((s) => ({ name: s.ch.name, party: s.ch.party ?? null, at: s.ch.lastPartySwitchAt ? new Date(s.ch.lastPartySwitchAt) : null })).filter((x) => x.party != null && x.at);
      const partyBlocs = [];
      const byParty = new Map();
      for (const s of switches) { const k = String(s.party); if (!byParty.has(k)) byParty.set(k, []); byParty.get(k).push(s); }
      for (const [party, list] of byParty) {
        if (list.length < 2) continue;
        const times = list.map((x) => x.at.getTime()).sort((a, b) => a - b);
        if (times[times.length - 1] - times[0] <= 48 * 3600 * 1000) {
          partyBlocs.push({ party, members: list.map((x) => x.name), windowHours: Math.round((times[times.length - 1] - times[0]) / 3600000 * 10) / 10, note: "same-party switch bloc — check active leadership/whip votes in this party" });
        }
      }

      const strongPairs = sharedSignals.filter((s) => s.via.some((v) => /^(fingerprint|deviceKey|trackingId)/.test(v))).length;
      return jsonResult({
        ...(notFound.length ? { notFound } : {}),
        precomputed,
        accounts, suspiciousFlags, sharedSignals, referralClusters,
        ringExpansion: [...expansion.values()],
        coordination: { commonVictims, partyBlocs },
        verdictHints: {
          strongDevicePairs: strongPairs,
          bannedReferralSiblings: referralClusters.reduce((n, c) => n + c.bannedSiblings, 0),
          note: "Strong = shared fingerprint/deviceKey/trackingId. Same-referrer + banned siblings + coordinated victims is a ring pattern even without device overlap (VPN-per-account rings). IP links exclude Cloudflare edges. If `precomputed` has clusters/links, prefer its confidence % over these heuristic hints.",
        },
      });
    });

    server.tool("alt_rank", "Moderation triage queue: top-N precomputed alt-detection CLUSTERS ranked by confidence, most-suspicious first. Reads `altClusters` (populated by the altScoring turn phase / cron once `gameConfig.altScoringEnabled` is on for this world; empty otherwise — that means 'not computed yet', not 'nothing suspicious'). Each row shows confidence %, size, status, roles (operator/burners/associates) and a masked member preview so you can pick candidates to hand to alt_ring_audit for the full case file with per-signal evidence. Read-only, PII-masked.", {
      minConfidence: z.number().min(0).max(1).optional().default(0).describe("minimum confidence, 0..1 (e.g. 0.6 = 60%+)"),
      status: z.enum(["open", "reviewed", "confirmed", "dismissed"]).optional().describe("filter by moderator review status"),
      limit: z.number().int().min(1).max(50).optional().default(20),
    }, async ({ minConfidence, status, limit }) => {
      const q = {};
      if (minConfidence) q.confidence = { $gte: minConfidence };
      if (status) q.status = status;
      const clusters = await game.collection(ALT_CLUSTERS).find(q).sort({ confidence: -1 }).limit(limit).toArray();
      if (!clusters.length) {
        return jsonResult({ count: 0, clusters: [], note: "no clusters found — either gameConfig.altScoringEnabled is off for this world, the altScoring engine hasn't run yet, or nothing clears minConfidence. Try alt_ring_audit with named suspects for an on-demand check instead." });
      }
      const users = game.collection("users");
      const chars = game.collection("characters");
      const allIds = [...new Set(clusters.flatMap((c) => (c.memberUserIds || []).map(String)))]
        .map((id) => (ObjectId.isValid(id) ? new ObjectId(id) : id));
      const [memberUsers, memberChars] = await Promise.all([
        users.find({ _id: { $in: allIds } }).toArray(),
        chars.find({ userId: { $in: allIds } }).project({ name: 1, userId: 1 }).toArray(),
      ]);
      const userById = new Map(memberUsers.map((u) => [String(u._id), u]));
      const charsByUser = new Map();
      for (const c of memberChars) { const k = String(c.userId); if (!charsByUser.has(k)) charsByUser.set(k, []); charsByUser.get(k).push(c.name); }
      const preview = (id) => {
        const u = userById.get(String(id));
        const names = charsByUser.get(String(id)) || [];
        return { userId: String(id), character: names[0] || "(no character)", banned: !!(u && u.isBanned) };
      };
      return jsonResult({
        count: clusters.length,
        clusters: clusters.map((c) => ({
          id: String(c._id), confidencePct: Math.round((c.confidence || 0) * 1000) / 10,
          size: c.size ?? (c.memberUserIds || []).length, status: c.status || "open",
          roles: c.roles ? {
            operator: c.roles.operator != null ? preview(c.roles.operator) : undefined,
            burners: (c.roles.burners || []).map(preview),
            associates: (c.roles.associates || []).map(preview),
          } : undefined,
          memberPreview: (c.memberUserIds || []).slice(0, 8).map(preview),
          memberCountTotal: (c.memberUserIds || []).length,
          topSignal: (c.contributions || c.signalSummary || [])[0]?.type || null,
          bannedMembers: (c.memberUserIds || []).filter((id) => userById.get(String(id)) && userById.get(String(id)).isBanned).length,
          updatedAt: c.updatedAt, turn: c.turn,
        })),
      });
    });

    server.tool("trace_corp", "Forensic time-line for a corporation: per-turn share price, liquid capital, share-buyback escrow and NET cash (liquidCapital+escrow), revenue, income, dividends and credit rating from corporationHistory. Surfaces `shareEscrowBalance` + `netLiquidCapital` and warns when escrow is NEGATIVE (escrow underflow — the corp's displayed liquidCapital overstates true cash, and a takeover/nationalization moves only the net). Answers 'when did this corp become a black hole / how did the price move / why did my merger only give me a fraction of its cash'. Accepts a corporation id, sequentialId, or exact name.", {
      corporation: z.string().describe("corporation ObjectId, sequentialId, or exact name"),
      fromTurn: z.number().int().optional(),
      toTurn: z.number().int().optional(),
    }, async ({ corporation, fromTurn, toTurn }) => {
      let corp = null;
      if (ObjectId.isValid(corporation)) corp = await game.collection("corporations").findOne({ _id: new ObjectId(corporation) });
      if (!corp && /^\d+$/.test(corporation)) corp = await game.collection("corporations").findOne({ sequentialId: parseInt(corporation, 10) });
      if (!corp) corp = await game.collection("corporations").findOne({ name: new RegExp("^" + String(corporation).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i") });
      if (!corp) return jsonResult({ error: "corporation not found: " + corporation });
      const to = toTurn ?? await currentTurn();
      const from = fromTurn ?? Math.max(0, to - 20);
      const rows = await game.collection("corporationHistory").find({ corporationId: corp._id, turn: { $gte: from, $lte: to } }, { projection: { turn: 1, sharePrice: 1, liquidCapital: 1, shareEscrowBalance: 1, revenue: 1, income: 1, marketCap: 1, dividendPaidPerTurn: 1, creditRating: 1, _id: 0 } }).sort({ turn: 1 }).limit(80).toArray();
      const rates = await loadRates(game);
      const currency = corp.liquidCurrencyCode;
      // corporationHistory only began snapshotting shareEscrowBalance recently; older
      // rows have no escrow field, so `netLiquidCapital` there falls back to liquidCapital.
      const timeline = rows.map((r) => {
        const esc = typeof r.shareEscrowBalance === "number" ? r.shareEscrowBalance : null;
        const net = (r.liquidCapital || 0) + (esc || 0);
        return {
          turn: r.turn,
          sharePrice: round2(r.sharePrice), sharePriceAnchor: anchorValue(r.sharePrice, currency, rates),
          liquidCapital: round2(r.liquidCapital), liquidCapitalAnchor: anchorValue(r.liquidCapital, currency, rates),
          shareEscrowBalance: esc == null ? null : round2(esc),
          netLiquidCapital: round2(net), netLiquidCapitalAnchor: anchorValue(net, currency, rates),
          revenue: round2(r.revenue), revenueAnchor: anchorValue(r.revenue, currency, rates),
          income: round2(r.income), incomeAnchor: anchorValue(r.income, currency, rates),
          marketCap: round2(r.marketCap), marketCapAnchor: anchorValue(r.marketCap, currency, rates),
          dividend: round2(r.dividendPaidPerTurn), dividendAnchor: anchorValue(r.dividendPaidPerTurn, currency, rates),
          creditRating: r.creditRating,
        };
      });
      // Live escrow + net cash. `shareEscrowBalance` is the market-making buyback
      // escrow (escrow buyback mode). It MAY be negative by design — a tracked buyback
      // debt, settled at dissolution/buyout. But when it is negative, the corp's
      // displayed (gross) liquidCapital overstates its true spendable cash, and any
      // takeover/nationalization that transfers `liquidCapital + escrow` moves only the
      // (much smaller) net — the "my merger only gave me a fraction of its cash" class
      // of report. Flag hard when the debt EXCEEDS liquidCapital (net cash is negative).
      const escrow = typeof corp.shareEscrowBalance === "number" ? corp.shareEscrowBalance : 0;
      const netLiquid = (corp.liquidCapital || 0) + escrow;
      const warnings = [];
      if (escrow < 0) {
        const sev = netLiquid < 0 ? "CRITICAL" : "WARNING";
        warnings.push(`[${sev}] shareEscrowBalance is NEGATIVE (${round2(escrow)} ${corp.liquidCurrencyCode || ""}) — a tracked buyback debt (escrow mode). Displayed liquidCapital (${round2(corp.liquidCapital)}) overstates true net cash (${round2(netLiquid)}). A takeover/nationalization transfers only the net, not the gross. If net < 0 the buyback debt exceeds all liquid cash.`);
      }
      return jsonResult({
        fx: fxMetadata(currency, rates),
        corporation: {
          id: String(corp._id), name: corp.name, sequentialId: corp.sequentialId, currency,
          isPrivate: corp.isPrivate === true, hiddenFromExchange: corp.hiddenFromExchange === true,
          publicFloat: corp.publicFloat ?? 0,
          sharePrice: corp.sharePrice, sharePriceAnchor: anchorValue(corp.sharePrice, currency, rates),
          liquidCapital: corp.liquidCapital, liquidCapitalAnchor: anchorValue(corp.liquidCapital, currency, rates),
          shareEscrowBalance: escrow, shareEscrowBalanceAnchor: anchorValue(escrow, currency, rates),
          netLiquidCapital: netLiquid, netLiquidCapitalAnchor: anchorValue(netLiquid, currency, rates),
          isNationalized: !!corp.isNationalized,
        },
        warnings,
        window: { from, to },
        timeline,
      });
    });

    // Market share for a corporateSectors row = its revenue / total revenue in
    // its (stateId,sectorType) cell (owned rows + the unowned remainder). The %
    // is never stored — derived here the same way src/lib/corporations/marketShare.ts does.
    async function cellTotals(countryId, stateId, sectorType) {
      const owned = await game.collection("corporateSectors").find({ countryId, stateId, sectorType }, { projection: { corporationId: 1, revenue: 1 } }).toArray();
      const un = await game.collection("unownedSectors").findOne({ countryId, stateId, sectorType }, { projection: { revenue: 1, recentCorporateSectorRestores: 1 } });
      const ownedRev = owned.reduce((a, s) => a + (s.revenue || 0), 0);
      const total = ownedRev + (un && un.revenue || 0);
      return { owned, unownedRevenue: (un && un.revenue) || 0, total, restores: (un && un.recentCorporateSectorRestores) || [] };
    }

    async function sectorComparison(sectorType) {
      const rows = await game.collection("corporateSectors")
        .find({ sectorType }, { projection: { corporationId: 1, countryId: 1, revenue: 1 } }).toArray();
      const ids = [...new Map(rows.filter((row) => row.corporationId).map((row) => [String(row.corporationId), row.corporationId])).values()];
      const corporations = await game.collection("corporations").find(
        { _id: { $in: ids } },
        { projection: { name: 1, liquidCurrencyCode: 1, isPrivate: 1, hiddenFromExchange: 1, publicFloat: 1, sharePrice: 1 } },
      ).toArray();
      const countryFx = await loadCountryFx(game);
      const { ranked, missingFxStakeRows, omittedCorporations } =
        rankPublicSectorCorporations(rows, corporations, countryFx);
      const totalStakes = ranked.reduce((sum, row) => sum + row.stakes, 0);
      const totalRevenueAnchor = ranked.reduce((sum, row) => sum + row.revenueAnchor, 0);
      const revenues = ranked.map((row) => row.revenueAnchor).sort((a, b) => a - b);
      const middle = Math.floor(revenues.length / 2);
      const median = revenues.length === 0 ? 0
        : revenues.length % 2 ? revenues[middle]
          : (revenues[middle - 1] + revenues[middle]) / 2;
      return {
        sectorType,
        visibility: "public exchange-visible corporations only",
        currency: "anchor",
        fx: {
          anchorCurrency: "anchor",
          source: "live exchangeRates",
          formula: "anchor = sector host-currency revenue / host localPerAnchor",
        },
        corporationsCompared: ranked.length,
        corporationsOmittedMissingFx: omittedCorporations,
        aggregate: {
          totalStakes,
          stakesOmittedMissingFx: missingFxStakeRows,
          totalRevenueAnchor: round2(totalRevenueAnchor),
          averageStakesPerCorporation: round2(ranked.length ? totalStakes / ranked.length : 0),
          averageRevenueAnchorPerCorporation: round2(ranked.length ? totalRevenueAnchor / ranked.length : 0),
          medianRevenueAnchorPerCorporation: round2(median),
        },
        leaders: ranked.slice(0, 30).map(({ corp, stakes, revenueAnchor }) => ({
          name: corp.name,
          stakes,
          revenueAnchor: round2(revenueAnchor),
          averageRevenuePerStakeAnchor: round2(stakes ? revenueAnchor / stakes : 0),
          sharePrice: corp.sharePrice,
          sharePriceCurrency: corp.liquidCurrencyCode,
          publicFloat: corp.publicFloat,
        })),
      };
    }

    server.tool("trace_sector", "Forensic view of corporate market-sector ownership. Three modes: (1) pass a CORPORATION to get its current sector stakes and trend; (2) pass state+sectorType to inspect one market cell; (3) pass sectorType alone for an FX-normalized benchmark of public exchange-visible corporations. Private and exchange-hidden corporations are excluded from the benchmark.", {
      corporation: z.string().optional().describe("corporation ObjectId, sequentialId, or exact name"),
      state: z.string().optional().describe("stateId, e.g. KAN (Kanto). With sectorType, inspects that market cell"),
      sectorType: z.string().optional().describe("sector type, e.g. financial, technology, retail"),
      country: z.string().optional().describe("countryId (inferred from corp/state if omitted)"),
      lastTurns: z.number().int().min(2).max(30).optional().default(8),
    }, async ({ corporation, state, sectorType, country, lastTurns }) => {
      const out = {};
      let corp = null;
      if (!corporation && !state && sectorType) {
        out.sectorComparison = await sectorComparison(sectorType);
      }
      if (corporation) {
        if (ObjectId.isValid(corporation)) corp = await game.collection("corporations").findOne({ _id: new ObjectId(corporation) });
        if (!corp && /^\d+$/.test(corporation)) corp = await game.collection("corporations").findOne({ sequentialId: parseInt(corporation, 10) });
        if (!corp) corp = await game.collection("corporations").findOne({ name: new RegExp("^" + String(corporation).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i") });
        if (!corp) return jsonResult({ error: "corporation not found: " + corporation });
        country = country || corp.countryId;
        const [rates, countryFx] = await Promise.all([loadRates(game), loadCountryFx(game)]);
        const currency = corp.liquidCurrencyCode;
        out.fx = fxMetadata(currency, rates);
        out.sectorFx = {
          source: "live exchangeRates",
          formula: "revenueAnchor = sector revenue / sector host-country localPerAnchor",
          note: "Sector revenue is stored in the operating country's currency, not the corporation's home currency.",
        };
        out.corporation = { id: String(corp._id), name: corp.name, sequentialId: corp.sequentialId, countryId: corp.countryId, currency, isPrivate: corp.isPrivate === true, hiddenFromExchange: corp.hiddenFromExchange === true, publicFloat: corp.publicFloat ?? 0, liquidCapital: round2(corp.liquidCapital), liquidCapitalAnchor: anchorValue(corp.liquidCapital, currency, rates) };

        // Current stakes + derived share (cache cell totals to avoid re-summing).
        const rows = await game.collection("corporateSectors").find({ corporationId: corp._id, ...(state ? { stateId: state } : {}), ...(sectorType ? { sectorType } : {}) }).toArray();
        const cellCache = {};
        const stakes = [];
        for (const s of rows) {
          const key = `${s.countryId}::${s.stateId}::${s.sectorType}`;
          const tot = cellCache[key] || (cellCache[key] = await cellTotals(s.countryId, s.stateId, s.sectorType));
          const converted = convertSectorRevenue(s, countryFx);
          stakes.push({
            country: s.countryId,
            state: s.stateId,
            sector: s.sectorType,
            revenue: round2(s.revenue),
            revenueCurrency: converted && converted.currencyCode,
            revenueLocalPerAnchor: converted && converted.localPerAnchor,
            revenueAnchor: converted && round2(converted.revenueAnchor),
            sharePct: tot.total ? round2((s.revenue / tot.total) * 100) : null,
            negativeProductionTurns: s.negativeProductionSustainedTurns || 0,
            updatedAt: s.updatedAt,
          });
        }
        stakes.sort((a, b) => (b.revenueAnchor ?? -Infinity) - (a.revenueAnchor ?? -Infinity));
        out.currentStakes = stakes;

        // sectorCount + revenue trend — a DROP means a sector was removed that turn.
        const hist = await game.collection("corporationHistory").find({ corporationId: corp._id }, { projection: { turn: 1, revenue: 1, "marginDiagnostic.sectorCount": 1, _id: 0 } }).sort({ turn: -1 }).limit(lastTurns).toArray();
        const trend = hist.reverse().map((h) => ({ turn: h.turn, sectors: h.marginDiagnostic && h.marginDiagnostic.sectorCount, revenue: round2(h.revenue), revenueAnchor: anchorValue(h.revenue, currency, rates) }));
        out.sectorCountTrend = trend;
        out.sectorLosses = [];
        for (let i = 1; i < trend.length; i++) {
          if (typeof trend[i].sectors === "number" && typeof trend[i - 1].sectors === "number" && trend[i].sectors < trend[i - 1].sectors) {
            out.sectorLosses.push({ turn: trend[i].turn, from: trend[i - 1].sectors, to: trend[i].sectors, revenueDelta: round2((trend[i].revenue || 0) - (trend[i - 1].revenue || 0)), note: `Lost ${trend[i - 1].sectors - trend[i].sectors} sector(s) at turn ${trend[i].turn}. Cross-check restore tokens / attacks for the cause.` });
          }
        }
      }

      // Market-cell inspection.
      if (state && sectorType) {
        country = country || (corp && corp.countryId);
        if (!country) {
          const anyRow = await game.collection("corporateSectors").findOne({ stateId: state, sectorType });
          country = anyRow && anyRow.countryId;
        }
        const tot = await cellTotals(country, state, sectorType);
        const countryFx = await loadCountryFx(game);
        const marketConversion = convertSectorRevenue({ countryId: country, revenue: tot.total }, countryFx);
        const unownedConversion = convertSectorRevenue({ countryId: country, revenue: tot.unownedRevenue }, countryFx);
        const parts = tot.owned.map((s) => {
          const converted = convertSectorRevenue({ countryId: country, revenue: s.revenue }, countryFx);
          return {
            corporationId: String(s.corporationId),
            revenue: round2(s.revenue),
            revenueAnchor: converted && round2(converted.revenueAnchor),
            sharePct: tot.total ? round2((s.revenue / tot.total) * 100) : null,
          };
        }).sort((a, b) => b.revenue - a.revenue);
        // name the top participants
        const ids = parts.slice(0, 12).map((p) => new ObjectId(p.corporationId));
        const named = await game.collection("corporations").find({ _id: { $in: ids } }, { projection: { name: 1 } }).toArray();
        const nameMap = Object.fromEntries(named.map((n) => [String(n._id), n.name]));
        out.marketCell = {
          country,
          state,
          sectorType,
          revenueCurrency: marketConversion && marketConversion.currencyCode,
          revenueLocalPerAnchor: marketConversion && marketConversion.localPerAnchor,
          totalRevenue: round2(tot.total),
          totalRevenueAnchor: marketConversion && round2(marketConversion.revenueAnchor),
          unownedRevenue: round2(tot.unownedRevenue),
          unownedRevenueAnchor: unownedConversion && round2(unownedConversion.revenueAnchor),
          participants: parts.slice(0, 12).map((p) => ({
            corp: nameMap[p.corporationId] || p.corporationId.slice(-6),
            sharePct: p.sharePct,
            revenue: p.revenue,
            revenueAnchor: p.revenueAnchor,
          })),
        };
        // Restore-to-unowned tokens = a stake was DELETED and credited back here.
        out.restoreTokens = (tot.restores || []).slice(-10).map((r) => ({ sectorId: String(r.sectorId), restoredAt: r.restoredAt, note: "a corporateSectors row was deleted & its revenue restored to this unowned cell at restoredAt (dissolution / bond default / abandon / turn-phase liquidation)" }));
        // Recent attackSector captures targeting this state.
        const atks = await game.collection("actionLogs").find({ actionType: "attackSector", targetState: state }).sort({ turn: -1 }).limit(12).toArray();
        out.recentAttacks = atks.map((a) => ({ turn: a.turn, byCharacter: String(a.characterId || "").slice(-6), message: (a.result && a.result.message) || null }));
      }

      if (!corporation && !state && !sectorType) out.usage = "Pass a corporation, and/or a state + sectorType.";
      return jsonResult(out);
    });

    // ── President EV helpers (mirror src/lib/elections/apportionment.ts) ──
    // Reconstructed in JS so the MCP can recompute EV without importing game TS.
    // Self-validated below against the stored resolution before trusting any
    // trajectory — a mismatch means the model drifted, so we flag it instead of
    // reporting a wrong number (the class of bug this tool exists to catch).
    async function usElectoralVoteUnits() {
      const states = await game.collection("states").find({ countryId: "US" }, { projection: { _id: 1, houseDistricts: 1 } }).toArray();
      const units = [];
      for (const s of states) {
        const hd = s.houseDistricts;
        if (typeof hd !== "number") continue;
        if (s._id === "DC" || hd < 1) continue; // DC added below (no House seats); skip territories
        if (s._id === "ME" || s._id === "NE") {
          units.push({ unitId: s._id, ev: 2, stateId: s._id }); // at-large 2
          for (let d = 1; d <= hd; d++) units.push({ unitId: `${s._id}_CD${d}`, ev: 1, stateId: s._id });
        } else {
          units.push({ unitId: s._id, ev: hd + 2, stateId: s._id });
        }
      }
      units.push({ unitId: "DC", ev: 3, stateId: "DC" }); // 23rd Amendment
      return units;
    }
    function allocateEv(byUnit, units) {
      const ev = {}; let tie = false;
      for (const u of units) {
        const votes = byUnit[u.unitId]; if (!votes) continue;
        const entries = Object.entries(votes).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
        if (!entries.length) continue;
        if (entries.length >= 2 && entries[0][1] === entries[1][1]) tie = true;
        ev[entries[0][0]] = (ev[entries[0][0]] || 0) + u.ev;
      }
      return { ev, tie };
    }
    function rankEv(ev) {
      return Object.entries(ev).filter(([k]) => k && k !== "undefined").sort((a, b) => b[1] - a[1]);
    }
    // Build per-unit votes as they stood at (or before) a given turn.
    function unitVotesAtTurn(unitTurnSnapshots, turn) {
      const byUnit = {};
      for (const [unitId, snaps] of Object.entries(unitTurnSnapshots || {})) {
        const upto = (snaps || []).filter((s) => s.turn <= turn);
        if (upto.length) byUnit[unitId] = upto[upto.length - 1].cumulativeVotes || {};
      }
      return byUnit;
    }

    server.tool("trace_election", "Forensic breakdown of a RESOLVED election: how it was decided, and — for US president — the electoral-vote trajectory and which state units flipped in the final turns. Answers 'why did the contingent election not fire / why did this candidate win': shows the EV total per turn, the exact turn the leader crossed 270 (contingent→outright), and per-unit vote timelines for units that flipped late. Self-validates its EV model against the stored resolution. Accepts an election ObjectId, or an electionType keyword (e.g. 'president') + country to pick the newest resolved race.", {
      election: z.string().describe("election ObjectId, or electionType keyword like 'president' / 'senate' / 'house'"),
      country: z.string().optional().default("US").describe("country when resolving by type (default US)"),
      lastTurns: z.number().int().min(2).max(20).optional().default(6).describe("how many final snapshot turns to analyze"),
      units: z.array(z.string()).optional().describe("state/unit fragments to force-show timelines for (e.g. ['AZ','WI']); default auto-detects units that flipped in the window"),
    }, async ({ election, country, lastTurns, units }) => {
      let el = null;
      if (ObjectId.isValid(election)) el = await game.collection("elections").findOne({ _id: new ObjectId(election) });
      if (!el) {
        const resolvedStatuses = { status: { $in: ["resolved", "completed", "closed", "finished"] } };
        el = await game.collection("elections").findOne({ electionType: election, countryId: country, ...resolvedStatuses }, { sort: { endTurn: -1 } });
      }
      if (!el) return jsonResult({ error: "election not found: " + election });
      const tally = await game.collection("electionVoteTallies").findOne({ electionId: el._id });
      if (!tally) return jsonResult({ error: "no tally for election " + String(el._id), election: { id: String(el._id), type: el.electionType, status: el.status } });

      const names = tally.candidateNames || {}, parties = tally.candidateParties || {};
      const nm = (id) => `${names[id] || id}${parties[id] ? " (" + parties[id] + ")" : ""}`;
      const out = {
        election: { id: String(el._id), type: el.electionType, countryId: el.countryId, state: el.state, status: el.status, startTurn: el.startTurn, endTurn: el.endTurn },
        finalized: tally.finalized,
        resolutionMode: tally.resolutionMode,
      };

      // Stored electoral-vote result + majority verdict.
      const evStored = tally.electoralVotesByCandidate || null;
      if (evStored) {
        const r = rankEv(evStored);
        out.storedElectoralVotes = r.map(([id, ev]) => ({ candidate: nm(id), ev }));
        const [leadId, leadEv] = r[0] || [null, 0];
        out.majorityCheck = { leader: leadId ? nm(leadId) : null, leaderEv: leadEv, needed: 270, verdict: leadEv >= 270 ? "OUTRIGHT_MAJORITY" : "NO_MAJORITY_→_CONTINGENT" };
      }
      if (tally.contingentResult) {
        const cr = tally.contingentResult;
        out.contingent = { presidentWinner: nm(cr.presidentWinnerId), houseThreshold: cr.houseThreshold, senateThreshold: cr.senateThreshold, deadlockBreakerUsed: cr.deadlockBreakerUsed || false, topElectoralVoteTotal: cr.topElectoralVoteTotal };
      }

      // President-only EV trajectory + flip detection.
      const uts = tally.unitTurnSnapshots || null;
      if (el.electionType === "president" && tally.totalVotesByUnit && uts) {
        const evUnits = await usElectoralVoteUnits();
        const modelTotal = evUnits.reduce((s, u) => s + u.ev, 0);
        const { ev: recomputed } = allocateEv(tally.totalVotesByUnit, evUnits);
        // Self-validate: recomputed final EV must match the stored resolution.
        let reconciled = false;
        if (evStored) {
          reconciled = rankEv(recomputed).every(([id, ev]) => (evStored[id] || 0) === ev) && rankEv(evStored).every(([id, ev]) => (recomputed[id] || 0) === ev);
        }
        out.evModel = { totalEv: modelTotal, reconciledWithStoredResolution: reconciled, note: reconciled ? "EV model matches stored result — trajectory is trustworthy" : "EV model does NOT match stored result — trajectory below is APPROXIMATE (apportionment drift?)" };

        // Turn window.
        const turns = new Set();
        for (const snaps of Object.values(uts)) for (const s of snaps || []) turns.add(s.turn);
        const sorted = [...turns].sort((a, b) => a - b);
        const window = sorted.slice(-lastTurns);
        out.evTrajectory = window.map((t) => {
          const { ev } = allocateEv(unitVotesAtTurn(uts, t), evUnits);
          const r = rankEv(ev); const [id, e] = r[0] || [null, 0];
          return { turn: t, leader: id ? nm(id) : null, leaderEv: e, verdict: e >= 270 ? "outright" : "contingent" };
        });
        // The decisive transition: last turn the leader was <270 → first ≥270.
        for (let i = 1; i < out.evTrajectory.length; i++) {
          const prev = out.evTrajectory[i - 1], cur = out.evTrajectory[i];
          if (prev.verdict === "contingent" && cur.verdict === "outright") {
            out.decisiveTransition = { fromTurn: prev.turn, toTurn: cur.turn, leaderEvBefore: prev.leaderEv, leaderEvAfter: cur.leaderEv, note: `Leader crossed 270 on turn ${cur.turn}; race resolved outright instead of contingent. Any last-turn state flips at turn ${cur.turn} are decisive.` };
          }
        }

        // Flip detection across the window: units whose winner changed.
        const wf = window[0], wl = window[window.length - 1];
        const flips = [];
        for (const unitId of Object.keys(uts)) {
          const first = unitVotesAtTurn(uts, wf)[unitId], last = unitVotesAtTurn(uts, wl)[unitId];
          if (!first || !last) continue;
          const fw = rankEv(first)[0], lw = rankEv(last)[0];
          if (fw && lw && fw[0] !== lw[0]) {
            // find the exact turn it flipped
            let flipTurn = wl;
            for (const t of window) { const w = rankEv(unitVotesAtTurn(uts, t)[unitId] || {})[0]; if (w && w[0] === lw[0]) { flipTurn = t; break; } }
            const u = evUnits.find((x) => x.unitId === unitId);
            flips.push({ unit: unitId, ev: u ? u.ev : null, flippedTo: nm(lw[0]), fromLeader: nm(fw[0]), flipTurn });
          }
        }
        flips.sort((a, b) => (b.ev || 0) - (a.ev || 0));
        out.unitFlips = flips;

        // Per-unit vote timelines (forced units, else the detected flips).
        const wanted = (units && units.length ? units : flips.map((f) => f.unit)).map((s) => String(s).toUpperCase());
        const detail = {};
        for (const unitId of Object.keys(uts)) {
          if (!wanted.some((w) => unitId.toUpperCase().includes(w))) continue;
          detail[unitId] = (uts[unitId] || []).slice(-lastTurns).map((s) => {
            const r = rankEv(s.cumulativeVotes || {});
            return { turn: s.turn, leader: r[0] ? `${nm(r[0][0])}=${r[0][1]}` : null, second: r[1] ? `${nm(r[1][0])}=${r[1][1]}` : null };
          });
        }
        if (Object.keys(detail).length) out.unitTimelines = detail;
      } else if (tally.turnSnapshots && tally.turnSnapshots.length) {
        // Non-president: overall vote-share timeline + seat projection.
        out.voteTimeline = tally.turnSnapshots.slice(-lastTurns).map((s) => ({ turn: s.turn, shares: s.sharesPct, seats: s.seatsEstimate || null }));
      }

      return jsonResult(out);
    });

    // ── Shadow-ledger forensics (double-entry conservation checker) ──────────
    // Reads the shadow ledger the game writes when the `ledgerShadow` gameConfig
    // flag is on (off in prod, on in sim): `ledgerReconciliations` (per-turn
    // reconciler verdicts), `ledgerEntries` (balanced 2-leg journal entries),
    // `balanceSnapshots` (per-turn authoritative balances). This is the forensic
    // payoff of the ledger — makes ghost money (t841 FX blowups, phantom
    // credits, ghost-bank carry trades) traceable to the exact unbalanced entry
    // / divergent account / emit site the same turn it happens. Read-only.
    // See ahd-docs engineering/shadow-ledger.md and the game repo
    // docs/plans/2026-07-05-shadow-ledger-plan.md.
    const LEDGER_RECONCILIATIONS = "ledgerReconciliations";
    const LEDGER_ENTRIES = "ledgerEntries";
    const BALANCE_SNAPSHOTS = "balanceSnapshots";

    server.tool("trace_ledger", "Forensic view of the shadow double-entry ledger for a turn: the reconciler verdict (green/amber/red across trial-balance / stock-vs-flow / money-supply checks), the unbalanced journal entries and divergent accounts with their emit sites, and — when an account or entity is given — every ledger journal entry (both legs) touching it. This is how you trace ghost money: an unexplained money-supply residual, an account whose real balance moved with no ledger legs (uninstrumented write), or a t841-class entry that balances in anchor ₳ but not in native currency. Data exists only when the `ledgerShadow` flag is on (sim always, prod when enabled). Give an `account` (canonical id, e.g. 'character:<id>:USD') or an `entity` fragment (a raw character/corp/party/country id — matches any account containing it) to pull the entries touching it.", {
      turn: z.number().int().optional().describe("turn to reconcile (default: latest reconciliation on record). Resolves to the newest reconciliation at or before this turn."),
      account: z.string().optional().describe("canonical ledger account id, e.g. 'character:663...:USD', 'government:US:USD', 'fx:NGN/GBP'"),
      entity: z.string().optional().describe("entity id fragment (character/corp/party/country ObjectId or id) — matches any account containing it; ignored if `account` is set"),
      entryLimit: z.number().int().min(1).max(200).optional().default(50).describe("max journal entries to return when account/entity is given"),
    }, async ({ turn, account, entity, entryLimit }) => {
      const recCol = game.collection(LEDGER_RECONCILIATIONS);
      // Resolve the reconciliation: exact/at-or-before requested turn, else latest.
      const recQuery = typeof turn === "number" ? { turn: { $lte: turn } } : {};
      const rec = await recCol.findOne(recQuery, { sort: { turn: -1 } });
      if (!rec) {
        return jsonResult({
          note: "No shadow-ledger reconciliations found. The `ledgerShadow` flag is likely off for this world (off in prod, on in sim), or the reconciler has not run yet.",
          requestedTurn: turn ?? null,
        });
      }
      const at = rec.turn;

      // Narrow the persisted findings to the account/entity when asked.
      const matchAcc = (acc) => {
        if (!acc) return true;
        if (account) return acc === account;
        if (entity) return acc.includes(entity);
        return true;
      };
      const tb = rec.trialBalance || {};
      const svf = rec.stockVsFlow || {};
      const ms = rec.moneySupply || {};

      const out = {
        world: { requestedTurn: turn ?? null, reconciledTurn: at, generatedAt: rec.generatedAt },
        status: rec.status,
        entriesChecked: rec.entriesChecked,
        checks: {
          trialBalance: {
            status: tb.status, unbalancedCount: tb.unbalancedCount,
            findings: (tb.findings || []).filter((f) => matchAcc(f.emitSite) || (!account && !entity)).slice(0, 50),
          },
          stockVsFlow: {
            status: svf.status, skipped: svf.skipped, divergentCount: svf.divergentCount,
            findings: (svf.findings || []).filter((f) => matchAcc(f.account)).slice(0, 50),
          },
          moneySupply: { status: ms.status, findings: ms.findings || [] },
        },
        unattributed: (rec.unattributed || []).slice(0, 30),
      };

      // Journal entries touching the target account/entity, this turn.
      if (account || entity) {
        const accFilter = account ? account : { $regex: String(entity).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") };
        const entries = await game.collection(LEDGER_ENTRIES)
          .find({ turn: at, "legs.account": accFilter }, {
            projection: { turn: 1, txType: 1, emitSite: 1, balanced: 1, legs: 1, sourceRef: 1, createdAt: 1 },
            sort: { createdAt: 1 }, limit: entryLimit,
          }).toArray();
        out.entries = entries.map((e) => ({
          id: String(e._id), txType: e.txType, emitSite: e.emitSite, balanced: e.balanced,
          anchorResidual: round2((e.legs || []).reduce((a, l) => a + (l.anchorAmount || 0), 0)),
          sourceRef: e.sourceRef ? { collection: e.sourceRef.collection, id: String(e.sourceRef.id) } : undefined,
          legs: (e.legs || []).map((l) => ({ account: l.account, role: l.role, amount: round2(l.amount), currencyCode: l.currencyCode, anchorAmount: round2(l.anchorAmount) })),
        }));
        out.entriesReturned = out.entries.length;

        // Balance-snapshot deltas for the matched accounts (stock side of stock-vs-flow).
        const [snapPrev, snapCur] = await Promise.all([
          game.collection(BALANCE_SNAPSHOTS).findOne({ turn: { $lt: at } }, { sort: { turn: -1 } }),
          game.collection(BALANCE_SNAPSHOTS).findOne({ turn: at }),
        ]);
        if (snapCur && snapCur.balances) {
          const accts = Object.keys(snapCur.balances).filter((a) => matchAcc(a));
          out.balanceDeltas = accts.slice(0, 50).map((a) => ({
            account: a,
            balanceAnchor: round2(snapCur.balances[a]),
            deltaAnchor: round2(snapCur.balances[a] - ((snapPrev && snapPrev.balances && snapPrev.balances[a]) || 0)),
          }));
          if (snapCur.rebaselined) out.snapshotNote = "current snapshot was re-baselined after an admin reseed / era reset — stock-vs-flow is skipped for this turn";
        }
      }

      return jsonResult(out);
    });

    // ── Goal-1 audit spine: actionAuditLog — normalized envelope every instrumented
    // player/system/admin action writes (actor, subject, counterparty, amount, outcome,
    // flags, refs into the heavy domain log). Empty until `gameConfig.auditLog` is on.
    const ACTION_AUDIT_LOG = "actionAuditLog";
    const asId = (v) => (v && ObjectId.isValid(v) ? new ObjectId(v) : v);
    const maskNet = (net) => !net ? undefined : {
      ipMasked: net.ipMasked || (net.ip ? maskIp(net.ip) : undefined),
      ipHash: net.ipHash,
      fingerprint: fpx(net.fingerprint), trackingId: fpx(net.trackingId), deviceKey: fpx(net.deviceKey),
      uaClass: net.uaClass,
    };
    const idStr = (v) => (v == null ? undefined : String(v));
    const maskAuditRow = (r) => ({
      id: String(r._id), ts: r.ts, turn: r.turn, traceId: r.traceId, seq: r.seq,
      source: r.source, phase: r.phase, action: r.action, category: r.category,
      actor: r.actor ? { ...r.actor, userId: idStr(r.actor.userId), characterId: idStr(r.actor.characterId) } : undefined,
      subject: r.subject ? { ...r.subject, id: idStr(r.subject.id) } : undefined,
      counterparty: r.counterparty ? { ...r.counterparty, id: idStr(r.counterparty.id) } : undefined,
      delta: r.delta, amount: r.amount, currencyCode: r.currencyCode, anchorAmount: r.anchorAmount,
      refs: r.refs ? Object.fromEntries(Object.entries(r.refs).map(([k, v]) => [k, idStr(v) ?? v])) : undefined,
      net: maskNet(r.net),
      outcome: r.outcome, reason: r.reason, flags: r.flags, meta: r.meta,
    });

    server.tool("audit_query", "Query the unified action-audit spine (`actionAuditLog`) — the normalized envelope most player/system/admin actions write: actor, subject, counterparty, before/after delta, amount, outcome, anomaly flags, and a `refs` cross-link into the heavy domain log (e.g. financialTxLog) when one exists. Filter by actor (userId/characterId), subject, action (substring, case-insensitive) or category, turn range, time range, outcome, or an anomaly flag stamped by the scanner. Returns masked rows (fingerprint/trackingId/deviceKey truncated; IP already pre-masked at write time), newest first. This collection is EMPTY until `gameConfig.auditLog` is enabled for this world — an empty result means the spine isn't turned on (or nothing matched), not that nothing happened. Pair with trace_actions to expand one row's full causal chain via its traceId. Read-only.", {
      actorUserId: z.string().optional().describe("actor.userId — ObjectId or exact string"),
      actorCharacterId: z.string().optional().describe("actor.characterId"),
      subjectType: z.string().optional().describe("subject.type, e.g. 'character', 'corporation', 'party'"),
      subjectId: z.string().optional().describe("subject.id"),
      action: z.string().optional().describe("action verb substring, case-insensitive, e.g. 'wire' matches wire.send/wire.receive"),
      category: z.enum(["money", "market", "governance", "corp", "party", "election", "auth", "admin", "character", "system"]).optional(),
      turnFrom: z.number().int().optional(), turnTo: z.number().int().optional(),
      tsFrom: z.string().optional().describe("ISO timestamp lower bound"),
      tsTo: z.string().optional().describe("ISO timestamp upper bound"),
      outcome: z.enum(["ok", "rejected", "error"]).optional(),
      flag: z.string().optional().describe("require this anomaly flag present in flags[], e.g. 'rapid_repeat'"),
      flaggedOnly: z.boolean().optional().default(false).describe("only rows with a non-empty flags[]"),
      limit: z.number().int().min(1).max(200).optional().default(50),
    }, async ({ actorUserId, actorCharacterId, subjectType, subjectId, action, category, turnFrom, turnTo, tsFrom, tsTo, outcome, flag, flaggedOnly, limit }) => {
      const q = {};
      if (actorUserId) q["actor.userId"] = asId(actorUserId);
      if (actorCharacterId) q["actor.characterId"] = asId(actorCharacterId);
      if (subjectType) q["subject.type"] = subjectType;
      if (subjectId) q["subject.id"] = asId(subjectId);
      if (action) q.action = new RegExp(reEsc(action), "i");
      if (category) q.category = category;
      if (turnFrom != null || turnTo != null) { q.turn = {}; if (turnFrom != null) q.turn.$gte = turnFrom; if (turnTo != null) q.turn.$lte = turnTo; }
      if (tsFrom || tsTo) { q.ts = {}; if (tsFrom) q.ts.$gte = new Date(tsFrom); if (tsTo) q.ts.$lte = new Date(tsTo); }
      if (outcome) q.outcome = outcome;
      if (flag) q.flags = flag;
      else if (flaggedOnly) q.flags = { $exists: true, $not: { $size: 0 } };
      const rows = await game.collection(ACTION_AUDIT_LOG).find(q).sort({ ts: -1 }).limit(limit).toArray();
      return jsonResult({
        filterApplied: Object.keys(q).length ? q : "(none — full recent spine)",
        count: rows.length, truncated: rows.length === limit,
        rows: rows.map(maskAuditRow),
        note: rows.length === 0 ? "no matching rows — the actionAuditLog spine is empty until gameConfig.auditLog is flipped on for this world, or no action matched these filters." : undefined,
      });
    });

    server.tool("trace_actions", "Given a traceId from the action-audit spine (or from an audit_query row), return every row of that trace IN ORDER (seq asc) — the full causal chain of one API request or turn phase (e.g. a wire transfer's request-level envelope plus every downstream effect it caused). Pairs with audit_query: filter first, then expand a specific row's traceId here to see everything that happened in that same request/phase. Masked, read-only. Empty until `gameConfig.auditLog` is enabled for this world.", {
      traceId: z.string().describe("traceId to expand, e.g. 'turn:1204:corporationTurn' or a request-scoped id copied from an audit_query row"),
      limit: z.number().int().min(1).max(1000).optional().default(300),
    }, async ({ traceId, limit }) => {
      const rows = await game.collection(ACTION_AUDIT_LOG).find({ traceId }).sort({ seq: 1, ts: 1 }).limit(limit).toArray();
      return jsonResult({
        traceId, count: rows.length, truncated: rows.length === limit,
        rows: rows.map(maskAuditRow),
        note: rows.length === 0 ? "no rows for this traceId — either it doesn't exist, the spine is empty (gameConfig.auditLog off for this world), or it's aged out of retention." : undefined,
      });
    });

    server.tool("trace_approval", "Forensic breakdown of a STATE government's approval — the data the raw % hides. Given a state code (e.g. 'NC'), returns: current government approval + recent history (the volatility view), the national approval for context, the sitting governor with policies / personal favorability / per-archetype bill-approval impacts, and EVERY scored metric's state value vs the national average ranked by relative gap (which metrics DRAG vs BOOST approval). Approval scores each metric vs the national mean, electorate-weighted by axis affinity, so the biggest-gap metrics dominate. archetypeApprovals accumulate from enacted-bill impacts — signs inverted vs the governor's party flag the left/right bill-scoring bias. Answers 'why is this governor's approval low — is it a bug or genuinely bad metrics, and would the bill-bias fix move it'. Read-only.", {
      state: z.string().describe("state id / code, e.g. NC"),
      country: z.string().optional().default("US").describe("countryId (default US)"),
    }, async ({ state, country }) => {
      const sid = String(state).toUpperCase();
      const cc = country || "US";
      const gov = await game.collection("characters").findOne(
        { countryId: cc, "currentOffice.type": "governor", "currentOffice.state": sid },
        { projection: { name: 1, party: 1, policies: 1, favorability: 1, politicalInfluence: 1, archetypeApprovals: 1 } });
      const appr = await game.collection("stateApprovalHistory").findOne({ _id: sid })
        || await game.collection("stateApprovalHistory").findOne({ stateId: sid });
      const natl = await game.collection("governmentApprovals").findOne({ _id: cc });
      const CATS = ["economic", "education", "healthcare", "infrastructure", "publicSafety", "environment", "social", "governance", "population", "mediaInformation"];
      const flat = (doc) => {
        const out = {};
        if (!doc) return out;
        for (const cat of CATS) {
          const c = doc[cat];
          if (!c || typeof c !== "object") continue;
          for (const [k, v] of Object.entries(c)) {
            const val = v && typeof v === "object" ? v.value : v;
            if (typeof val === "number" && isFinite(val)) out[k] = val;
          }
        }
        return out;
      };
      const all = await game.collection("stateMetrics").find({ countryId: cc }).toArray();
      const target = all.find((x) => String(x._id).toUpperCase() === sid);
      if (!target) return jsonResult({ error: "no stateMetrics for " + sid + " in " + cc });
      const me = flat(target);
      const flats = all.map(flat);
      // Mirror of the approval SSOT so the ranking reflects TRUE approval
      // contribution, not raw metric noise. Resync if the engine's sets change:
      //   EXCLUDED  = governmentApproval.ts APPROVAL_EXCLUDED_METRICS (derived/
      //               diagnostic readouts that carry no approval term)
      //   LOWER     = metricScoring.ts IS_HIGHER_BETTER === false
      //   AXIS      = metricAxisAffinity.ts (econ +1 = econ-right voters weight it,
      //               social +1 = authoritarian voters weight it)
      const EXCLUDED = new Set(["sexRatio","dependencyRatio","populationGrowth","medianAge","realizedMigrationRate","potentialGrowth","laborForce","sectorGrowth","wageGrowth","tradeGrowth","consumerConfidence","investorConfidence","socialMediaSentiment","beltAndRoadEngagement"]);
      const LOWER = new Set(["unemploymentRate","povertyRate","childPoverty","incomeInequality","homelessnessRate","costOfLiving","regulatoryBurden","debtToGdp","crimeRate","incarcerationRate","foodInsecurity","stateMediaControl","carbonEmissions"]);
      const AXIS = { economicFreedom:{econ:1}, gdpGrowth:{econ:1}, regulatoryBurden:{econ:1}, smallBusinessFormation:{econ:1}, debtToGdp:{econ:1}, costOfLiving:{econ:1}, budgetBalance:{econ:1}, povertyRate:{econ:-1}, childPoverty:{econ:-1}, incomeInequality:{econ:-1}, unemploymentRate:{econ:-1}, homelessnessRate:{econ:-1}, socialMobility:{econ:-1}, nationalPride:{social:1}, militaryReadiness:{social:1}, crimeRate:{social:1}, stateMediaControl:{social:1}, incarcerationRate:{social:1}, civilLiberties:{social:-1}, governmentTransparency:{social:-1}, renewableEnergy:{econ:-1,social:-1} };
      const leanOf = (k) => { const a = AXIS[k]; if (!a) return "universal"; const e = a.econ||0, s = a.social||0; return [e>0?"econ-right":e<0?"econ-left":null, s>0?"auth":s<0?"lib":null].filter(Boolean).join("+") || "universal"; };
      const rows = Object.keys(me).filter((k) => !EXCLUDED.has(k)).map((k) => {
        const vs = flats.map((f) => f[k]).filter((v) => typeof v === "number");
        const a = vs.length ? vs.reduce((x, y) => x + y, 0) / vs.length : null;
        const gap = typeof a === "number" ? me[k] - a : null;                 // raw diff vs national
        const dir = LOWER.has(k) ? -1 : 1;                                     // higher-better sign
        const contribution = gap != null ? dir * gap : 0;                     // >0 boosts approval
        const rel = gap != null && a ? (dir * gap) / Math.abs(a) : contribution;
        return { metric: k, state: round2(me[k]), natAvg: round2(a), vsNational: round2(gap), contribution: round2(contribution), relContribution: round2(rel), electorate: leanOf(k) };
      }).sort((x, y) => Math.abs(y.relContribution) - Math.abs(x.relContribution));
      const drags = rows.filter((r) => r.contribution < 0).slice(0, 8);
      const boosts = rows.filter((r) => r.contribution > 0).slice(0, 8);
      return jsonResult({
        state: sid,
        country: cc,
        approval: appr ? { current: appr.approvalRating, recentHistory: (appr.history || []).slice(-8) } : null,
        nationalApproval: natl ? natl.approvalRating : null,
        governor: gov ? { name: gov.name, partyId: gov.party, policies: gov.policies, favorability: gov.favorability, politicalInfluence: round2(gov.politicalInfluence), archetypeApprovals: gov.archetypeApprovals } : null,
        topDrags: drags,
        topBoosts: boosts,
        note: "approval = 50 + electorate-weighted mean of each metric's contribution vs national average (there is NO base ideological-alignment term — matching the national average scores 50). contribution>0 boosts, <0 drags; 'electorate' = which voters axis-weight it. archetypeApprovals accumulate from enacted-bill impacts (no decay); signs inverted vs the governor's party = the bill-scoring bias.",
      });
    });

    server.tool("trace_race", "Forensic view of an ACTIVE (or resolved) election's vote trajectory — the standing the raw poll % hides, and what trace_election (resolved-president-only) can't give. Given an election id (or electionType + state), returns per candidate the CUMULATIVE votes + true standing/gap, AND the per-turn MARGINAL share and volume so you can see momentum and the election-day SURGE (final turns routinely cast 10-20x the volume of early turns). Also turns elapsed/remaining vs endTurn. Use this before judging who's winning or whether a race is winnable: the snapshot 'sharesPct' is the volatile MARGINAL share, not the cumulative standing — reading it as cumulative is a classic error. Read-only.", {
      election: z.string().describe("election ObjectId, or an electionType keyword like 'governor'/'senate'/'house'"),
      state: z.string().optional().describe("state code when resolving by type, e.g. NC"),
      country: z.string().optional().default("US"),
    }, async ({ election, state, country }) => {
      let el = null;
      if (ObjectId.isValid(election)) el = await game.collection("elections").findOne({ _id: new ObjectId(election) });
      if (!el) {
        const q = { countryId: country || "US", electionType: new RegExp(String(election), "i") };
        if (state) q.state = String(state).toUpperCase();
        el = await game.collection("elections").findOne(q, { sort: { status: 1, endTurn: -1 } })
          || await game.collection("elections").findOne(q, { sort: { endTurn: -1 } });
      }
      if (!el) return jsonResult({ error: "election not found: " + election });
      const tally = await game.collection("electionVoteTallies").findOne({ electionId: el._id })
        || await game.collection("electionVoteTallies").findOne({ electionId: String(el._id) });
      if (!tally) return jsonResult({ election: { id: String(el._id), type: el.electionType, state: el.state, status: el.status }, note: "no vote tally yet" });
      const now = await currentTurn();
      const ids = Object.keys(tally.candidateNames || {});
      const snaps = tally.turnSnapshots || [];
      const total = (s) => ids.reduce((a, id) => a + (s.cumulativeVotes?.[id] ?? 0), 0);
      // per-turn marginal series (last 10)
      const series = snaps.slice(-10).map((s, i, arr) => {
        const prev = i > 0 ? arr[i - 1] : null;
        const vol = prev ? total(s) - total(prev) : total(s);
        const marg = {};
        for (const id of ids) {
          const mv = prev ? (s.cumulativeVotes?.[id] ?? 0) - (prev.cumulativeVotes?.[id] ?? 0) : (s.cumulativeVotes?.[id] ?? 0);
          marg[tally.candidateNames[id]] = vol > 0 ? round2((mv / vol) * 100) : 0;
        }
        return { turn: s.turn, turnVotes: vol, marginalSharePct: marg };
      });
      // current cumulative standing
      const last = snaps[snaps.length - 1];
      const cumTotal = last ? total(last) : 0;
      const standing = ids.map((id) => ({
        name: tally.candidateNames[id],
        party: tally.candidateParties?.[id],
        votes: last?.cumulativeVotes?.[id] ?? 0,
        cumulativeSharePct: cumTotal > 0 ? round2(((last?.cumulativeVotes?.[id] ?? 0) / cumTotal) * 100) : 0,
      })).sort((a, b) => b.votes - a.votes);
      const gap = standing.length >= 2 ? standing[0].votes - standing[1].votes : null;
      // surge detection: recent turn volume vs the pre-surge median
      const vols = series.map((r) => r.turnVotes).filter((v) => v > 0);
      const recentVol = vols.length ? vols[vols.length - 1] : 0;
      const medVol = vols.length ? [...vols].sort((a, b) => a - b)[Math.floor(vols.length / 2)] : 0;
      return jsonResult({
        election: { id: String(el._id), type: el.electionType, state: el.state, status: el.status, endTurn: el.endTurn, finalized: !!tally.finalized },
        currentTurn: now,
        turnsRemaining: el.endTurn != null ? Math.max(0, el.endTurn - now) : null,
        standing,
        leaderGapVotes: gap,
        surge: { recentTurnVotes: recentVol, medianTurnVotes: medVol, surgeFactor: medVol > 0 ? round2(recentVol / medVol) : null },
        perTurn: series,
        note: "standing = CUMULATIVE (the real result-so-far); perTurn.marginalSharePct = that turn's share only (volatile). Late-turn surge (surgeFactor >> 1) means most votes are cast at the end — a small cumulative gap is very live; a large one with few turns left is not. Vote share is driven by policy-distance appeal ~50x more than favorability/incumbency (see ops-knowledge ahd-vote-approval-persuasion-mechanics).",
      });
    });

    server.tool("election_sim_results", "Latest results from the READ-ONLY election vote-model A/B/C/D simulation series (the harness that replays every reconstructable race under proposed re-weights). Returns the calibration gate (Model A must reproduce stored winners, else results are untrustworthy), and every tested variant ranked by a composite score across five rubric dimensions: fixesCase (does the NC/Steinman motivating race resolve to the incumbent), realism (incumbency rate moves toward the real-world ~90% from the game's baseline), disruption (fewer winner-flips vs the live engine = better), plus two design-judgment dimensions (calibration-integrity, legibility) scored per proposal family. Families: baseline (live engine), P1-strengthen (widen existing quality multipliers), P2-soften (lower the squared appeal exponent γ), P3-utility (full weighted-utility rework → softmax), combined. Use this to answer 'which vote-model change best fixes popular-incumbent-loses without over-disrupting' — the numbers behind the ship/no-ship call. Read-only; reads the harness JSON, does not run the sim.", {
      family: z.enum(["baseline", "P0-favblend", "P1-strengthen", "P2-soften", "P3-utility", "combined"]).optional().describe("filter to one proposal family"),
      variant: z.string().optional().describe("return full detail for a single variant id, e.g. util_p40q40pa10s10"),
      limit: z.number().int().min(1).max(40).optional().default(12).describe("max variants to return (ranked best-first)"),
    }, async ({ family, variant, limit }) => {
      const fs = require("fs");
      const path = require("path");
      const dir = process.env.ELECTION_SIM_DIR || "/root/ahd-ab-harness/docs/election-sim";
      let raw = null, srcFile = null;
      const latest = path.join(dir, "series-latest.json");
      try {
        if (fs.existsSync(latest)) { raw = fs.readFileSync(latest, "utf8"); srcFile = latest; }
        else {
          const files = fs.readdirSync(dir).filter((f) => /^series-.*\.json$/.test(f)).sort();
          if (files.length) { srcFile = path.join(dir, files[files.length - 1]); raw = fs.readFileSync(srcFile, "utf8"); }
        }
      } catch (e) { return jsonResult({ error: "could not read series results: " + e.message, dir }); }
      if (!raw) return jsonResult({ error: "no series results found. Run the harness (scripts/election-ab-sim.ts --exhaustive) first.", dir });
      let series; try { series = JSON.parse(raw); } catch (e) { return jsonResult({ error: "series JSON parse error: " + e.message, srcFile }); }

      // Design-judgment sub-scores (0-3) per family — the two dimensions the harness can't measure.
      const DESIGN = {
        "baseline":       { legibility: 1, calibrationIntegrity: 3 },
        "P0-favblend":    { legibility: 2, calibrationIntegrity: 2 },
        "P1-strengthen":  { legibility: 2, calibrationIntegrity: 2 },
        "P2-soften":      { legibility: 3, calibrationIntegrity: 2 },
        "P3-utility":     { legibility: 3, calibrationIntegrity: 2 },
        "combined":       { legibility: 1, calibrationIntegrity: 2 },
      };
      const gate = series.calibration && series.calibration.trustworthy;
      let variants = (series.variants || []).map((v) => {
        const d = DESIGN[v.family] || { legibility: 2, calibrationIntegrity: 2 };
        // P3 anchor split reproduces Model A closely → give it full calibration integrity.
        const anchor = v.family === "P3-utility" && /p85q10/.test(v.id);
        const design = { legibility: d.legibility, calibrationIntegrity: anchor ? 3 : d.calibrationIntegrity };
        const s = v.scores || { fixesCase: 0, realism: 0, disruption: 0 };
        const composite = s.fixesCase + s.realism + s.disruption + design.legibility + design.calibrationIntegrity;
        return { ...v, design, composite };
      });
      if (family) variants = variants.filter((v) => v.family === family);
      variants.sort((a, b) => b.composite - a.composite);

      if (variant) {
        const one = (series.variants || []).find((v) => v.id === variant);
        if (!one) return jsonResult({ error: "variant not found: " + variant, available: (series.variants || []).map((v) => v.id) });
        const ranked = variants.find((v) => v.id === variant);
        return jsonResult({ meta: series.meta, calibrationGate: gate, variant: ranked || one });
      }

      return jsonResult({
        meta: series.meta,
        calibration: series.calibration,
        calibrationGate: gate ? "PASS — results trustworthy" : "FAIL — Model A does not reproduce stored winners; treat results as diagnostic only",
        rubric: "composite (max 15) = fixesCase + realism + disruption + legibility + calibrationIntegrity, each 0-3. fixesCase/realism/disruption are measured; legibility/calibrationIntegrity are per-family design calls.",
        srcFile,
        variantCount: variants.length,
        rankedVariants: variants.slice(0, limit),
        note: gate ? "Composite ranks by overall fit, but this is a VALUES call, not an optimizer: a high-realism/high-fix variant may also be high-disruption. Always read the counterfactual — 'ship none' is legitimate if the live model's competitiveness is intended." : "Calibration gate FAILED — do not act on the ranking; the harness reconstruction did not match the live engine on this corpus.",
      });
    });

    return server;
  }

  createServer({
    name: "gamestate-mcp", version: "1.0.0", port: PORT, bind: "0.0.0.0",
    authorize: req => tokens.validate(db, req.headers.authorization), buildServer,
  });
}
function jsonResult(o) { return { content: [{ type: "text", text: JSON.stringify(o, null, 2) }] }; }
function round2(n) { return typeof n === "number" && isFinite(n) ? Math.round(n * 100) / 100 : n; }
function rpcErr(code, message) { return { jsonrpc: "2.0", error: { code, message }, id: null }; }
main().catch((e) => { console.error("[gamestate-mcp] fatal:", e); process.exit(1); });
