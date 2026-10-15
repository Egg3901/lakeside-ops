/**
 * Lean Lab runner — executed via the GAME repo's tsx so it can import the
 * live seed + election-kernel modules. Invoked by lean-lab-server.js:
 *
 *   <repoDir>/node_modules/.bin/tsx --tsconfig <repoDir>/tsconfig.json mcp/lean-lab-runner.ts '<json>'
 *
 * argv[2] JSON: { cmd, repoDir, ...cmd-specific }. Prints one JSON doc to
 * stdout. Every electoral number here reproduces the REAL general-election
 * math: cell leans from deriveGranularElectorateUnits (era positions + state
 * overrides + census), candidate appeal from calcAppeal at the party poles,
 * structural multipliers from orgVoteWeight (share^0.2) and
 * regResistanceMultiplier (1 + 0.3*reg/100). "realized" shares are the
 * static-kernel two-way split — they overstate live-sim margins by roughly
 * 2x (candidates, favorability, support and coattails damp them) but rank
 * and compare states faithfully.
 */
import * as path from "path";
import * as fs from "fs";

type Json = Record<string, any>;

const args: Json = JSON.parse(process.argv[2] || "{}");
const repoDir: string = args.repoDir;
if (!repoDir) throw new Error("repoDir required");
const R = (p: string) => import(path.join(repoDir, p));

const US_STATES_51 = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "DC",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
];
const US_STATES_48_1953 = US_STATES_51.filter(
  (state) => !["AK", "HI", "DC"].includes(state),
);
const UK_REGIONS = [
  "LON",
  "SEE",
  "SWE",
  "EAE",
  "EMI",
  "WMI",
  "YHU",
  "NWE",
  "NEE",
  "SCO",
  "WAL",
  "NIR",
];
const RU_REGIONS = [
  "CEN",
  "NWR",
  "NOR",
  "CBE",
  "VOL",
  "NCA",
  "URA",
  "WSB",
  "ESB",
  "FEA",
  "KAZ",
  "TRA",
  "CAS",
  "MOL",
];
const DD_REGIONS = ["BEO", "MV", "BB", "ST", "SN", "TH"];

/** Left/Right party poles per country (candidate positions for the kernel). */
const PARTY_POLES: Record<
  string,
  { L: [number, number]; R: [number, number] }
> = {
  US: { L: [-2, -2], R: [2, 2] },
  UK: { L: [-2, -3], R: [2, 2] },
};

async function loadKernel() {
  const [ge, ap, ff] = await Promise.all([
    R("src/lib/demographics/granularElectorate.ts"),
    R("src/lib/utils/demographicAppeal.ts"),
    R("src/lib/electionEngine/electionFormulaFactors.ts"),
  ]);
  return {
    derive: ge.deriveGranularElectorateUnits,
    clear: ge.clearGranularElectorateCache,
    calcAppeal: ap.calcAppeal,
    orgVoteWeight: ff.orgVoteWeight,
    regResistance: ff.regResistanceMultiplier,
  };
}

/** Per-state {L: {org, reg}, R: {org, reg}} for the structural multipliers. */
async function loadOrgReg(
  country: string,
  era: string,
): Promise<Map<string, Json>> {
  const out = new Map<string, Json>();
  if (country === "US") {
    // Mirror selectSeedBundle in seedRegistrationLanes.ts: every era has its
    // own curated builder; only 2019/empty use the base lanes.
    let seeds: any[] = [];
    const eraBuilder: Record<string, [string, string]> = {
      "1953": [
        "src/lib/seeds/registration/registrationLanes1953.ts",
        "build1953RegistrationSeeds",
      ],
      "1979": [
        "src/lib/seeds/registration/registrationLanes1979.ts",
        "build1979RegistrationSeeds",
      ],
      "1991": [
        "src/lib/seeds/registration/registrationLanes1991.ts",
        "build1991RegistrationSeeds",
      ],
      "1999": [
        "src/lib/seeds/registration/registrationLanes1999.ts",
        "build1999RegistrationSeeds",
      ],
      "2007": [
        "src/lib/seeds/registration/registrationLanes2007.ts",
        "build2007RegistrationSeeds",
      ],
    };
    if (eraBuilder[era]) {
      const [file, fn] = eraBuilder[era];
      seeds = (await R(file))[fn]();
    } else
      seeds = (await R("src/lib/seeds/registration/registrationLanes.ts"))
        .buildAllRegistrationSeeds()
        .filter((s: any) => s.countryId === "US");
    for (const s of seeds) {
      const d = s.parties.find((p: any) => p.abbr === "DEM");
      const r = s.parties.find((p: any) => p.abbr === "REP");
      if (d && r)
        out.set(s.stateId, {
          L: { org: d.org, reg: d.reg },
          R: { org: r.org, reg: r.reg },
        });
    }
  } else if (country === "UK") {
    if (era === "1953") {
      const seeds = (
        await R("src/lib/seeds/registration/registrationLanes1953.ts")
      )
        .build1953RegistrationSeeds()
        .filter((seed: any) => seed.countryId === "UK");
      for (const seed of seeds) {
        const labour = seed.parties.find((party: any) => party.abbr === "LAB");
        const conservative = seed.parties.find(
          (party: any) => party.abbr === "CON",
        );
        if (labour && conservative) {
          out.set(seed.stateId, {
            L: { org: labour.org, reg: labour.reg },
            R: { org: conservative.org, reg: conservative.reg },
          });
        }
      }
      return out;
    }
    const mod =
      era === "1979" || era === "1991"
        ? await R("src/lib/seeds/uk/ukRegionPolling1992.ts")
        : await R("src/lib/seeds/uk/ukRegionPolling2020.ts");
    const table: Record<string, Record<string, number>> = Object.values(
      mod,
    )[0] as any;
    for (const [region, votes] of Object.entries(table)) {
      out.set(region, {
        L: { org: votes["uk_labour"] ?? 0, reg: votes["uk_labour"] ?? 0 },
        R: {
          org: votes["uk_conservative"] ?? 0,
          reg: votes["uk_conservative"] ?? 0,
        },
      });
    }
  }
  return out; // other countries: empty map -> neutral structure
}

interface StateNumbers {
  state: string;
  meanEcon: number;
  meanSocial: number;
  appealShareL?: number; // two-way Left share, electorate alone
  realizedShareL?: number; // two-way Left share incl. org/reg multipliers
  org?: { L: number; R: number };
  reg?: { L: number; R: number };
}

async function stateNumbers(
  k: Awaited<ReturnType<typeof loadKernel>>,
  country: string,
  state: string,
  preset: string,
  orgReg: Map<string, Json>,
): Promise<StateNumbers | null> {
  k.clear();
  const d = k.derive(country, state, preset, null);
  if (!d) return null;
  const poles = PARTY_POLES[country];
  const s = orgReg.get(state);
  const orgMap = new Map<string, number>(
    s
      ? [
          ["L", s.L.org],
          ["R", s.R.org],
        ]
      : [],
  );
  const oL = s ? k.orgVoteWeight(orgMap, "L") : 1;
  const oR = s ? k.orgVoteWeight(orgMap, "R") : 1;
  const rL = s ? k.regResistance(s.L.reg) : 1;
  const rR = s ? k.regResistance(s.R.reg) : 1;
  let ne = 0,
    ns = 0,
    den = 0,
    aOnly = 0,
    real = 0,
    pool = 0;
  for (const u of d.units) {
    const w = u.share * u.turnout;
    ne += w * u.economicLean;
    ns += w * u.socialLean;
    den += w;
    if (!poles) continue;
    const aL = k.calcAppeal(
      u.economicLean,
      u.socialLean,
      poles.L[0],
      poles.L[1],
      0,
      false,
      poles.L[0],
      poles.L[1],
    );
    const aR = k.calcAppeal(
      u.economicLean,
      u.socialLean,
      poles.R[0],
      poles.R[1],
      0,
      false,
      poles.R[0],
      poles.R[1],
    );
    if (aL + aR > 0) {
      aOnly += (w * aL) / (aL + aR);
      const wL = aL * oL * rL,
        wR = aR * oR * rR;
      real += (w * wL) / (wL + wR);
      pool += w;
    }
  }
  if (!den || (poles && !pool)) return null;
  const rnd = (v: number) => Math.round(v * 1000) / 1000;
  return {
    state,
    meanEcon: rnd(ne / den),
    meanSocial: rnd(ns / den),
    ...(poles
      ? { appealShareL: rnd(aOnly / pool), realizedShareL: rnd(real / pool) }
      : {}),
    ...(s
      ? { org: { L: s.L.org, R: s.R.org }, reg: { L: s.L.reg, R: s.R.reg } }
      : {}),
  };
}

function statesFor(
  country: string,
  requested: string[] | undefined,
  era: string,
): string[] {
  if (requested?.length) return requested;
  if (country === "US")
    return era === "1953" ? US_STATES_48_1953 : US_STATES_51;
  if (country === "UK") return UK_REGIONS;
  if (country === "RU") return RU_REGIONS;
  if (country === "DD") return DD_REGIONS;
  return [];
}

async function cmdOverview(): Promise<Json> {
  const { country, era } = args;
  const preset = `${era}-default`;
  const k = await loadKernel();
  const orgReg = await loadOrgReg(country, era);
  const rows: StateNumbers[] = [];
  for (const st of statesFor(country, args.states, era)) {
    const n = await stateNumbers(k, country, st, preset, orgReg);
    if (n) rows.push(n);
  }
  const projectionSupported = !!PARTY_POLES[country];
  rows.sort((a, b) =>
    projectionSupported
      ? (a.realizedShareL ?? 0) - (b.realizedShareL ?? 0)
      : a.meanEcon - b.meanEcon,
  );
  const mean = (f: (r: StateNumbers) => number) =>
    rows.reduce((s, r) => s + f(r), 0) / (rows.length || 1);
  const leftWins = rows.filter((r) => (r.realizedShareL ?? 0) > 0.5).length;
  const competitive = rows.filter(
    (r) => (r.realizedShareL ?? 0) >= 0.45 && (r.realizedShareL ?? 0) <= 0.55,
  ).length;
  const leftOrgLead = rows.filter(
    (r) => r.org && r.org.L > r.org.R && r.reg!.L > r.reg!.R,
  ).length;
  const rightOrgLead = rows.filter(
    (r) => r.org && r.org.R > r.org.L && r.reg!.R > r.reg!.L,
  ).length;
  return {
    country,
    era,
    states: rows.length,
    aggregates: {
      meanEcon: Math.round(mean((r) => r.meanEcon) * 1000) / 1000,
      meanSocial: Math.round(mean((r) => r.meanSocial) * 1000) / 1000,
      ...(projectionSupported
        ? {
            meanRealizedShareL:
              Math.round(mean((r) => r.realizedShareL ?? 0) * 1000) / 1000,
            leftWins,
            rightWins: rows.length - leftWins,
            competitiveBand45to55: competitive,
            leftOrgRegLead: leftOrgLead,
            rightOrgRegLead: rightOrgLead,
          }
        : {}),
    },
    note: projectionSupported
      ? "realizedShareL is a static two-party kernel share for US/UK ranking and comparison."
      : "RU/DD are non-competitive systems in 1953. Mean leans are reported, but a fictional US-style two-party share is intentionally omitted.",
    rows,
  };
}

async function cmdState(): Promise<Json> {
  const { country, state, era } = args;
  const preset = `${era}-default`;
  const k = await loadKernel();
  const [{ getRegionCensusData }, { getEraPositions }] = await Promise.all([
    R("src/lib/seeds/regionCensusData.ts"),
    R("src/lib/seeds/demographicCategories.ts"),
  ]);
  const orgReg = await loadOrgReg(country, era);
  const numbers = await stateNumbers(k, country, state, preset, orgReg);
  const config = getRegionCensusData(country, state, preset);
  const merged = country === "US" ? getEraPositions(era, state) : null;
  k.clear();
  const d = k.derive(country, state, preset, null);
  const cells = (d?.units ?? [])
    .map((u: any) => ({
      ...u,
      pool: Math.round(u.share * u.turnout * 1000) / 1000,
    }))
    .sort((a: any, b: any) => b.pool - a.pool)
    .slice(0, args.topCells ?? 15);
  return {
    country,
    state,
    era,
    numbers,
    mergedPositions: merged, // era base + STATE_POSITION_OVERRIDES (US only)
    censusPositionsBlock: config?.positions ?? null, // census-level per-state override (wins over merged)
    censusMarginals: config
      ? Object.fromEntries(
          Object.entries(config).filter(([k2]) => k2 !== "positions"),
        )
      : null,
    topCells: cells,
  };
}

async function cmdWhatif(): Promise<Json> {
  const { country, state, era, positions, org, reg } = args;
  const preset = `${era}-default`;
  const k = await loadKernel();
  const { getRegionCensusData } = await R("src/lib/seeds/regionCensusData.ts");
  const orgReg = await loadOrgReg(country, era);
  const before = await stateNumbers(k, country, state, preset, orgReg);
  const config = getRegionCensusData(country, state, preset) as Json | null;
  if (!config)
    throw new Error(`no census config for ${country}/${state}/${preset}`);
  const savedPositions = config.positions;
  if (positions) {
    // { race: { white: { economicLean, socialLean } }, ... } — merged over any existing block
    config.positions = { ...(savedPositions ?? {}) };
    for (const [dim, buckets] of Object.entries(positions as Json)) {
      config.positions[dim] = {
        ...(config.positions[dim] ?? {}),
        ...(buckets as Json),
      };
    }
  }
  if (org || reg) {
    const cur = orgReg.get(state) ?? {
      L: { org: 1, reg: 0 },
      R: { org: 1, reg: 0 },
    };
    orgReg.set(state, {
      L: { org: org?.L ?? cur.L.org, reg: reg?.L ?? cur.L.reg },
      R: { org: org?.R ?? cur.R.org, reg: reg?.R ?? cur.R.reg },
    });
  }
  const after = await stateNumbers(k, country, state, preset, orgReg);
  config.positions = savedPositions; // restore in-memory state
  return { country, state, era, before, after };
}

async function cmdSolve(): Promise<Json> {
  const {
    country,
    era,
    targets,
    dim = "race",
    bucket = "white",
    socialTrack = 0.6,
  } = args;
  const preset = `${era}-default`;
  const k = await loadKernel();
  const [{ getRegionCensusData }, { getEraPositions }] = await Promise.all([
    R("src/lib/seeds/regionCensusData.ts"),
    R("src/lib/seeds/demographicCategories.ts"),
  ]);
  const clampV = (v: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, v));
  const solved: Json = {};
  const report: Json[] = [];
  for (const [state, targetMean] of Object.entries(
    targets as Record<string, number>,
  )) {
    const config = getRegionCensusData(country, state, preset) as Json | null;
    if (!config?.[dim]) {
      report.push({ state, error: "no census" });
      continue;
    }
    const authored =
      country === "US" ? getEraPositions(era, state)?.[dim]?.[bucket] : null;
    const startE = authored?.economicLean ?? 0;
    const startS = authored?.socialLean ?? 0;
    const saved = config.positions;
    const setB = (e: number) => {
      config.positions = {
        ...(saved ?? {}),
        [dim]: {
          ...((saved ?? {})[dim] ?? {}),
          [bucket]: {
            economicLean: clampV(e, -4.5, 4.5),
            socialLean: clampV(startS + socialTrack * (e - startE), -4.5, 4.5),
          },
        },
      };
    };
    let lo = -4.5,
      hi = 4.5,
      e = 0,
      got = 0;
    for (let i = 0; i < 26; i++) {
      e = (lo + hi) / 2;
      setB(e);
      k.clear();
      const d = k.derive(country, state, preset, null);
      if (!d) break;
      let n = 0,
        den = 0;
      for (const u of d.units) {
        const w = u.share * u.turnout;
        n += w * u.economicLean;
        den += w;
      }
      got = n / den;
      if (got < targetMean) lo = e;
      else hi = e;
      if (Math.abs(got - targetMean) < 0.01) break;
    }
    setB(e);
    const w = config.positions[dim][bucket];
    solved[state] = [
      Math.round(w.economicLean * 10) / 10,
      Math.round(w.socialLean * 10) / 10,
    ];
    config.positions = saved;
    report.push({
      state,
      target: targetMean,
      got: Math.round(got * 100) / 100,
      white: solved[state],
      was: [startE, startS],
    });
  }
  return { country, era, dim, bucket, solved, report };
}

/** Patch STATE_POSITION_OVERRIDES[era] white rows in a checkout. Refuses the shared main checkout. */
async function cmdPatch(): Promise<Json> {
  const { era, values, targetRepoDir } = args;
  const real = fs.realpathSync(targetRepoDir);
  const sharedRepoDir = process.env.LEAN_LAB_REPO_DIR;
  if (!sharedRepoDir) {
    throw new Error("LEAN_LAB_REPO_DIR is required to enforce the shared-checkout guard");
  }
  if (real === fs.realpathSync(sharedRepoDir)) {
    throw new Error(
      "refusing to patch the SHARED main checkout — pass a worktree (see ahd_shared_checkout_hazard)",
    );
  }
  const file = path.join(real, "src/lib/seeds/demographicCategories.ts");
  const lines = fs.readFileSync(file, "utf8").split("\n");
  // Find the era block inside STATE_POSITION_OVERRIDES: the era key line that
  // appears AFTER the const declaration.
  const declIdx = lines.findIndex((l) =>
    l.includes("const STATE_POSITION_OVERRIDES"),
  );
  if (declIdx < 0) throw new Error("STATE_POSITION_OVERRIDES not found");
  const start = lines.findIndex(
    (l, i) => i > declIdx && l.trim() === `"${era}": {`,
  );
  if (start < 0) throw new Error(`era block "${era}" not found`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^  "\d{4}": \{$/.test(lines[i]) || lines[i] === "};") {
      end = i;
      break;
    }
  }
  const stateRe = /^    ([A-Z]{2}): \[/;
  const whiteRe = /\["race", "white", -?[\d.]+, -?[\d.]+\]/;
  let cur: string | null = null;
  const done = new Set<string>();
  for (let i = start; i < end; i++) {
    const m = stateRe.exec(lines[i]);
    if (m) cur = m[1];
    if (cur && values[cur] && whiteRe.test(lines[i]) && !done.has(cur)) {
      const [e, s] = values[cur];
      lines[i] = lines[i].replace(whiteRe, `["race", "white", ${e}, ${s}]`);
      done.add(cur);
    }
  }
  fs.writeFileSync(file, lines.join("\n"));
  return {
    file,
    updated: [...done].sort(),
    missing: Object.keys(values)
      .filter((s) => !done.has(s))
      .sort(),
    note: "run the repo's era balance tests + git diff before committing",
  };
}

async function main() {
  const cmds: Record<string, () => Promise<Json>> = {
    overview: cmdOverview,
    state: cmdState,
    whatif: cmdWhatif,
    solve: cmdSolve,
    patch: cmdPatch,
  };
  const fn = cmds[args.cmd];
  if (!fn) throw new Error(`unknown cmd ${args.cmd}`);
  process.stdout.write(JSON.stringify(await fn()));
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ error: String(e?.message ?? e) }));
  process.exit(1);
});
