// Lean Lab MCP — view, what-if, solve and patch EVERYTHING seeded that feeds
// electoral lean: era/state position tables, census position blocks, and the
// org/reg structural layer, computed through the game's real election kernel
// (cell derivation + calcAppeal + orgVoteWeight + regResistanceMultiplier).
// Each tool shells into the game repo via tsx (lean-lab-runner.ts) so numbers
// always come from the CODE in the target checkout, never a mirror.
//   node mcp/lean-lab-server.js   (default :9746)
require("dotenv").config({
  quiet: true,
  path: require("path").join(__dirname, "..", ".env"),
});
const path = require("path");
const { execFile } = require("child_process");
const { z } = require("zod");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { createServer } = require("../packages/mcp-server");
const store = require("../knowledge-store");
const tokens = require("../agent-tokens");
const { getConfig } = require("../src/core/config");

const PORT = parseInt(process.env.LEAN_LAB_MCP_PORT || "9746", 10);
// Default read checkout. Patch REFUSES this path (shared-checkout hazard) —
// pass a worktree via targetRepoDir for writes.
const dashboardConfig = getConfig();
const primaryProject = (dashboardConfig.projects || []).find(
  (project) => project.key === dashboardConfig.primaryProject,
);
// Resolved but not enforced at import time: requiring the module (tests,
// tooling) must not depend on a configured checkout. main() refuses to start
// without one.
const REPO_DIR = process.env.LEAN_LAB_REPO_DIR || primaryProject?.repoDir || null;
const RUNNER = path.join(__dirname, "lean-lab-runner.ts");

function getTsxBin(repoDir) {
  return (
    process.env.LEAN_LAB_TSX_BIN ||
    path.join(repoDir, "node_modules", ".bin", "tsx")
  );
}

function runRunner(payload, repoDir) {
  const dir = repoDir || REPO_DIR;
  return new Promise((resolve) => {
    execFile(
      getTsxBin(dir),
      [
        "--tsconfig",
        path.join(dir, "tsconfig.json"),
        RUNNER,
        JSON.stringify({ ...payload, repoDir: dir }),
      ],
      {
        cwd: dir,
        timeout: 180_000,
        maxBuffer: 32 * 1024 * 1024,
        env: {
          ...process.env,
          LEAN_LAB_REPO_DIR: REPO_DIR,
          NODE_OPTIONS: "--max-old-space-size=8192",
        },
      },
      (err, stdout, stderr) => {
        if (stdout) {
          try {
            return resolve(JSON.parse(stdout));
          } catch (_e) {
            /* fall through */
          }
        }
        resolve({
          error: String((err && err.message) || "runner failed"),
          stderr: String(stderr).slice(-2000),
        });
      },
    );
  });
}

const eraParam = z
  .enum(["1953", "1979", "1991", "1999", "2007", "2019", "2023"])
  .describe("era anchor key");
const repoParam = z
  .string()
  .optional()
  .describe("checkout to READ code from (default the main repo)");

async function main() {
  if (!REPO_DIR) {
    throw new Error("Lean Lab requires LEAN_LAB_REPO_DIR or a configured primary project repoDir");
  }
  const opsDb = await store.getDb(process.env.MONGODB_URI);
  await tokens.ensureIndexes(opsDb);
  function buildServer() {
    const server = new McpServer({ name: "ops-lean-lab", version: "1.0.0" });

    server.tool(
      "lean_overview",
      "Per-state electoral-lean dashboard for a country x era: electorate mean econ/social for US, UK, RU, and DD, plus static two-way Left share and org/reg aggregates for competitive US/UK systems. Read-only.",
      {
        country: z.string().describe("country code, e.g. US or UK"),
        era: eraParam,
        states: z
          .array(z.string())
          .optional()
          .describe("subset of state/region ids (default: all)"),
        repoDir: repoParam,
      },
      async ({ country, era, states, repoDir }) =>
        jsonResult(
          await runRunner({ cmd: "overview", country, era, states }, repoDir),
        ),
    );

    server.tool(
      "lean_state",
      "Deep-dive one state/region: every seeded input that feeds its lean — merged era+override position table, census-level position block (which WINS over the merged table), census marginals, org/reg, top electorate cells by turnout pool — plus the derived numbers. Read-only.",
      {
        country: z.string(),
        state: z.string().describe("state/region id, e.g. OH or SCO"),
        era: eraParam,
        topCells: z
          .number()
          .optional()
          .describe("how many cells to return (default 15)"),
        repoDir: repoParam,
      },
      async ({ country, state, era, topCells, repoDir }) =>
        jsonResult(
          await runRunner(
            { cmd: "state", country, state, era, topCells },
            repoDir,
          ),
        ),
    );

    server.tool(
      "lean_whatif",
      "Trial-balloon a tweak WITHOUT touching files: inject position overrides (any dim/bucket) and/or org/reg values for one state and get before/after electorate mean + realized share. Use to answer 'what happens if Ohio whites move to +0.5' or 'if GOP org in NY rises to 35'.",
      {
        country: z.string(),
        state: z.string(),
        era: eraParam,
        positions: z
          .record(
            z.record(
              z.object({ economicLean: z.number(), socialLean: z.number() }),
            ),
          )
          .optional()
          .describe(
            'e.g. {"race":{"white":{"economicLean":0.5,"socialLean":0.3}}}',
          ),
        org: z
          .object({ L: z.number().optional(), R: z.number().optional() })
          .optional()
          .describe("trial org values (L=Dem/Labour analogue)"),
        reg: z
          .object({ L: z.number().optional(), R: z.number().optional() })
          .optional(),
        repoDir: repoParam,
      },
      async ({ country, state, era, positions, org, reg, repoDir }) =>
        jsonResult(
          await runRunner(
            { cmd: "whatif", country, state, era, positions, org, reg },
            repoDir,
          ),
        ),
    );

    server.tool(
      "lean_solve",
      "Bisection-solve a bucket's position (default race.white, social tracking econ at 0.6) per state so the electorate mean econ lean hits given targets. Returns solved [econ, social] pairs ready for lean_patch. Convention: mean target = -(margin)/30 vs the anchor election; the 2026-08 1953 doctrine compresses margins 0.5x + 2.5 D-offset with a -0.5 Deep South floor.",
      {
        country: z.string(),
        era: eraParam,
        targets: z
          .record(z.number())
          .describe(
            'per-state target mean econ lean, e.g. {"OH":0.14,"KS":0.55}',
          ),
        dim: z.string().optional().describe("dimension (default race)"),
        bucket: z.string().optional().describe("bucket (default white)"),
        socialTrack: z
          .number()
          .optional()
          .describe("social delta per econ delta (default 0.6)"),
        repoDir: repoParam,
      },
      async ({ country, era, targets, dim, bucket, socialTrack, repoDir }) =>
        jsonResult(
          await runRunner(
            { cmd: "solve", country, era, targets, dim, bucket, socialTrack },
            repoDir,
          ),
        ),
    );

    server.tool(
      "lean_patch",
      "WRITE solved [econ, social] white values into STATE_POSITION_OVERRIDES[era] in a checkout's demographicCategories.ts (line-based, comment-safe). REFUSES the shared main checkout — pass a worktree. Run the repo's balance tests + review git diff before committing.",
      {
        era: eraParam,
        values: z
          .record(z.tuple([z.number(), z.number()]))
          .describe('{"OH":[0.1,-0.1], ...}'),
        targetRepoDir: z
          .string()
          .describe(
            "worktree checkout to modify (REQUIRED, never the shared main checkout)",
          ),
      },
      async ({ era, values, targetRepoDir }) =>
        jsonResult(
          await runRunner(
            { cmd: "patch", era, values, targetRepoDir },
            targetRepoDir,
          ),
        ),
    );

    return server;
  }

  createServer({
    name: "lean-lab-mcp", port: PORT, bind: process.env.MCP_BIND || "127.0.0.1", jsonLimit: "1mb",
    authorize: req => tokens.validate(opsDb, req.headers.authorization), buildServer,
    health: () => ({ port: PORT, repoDir: REPO_DIR, tsxBin: getTsxBin(REPO_DIR) }),
  });
}

function jsonResult(o) {
  return { content: [{ type: "text", text: JSON.stringify(o, null, 2) }] };
}
function rpcErr(code, message) {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}

if (require.main === module) {
  main().catch((e) => {
    console.error("[lean-lab-mcp] fatal:", e);
    process.exit(1);
  });
}

module.exports = { getTsxBin, runRunner };
