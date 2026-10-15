// extraction-audit.js — per-state extraction capacity / adoption audit for the
// remediation plan (docs/plans/2026-07-04-extraction-capacity-remediation.md).
// Capacity is enforced PER STATE, so this classifies each (resource, state) as
// re-strategize / place / bump, and rolls up the fix targeting per resource.
//
// Usage as a module: computeExtractionAudit(db) -> Promise<audit>
// Usage as a CLI:     MONGODB_URI=... node extraction-audit.js [--json]
const { MongoClient } = require("mongodb");

const BASE = { copper: 9000, rare_earth: 50000, iron: 120, coal: 150, oil: 80, natural_gas: 25, timber: 400 };
const RES = Object.keys(BASE);
// standard broad-mix supply rates
const STD = { iron: 0.4, coal: 0.3, oil: 0.14, rare_earth: 0.12, copper: 0.15, natural_gas: 0.24, timber: 0.2 };
// focused mining strategies and their (approx) rates
const FOCUS = {
  copper_mining: { copper: 0.72 }, rare_earth_mining: { rare_earth: 0.72 }, iron_mining: { iron: 0.72 },
  coal_mining: { coal: 0.72 }, oil_gas: { oil: 0.5, natural_gas: 0.4 }, fracking: { oil: 0.5, natural_gas: 0.4 },
  timber_logging: { timber: 0.72 },
};
const FOCUS_FOR = { copper: "copper_mining", rare_earth: "rare_earth_mining", iron: "iron_mining", coal: "coal_mining", oil: "oil_gas", natural_gas: "oil_gas", timber: "timber_logging" };
const SHORTAGE = 0.6; // S/D below this = shortage worth targeting
const HAIRCUT_FLOOR = 0.5;

async function computeExtractionAudit(db) {
  const gs = await db.collection("gameState").findOne({}, { projection: { currentTurn: 1 } });
  const now = gs?.currentTurn ?? 0;

  const caps = await db.collection("stateResourceCapacity").find({}).project({ stateId: 1, resources: 1 }).toArray();
  const capByState = new Map(caps.map((d) => [d.stateId, d.resources || {}]));

  const prices = await db.collection("commodityPrices").find({ commodity: { $in: RES } }).project({ commodity: 1, globalSupply: 1, globalDemand: 1 }).toArray();
  const sd = {};
  for (const p of prices) sd[p.commodity] = { supply: p.globalSupply || 0, demand: p.globalDemand || 0, sd: p.globalDemand > 0 ? p.globalSupply / p.globalDemand : null };

  const ex = await db.collection("corporateSectors").find({ sectorType: "extraction" }).project({ revenue: 1, stateId: 1, strategyId: 1, capacityUtilization: 1, capacityHaircutStartTurn: 1 }).toArray();

  // summary: utilization + haircut exposure
  let revTot = 0, wUtil = 0, wHaircut = 0, wFull = 0, bound = 0;
  for (const s of ex) {
    const rev = Number.isFinite(s.revenue) ? s.revenue : 0; revTot += rev;
    const util = typeof s.capacityUtilization === "number" ? s.capacityUtilization : 1;
    wUtil += util * rev; wFull += Math.max(HAIRCUT_FLOOR, util) * rev;
    if (util < 0.9) bound++;
    let f = 1;
    if (util < 1 && s.capacityHaircutStartTurn != null) { const prog = Math.min(1, (now - s.capacityHaircutStartTurn) / 240); f = 1 - prog * (1 - util); }
    wHaircut += f * rev;
  }

  const corps = await db.collection("corporations").find({ type: "extraction" }).project({ liquidCapital: 1, name: 1 }).toArray();
  const insolvent = corps.filter((c) => (c.liquidCapital ?? 0) < 0).map((c) => c.name);

  // per-resource, per-state
  const perResource = RES.map((res) => {
    // desired output + standard-miner count per state for this resource
    const byState = new Map();
    for (const s of ex) {
      const rates = FOCUS[s.strategyId] || STD;
      const rate = rates[res] || 0;
      if (rate <= 0) continue;
      const st = s.stateId;
      if (!byState.has(st)) byState.set(st, { desired: 0, miners: 0, standardMiners: 0 });
      const e = byState.get(st);
      e.desired += ((s.revenue || 0) * rate) / BASE[res];
      e.miners++;
      if (!s.strategyId || s.strategyId === "standard") e.standardMiners++;
    }
    const restrategize = [], place = [], bump = [];
    let reachCap = 0, idleCap = 0, supplied = 0, statesHit = 0, statesHeadroom = 0, statesIdle = 0;
    for (const [st, rs] of capByState) {
      const cap = rs[res] || 0; if (cap <= 0) continue;
      const e = byState.get(st);
      if (!e || e.desired <= 0) { idleCap += cap; statesIdle++; place.push({ state: st, cap: Math.round(cap) }); continue; }
      reachCap += cap; supplied += Math.min(e.desired, cap);
      if (e.desired > cap * 1.02) { statesHit++; bump.push({ state: st, cap: Math.round(cap), desired: Math.round(e.desired), shortfall: Math.round(e.desired - cap), miners: e.miners }); }
      else { statesHeadroom++; if (e.standardMiners > 0) restrategize.push({ state: st, cap: Math.round(cap), desired: Math.round(e.desired), headroom: Math.round(cap - e.desired), standardMiners: e.standardMiners }); }
    }
    const isShort = sd[res]?.sd != null && sd[res].sd < SHORTAGE;
    const verdict = !isShort ? "ok" : statesHit > statesHeadroom + statesIdle ? "bump-capacity" : idleCap > reachCap ? "place-sectors" : "re-strategize";
    return {
      resource: res, ...sd[res],
      reachableCap: Math.round(reachCap), idleCap: Math.round(idleCap), idlePct: reachCap + idleCap > 0 ? Math.round((100 * idleCap) / (reachCap + idleCap)) : 0,
      suppliedFromReachable: Math.round(supplied), reachableUtilPct: reachCap > 0 ? Math.round((100 * supplied) / reachCap) : 0,
      statesHit, statesHeadroom, statesIdle, shortage: isShort, verdict,
      targeting: {
        restrategize: restrategize.sort((a, b) => b.headroom - a.headroom).slice(0, 8),
        place: place.sort((a, b) => b.cap - a.cap).slice(0, 8),
        bump: bump.sort((a, b) => b.shortfall - a.shortfall).slice(0, 8),
      },
    };
  });

  return {
    generatedAt: new Date().toISOString(), currentTurn: now,
    summary: {
      sectors: ex.length, capacityBound: bound, capacityBoundPct: Math.round((100 * bound) / ex.length),
      revWeightedUtil: revTot ? +(wUtil / revTot).toFixed(3) : null,
      currentHaircutFactor: revTot ? +(wHaircut / revTot).toFixed(3) : null,
      flooredHaircutFactor: revTot ? +(wFull / revTot).toFixed(3) : null,
      insolventCorps: insolvent, insolventCount: insolvent.length,
    },
    perResource,
  };
}

module.exports = { computeExtractionAudit };

// CLI
if (require.main === module) {
  (async () => {
    let uri = process.env.MONGODB_URI;
    if (!uri) {
      try {
        const fs = require("fs");
        const path = require("path");
        const { primaryRepoDir } = require("./src/core/paths");
        const envLocal = path.join(primaryRepoDir() || "", ".env.local");
        for (const l of fs.readFileSync(envLocal, "utf8").split("\n")) {
          const m = l.match(/^MONGODB_URI=(.*)$/); if (m && !m[1].includes("localhost")) { uri = m[1].trim(); break; }
        }
      } catch {}
    }
    if (!uri) { console.error("no MONGODB_URI"); process.exit(1); }
    if (!uri.includes("directConnection")) uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";
    const c = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
    await c.connect();
    const audit = await computeExtractionAudit(c.db("a-house-divided"));
    if (process.argv.includes("--json")) { console.log(JSON.stringify(audit, null, 2)); await c.close(); return; }
    const s = audit.summary;
    console.log(`\n== Extraction Capacity Audit — turn ${audit.currentTurn} ==`);
    console.log(`sectors ${s.sectors} · capacity-bound ${s.capacityBoundPct}% · rev-wtd util ${s.revWeightedUtil}`);
    console.log(`haircut now ${s.currentHaircutFactor} (${((s.currentHaircutFactor - 1) * 100).toFixed(0)}%) → full-ramp floored ${s.flooredHaircutFactor} vs unfloored ${s.revWeightedUtil}`);
    console.log(`insolvent extraction corps: ${s.insolventCount} ${s.insolventCorps.length ? "(" + s.insolventCorps.join(", ") + ")" : ""}`);
    console.log(`\nresource      S/D   reachUtil  idle%  verdict          restrat/place/bump states`);
    for (const r of audit.perResource) {
      console.log(
        r.resource.padEnd(12) + String(r.sd != null ? r.sd.toFixed(2) : "-").padStart(5) +
        String(r.reachableUtilPct + "%").padStart(10) + String(r.idlePct + "%").padStart(7) + "  " +
        r.verdict.padEnd(16) + `${r.targeting.restrategize.length}/${r.targeting.place.length}/${r.targeting.bump.length}`
      );
    }
    await c.close();
  })().catch((e) => { console.error("ERR", e.message); process.exit(1); });
}
