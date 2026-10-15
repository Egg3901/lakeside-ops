// heal-ops MCP — the paired-remediation surface.
//
// A corruption defect has two halves: the CODE fix that stops new bad rows, and
// the DATA heal that repairs rows already written. This MCP is the only agent
// path to the second half, and it refuses to run it before the first half is
// live in the target environment.
//
// Every tool shells into the game repo's CLI (scripts/remediation/cli.ts) with
// --json, so the numbers and the refusals come from the CODE in the checkout,
// never from a mirror here. One implementation, two front ends.
//
//   node mcp/heal-ops-server.js   (default :9747)
//
// Environment wiring (per target env, no defaults — an unconfigured env is
// refused rather than guessed):
//   HEAL_MONGODB_URI_PROD / _SANDBOX / _DEV
//   HEAL_OPS_REPO_DIR    game checkout to run the ledger from
//   HEAL_OPS_MCP_PORT    listen port
//
// Only heal_apply and heal_rollback write. Everything else is read-only and
// safe to call at any time.
require("dotenv").config({
  quiet: true,
  path: require("path").join(__dirname, "..", ".env")
});
const path = require("path");
const { execFile } = require("child_process");
const { z } = require("zod");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { createServer } = require("../packages/mcp-server");
const store = require("../knowledge-store");
const tokens = require("../agent-tokens");
const { requireAdminAuthorization } = require("./heal-authorization");

const PORT = parseInt(process.env.HEAL_OPS_MCP_PORT || "9747", 10);
const REPO_DIR = process.env.HEAL_OPS_REPO_DIR || "/root/projects/a-house-divided";
const CLI = "scripts/remediation/cli.ts";

// Per-env Mongo URIs. Absent means the env is not wired up on this box, and
// every tool refuses it. Deliberately no fallback: silently defaulting to the
// prod URI because SANDBOX was unset is exactly the accident this tool exists
// to prevent.
const ENV_URIS = {
  prod: process.env.HEAL_MONGODB_URI_PROD,
  sandbox: process.env.HEAL_MONGODB_URI_SANDBOX,
  dev: process.env.HEAL_MONGODB_URI_DEV
};

function envUri(env) {
  const uri = ENV_URIS[env];
  if (!uri) {
    return {
      error:
        `env "${env}" is not configured on this box: set HEAL_MONGODB_URI_${env.toUpperCase()} ` +
        "in /root/projects/LSGD-ops-dash/.env and restart ahd-heal-ops-mcp. " +
        "Refusing to guess which database you meant."
    };
  }
  return { uri };
}

// Which Railway service backs which heal environment. The code gate needs the
// commit that is ACTUALLY RUNNING in the target env, and the railway MCP does
// not return commit hashes, so this asks Railway's API directly.
const RAILWAY_SERVICE_FOR_ENV = {
  prod: process.env.HEAL_RAILWAY_SERVICE_PROD || "Main Site",
  sandbox: process.env.HEAL_RAILWAY_SERVICE_SANDBOX || "Sandbox Staging",
  dev: process.env.HEAL_RAILWAY_SERVICE_DEV || null
};

const shaCache = new Map(); // env -> { sha, at }
const SHA_TTL_MS = 60_000;

/**
 * Commit currently LIVE in an environment.
 *
 * Deliberately the most recent SUCCESS deployment, not the most recent
 * deployment: a build in flight has not replaced the running one, and treating
 * a BUILDING commit as deployed would let the gate pass for code that is not
 * serving traffic yet.
 *
 * Returns null on any failure. The gate fails closed on null, so a Railway
 * outage blocks pinned heals rather than waving them through.
 */
async function resolveDeployedSha(env) {
  const service = RAILWAY_SERVICE_FOR_ENV[env];
  const token = process.env.RAILWAY_API_TOKEN;
  const projectId = process.env.RAILWAY_PROJECT_ID;
  if (!service || !token || !projectId) return null;

  const cached = shaCache.get(env);
  if (cached && Date.now() - cached.at < SHA_TTL_MS) return cached.sha;

  const query = `query($id:String!){ project(id:$id){ services{ edges{ node{ name deployments(first:10){ edges{ node{ status meta createdAt } } } } } } } }`;
  try {
    const res = await fetch("https://backboard.railway.app/graphql/v2", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query, variables: { id: projectId } }),
      signal: AbortSignal.timeout(15_000)
    });
    const json = await res.json();
    const node = json?.data?.project?.services?.edges?.find((e) => e.node.name === service)?.node;
    const live = node?.deployments?.edges?.map((e) => e.node).find((d) => d.status === "SUCCESS");
    const sha = live?.meta?.commitHash || null;
    if (sha) shaCache.set(env, { sha, at: Date.now() });
    return sha;
  } catch {
    return null;
  }
}

/** Run the ledger CLI in the game checkout and parse its JSON. */
function runCli(args, env) {
  const resolved = env ? envUri(env) : { uri: null };
  if (resolved.error) return Promise.resolve({ ok: false, error: resolved.error });

  return new Promise((resolve) => {
    execFile(
      "npx",
      ["tsx", CLI, ...args, "--json"],
      {
        cwd: REPO_DIR,
        timeout: 300_000,
        maxBuffer: 32 * 1024 * 1024,
        env: {
          ...process.env,
          ...(resolved.uri ? { MONGODB_URI: resolved.uri } : {}),
          NODE_OPTIONS: "--max-old-space-size=4096"
        }
      },
      (err, stdout, stderr) => {
        // The CLI exits non-zero on a refusal but still prints JSON, so parse
        // stdout FIRST — a refusal is a result, not a transport failure.
        // The CLI keeps dotenv quiet, but tsx and the loader can still print to
        // stdout. Scan candidate "{" offsets rather than trusting the first.
        if (stdout) {
          for (let i = stdout.indexOf("{"); i >= 0; i = stdout.indexOf("{", i + 1)) {
            try {
              return resolve(JSON.parse(stdout.slice(i)));
            } catch (_e) {
              /* not the start of the payload — keep looking */
            }
          }
        }
        resolve({
          ok: false,
          error: String((err && err.message) || "ledger CLI failed"),
          stderr: String(stderr).slice(-2000)
        });
      }
    );
  });
}

const envParam = z
  .enum(["dev", "sandbox", "prod"])
  .describe("target environment — always named explicitly, never inferred");
const operatorParam = z
  .string()
  .optional()
  .describe("who is running this; recorded on the run forever (default: the MCP token owner)");
const deployedShaParam = z
  .string()
  .optional()
  .describe(
    "override the live commit for this env. Normally OMIT it: the server resolves the latest " +
      "SUCCESSFUL Railway deployment for the env by itself. Drives the code gate — the defect's " +
      "requiredCommit must be an ancestor of it"
  );

function opArgs(operator, deployedSha) {
  const args = [];
  if (operator) args.push("--operator", operator);
  if (deployedSha) args.push("--deployed-sha", deployedSha);
  return args;
}

async function main() {
  const opsDb = await store.getDb(process.env.MONGODB_URI);
  await tokens.ensureIndexes(opsDb);
  function buildServer(auth) {
    const server = new McpServer({ name: "ops-heal", version: "1.0.0" });
    const defaultOperator = (auth && auth.name) || "mcp";
    // The two tools that mutate a game database need a write-scoped token, not
    // just any valid one. Read tools stay open to the whole fleet.
    const canWrite = Boolean(auth && auth.scopes && auth.scopes.write === true);
    const writeRefusal = {
      ok: false,
      error: "this token is read-only — heal_apply and heal_rollback need a write-scoped agent token"
    };

    server.tool(
      "heal_list",
      "Every defect in the remediation ledger: id, severity, which envs it may be healed in, its guards, and the code half (PR / required commit). Static registry view — for whether each env is actually clean right now, use heal_status. Read-only.",
      {},
      async () => jsonResult(await runCli(["list"]))
    );

    server.tool(
      "heal_status",
      "THE ENV MATRIX. Runs every defect's detector against every configured environment and returns one grid: which defects are dirty, where, and when each was last healed there. This is the answer to 'did we remember to heal the sandbox' — Defect.envs only says where a heal MAY run, never where it HAS run, which is why sandbox stays broken for weeks after prod is fixed. Also surfaces per-defect warnings: unassessed seed, unpinned code fix, nothing stopping the corruption returning. Cheap and read-only; call it freely.",
      {
        defectId: z.string().optional().describe("limit to one defect; omit for the whole ledger"),
        envs: z
          .array(z.enum(["dev", "sandbox", "prod"]))
          .optional()
          .describe("default: all three")
      },
      async ({ defectId, envs }) => {
        const args = ["status"];
        if (defectId) args.push("--defect", defectId);
        if (envs && envs.length) args.push("--envs", envs.join(","));
        // No single env: the matrix resolves each env's URI itself.
        return jsonResult(await runCli(args, "prod"));
      }
    );

    server.tool(
      "heal_detect",
      "Run a defect's DETECTOR against an environment: how many rows are corrupt right now, plus a sample. This is the definition of the bug and the thing that must return zero before the defect can be closed. Read-only, always safe.",
      { defectId: z.string(), env: envParam },
      async ({ defectId, env }) => jsonResult(await runCli(["detect", defectId, "--env", env], env))
    );

    server.tool(
      "heal_plan",
      "DRY RUN. Computes exactly what the heal would change, evaluates every guard (turn lock, affected cap, money conservation, code gate), and — only if all of them pass — mints a CONFIRM TOKEN bound to the world state it saw. Writes nothing but the token row. The token is the only way to call heal_apply, expires in 10 minutes, and dies if a turn ticks or the affected set moves.",
      {
        defectId: z.string(),
        env: envParam,
        operator: operatorParam,
        deployedSha: deployedShaParam
      },
      async ({ defectId, env, operator, deployedSha }) => {
        // Resolve the live commit ourselves when the caller did not supply one,
        // so the code gate works by default instead of only when somebody
        // remembers to look up a SHA.
        const sha = deployedSha || (await resolveDeployedSha(env));
        return jsonResult(
          await runCli(["plan", defectId, "--env", env, ...opArgs(operator || defaultOperator, sha)], env)
        );
      }
    );

    server.tool(
      "heal_apply",
      "ADMIN-AUTHORIZED writer. A direct operator session may apply after an explicit admin request by passing confirmAdminApply:true. Unattended ticket-repair sessions must use support_notify_ops_heal instead. Re-checks live state and every guard, snapshots touched documents, verifies the result, and records the run. Production also requires confirmProd:true.",
      {
        defectId: z.string(),
        env: envParam,
        token: z.string().describe("confirm token from heal_plan, under 10 minutes old"),
        confirmAdminApply: z.boolean().describe("true only when an admin explicitly requested this guarded apply"),
        confirmProd: z.boolean().optional().describe("required to be true when env is prod; ignored otherwise"),
        operator: operatorParam,
        deployedSha: deployedShaParam,
        overrideCodeGate: z
          .string()
          .optional()
          .describe(
            "bypass a FAILING code gate, with the reason. Recorded on the run forever. Use only when the data damage is player-visible and the fix is imminent"
          )
      },
      async ({ defectId, env, token, confirmAdminApply, confirmProd, operator, deployedSha, overrideCodeGate }) => {
        if (!canWrite) return jsonResult(writeRefusal);
        const authorization = requireAdminAuthorization(confirmAdminApply, {
          tool: "heal_apply",
          auth
        });
        if (authorization) return jsonResult(authorization);
        const sha = deployedSha || (await resolveDeployedSha(env));
        const args = ["apply", defectId, "--env", env, "--token", token, ...opArgs(operator || defaultOperator, sha)];
        if (env === "prod" && confirmProd === true) args.push("--confirm-prod");
        if (overrideCodeGate) args.push("--override-code-gate", overrideCodeGate);
        return jsonResult(await runCli(args, env));
      }
    );

    server.tool(
      "heal_verify",
      "Re-run the detector plus the defect's own invariants after a heal. `ok` is true only when zero corrupt rows remain. A defect is not closed until this passes in the target env. Read-only.",
      { defectId: z.string(), env: envParam },
      async ({ defectId, env }) => jsonResult(await runCli(["verify", defectId, "--env", env], env))
    );

    server.tool(
      "heal_history",
      "The healRuns audit trail: what was healed, in which env, by whom, how many documents, the guard and code-gate verdicts, and whether verification passed. The record heals on this box have never had. Read-only.",
      {
        defectId: z.string().optional(),
        env: z.enum(["dev", "sandbox", "prod"]).optional(),
        limit: z.number().optional().describe("default 25, max 200")
      },
      async ({ defectId, env, limit }) => {
        const args = ["history"];
        if (defectId) args.push("--defect", defectId);
        if (env) args.push("--env", env);
        if (limit) args.push("--limit", String(limit));
        // history needs a DB; without an env it reads the prod ledger.
        const target = env || "prod";
        return jsonResult(await runCli(args, target));
      }
    );

    server.tool(
      "heal_rollback",
      "ADMIN-AUTHORIZED write. A direct operator session may restore a run from healBackups after an explicit admin request by passing confirmAdminApply:true. Unattended ticket-repair sessions may not call this.",
      {
        runId: z.string().describe("run id from heal_apply or heal_history"),
        env: envParam,
        confirmAdminApply: z.boolean().describe("true only when an admin explicitly requested this rollback")
      },
      async ({ runId, env, confirmAdminApply }) => {
        if (!canWrite) return jsonResult(writeRefusal);
        const authorization = requireAdminAuthorization(confirmAdminApply, {
          tool: "heal_rollback",
          auth
        });
        if (authorization) return jsonResult(authorization);
        return jsonResult(await runCli(["rollback", runId, "--env", env], env));
      }
    );

    // ── read-only inspection ────────────────────────────────────────────────
    // Here so that "I just want to look at the database" never needs a mongo
    // shell. An open shell is how an unlogged updateMany happens.

    server.tool(
      "heal_query",
      "Read-only find against any collection in an environment. Returns matched count plus up to 200 documents. Rejects $where / $function (server-side JS) and has no aggregation, so it cannot write. Use this instead of opening mongosh to look at something.",
      {
        env: envParam,
        collection: z.string(),
        filter: z.record(z.any()).optional(),
        projection: z.record(z.number()).optional(),
        sort: z.record(z.number()).optional(),
        limit: z.number().optional().describe("default 25, max 200")
      },
      async ({ env, collection, filter, projection, sort, limit }) => {
        const args = ["query", collection];
        if (filter) args.push("--filter", JSON.stringify(filter));
        if (projection) args.push("--projection", JSON.stringify(projection));
        if (sort) args.push("--sort", JSON.stringify(sort));
        if (limit) args.push("--limit", String(limit));
        return jsonResult(await runCli(args, env));
      }
    );

    server.tool(
      "heal_count",
      "Read-only document count for a filter. The cheapest way to ask 'how bad is it'.",
      {
        env: envParam,
        collection: z.string(),
        filter: z.record(z.any()).optional()
      },
      async ({ env, collection, filter }) => {
        const args = ["count", collection];
        if (filter) args.push("--filter", JSON.stringify(filter));
        return jsonResult(await runCli(args, env));
      }
    );

    server.tool(
      "heal_collections",
      "List collections in an environment with approximate document counts. Read-only orientation tool.",
      { env: envParam },
      async ({ env }) => jsonResult(await runCli(["collections"], env))
    );

    // ── ad-hoc repairs ──────────────────────────────────────────────────────
    // The tools that make direct database writes obsolete: a one-off with no
    // ledger entry still gets the dry run, token, turn lock, cap, snapshot,
    // audit row and rollback.

    server.tool(
      "heal_adhoc_plan",
      "DRY RUN a one-off repair that has no ledger entry yet. Give a filter and a set/unset/delete action; you get back what would change, every guard verdict, and a confirm token if all of them pass. Refuses: the ledger's own collections, an empty filter without confirmWholeCollection, a missing or non-positive expectedMax, and any write to a money-shaped field without touchesMoney. Use this rather than mongosh — it is quicker and the result is reversible.",
      {
        env: envParam,
        description: z
          .string()
          .describe("what you are repairing and why; the only explanation that survives in healRuns"),
        collection: z.string(),
        filter: z.record(z.any()).describe("match expression; {} needs confirmWholeCollection"),
        action: z
          .object({
            kind: z.enum(["set", "unset", "delete"]),
            set: z.record(z.any()).optional(),
            unset: z.array(z.string()).optional()
          })
          .describe('e.g. {kind:"set", set:{stuck:false}} or {kind:"delete"}'),
        expectedMax: z
          .number()
          .describe(
            "refuse if more documents match than this; required, an unbounded ad-hoc write is the most dangerous thing you can do here"
          ),
        ticket: z.string().optional(),
        touchesMoney: z.boolean().optional(),
        confirmWholeCollection: z.boolean().optional(),
        balanceCorrection: z
          .boolean()
          .optional()
          .describe("only to repair a broken liquidCapital or funds value; payments use heal_compensate_plan"),
        operator: operatorParam
      },
      async ({ env, operator, ...spec }) =>
        jsonResult(
          await runCli(
            ["adhoc-plan", "--env", env, "--spec", JSON.stringify(spec), ...opArgs(operator || defaultOperator)],
            env
          )
        )
    );

    server.tool(
      "heal_adhoc_apply",
      "ADMIN-AUTHORIZED writer. A direct operator session may apply a one-off repair after an explicit admin request by passing confirmAdminApply:true. Unattended ticket-repair sessions must use support_notify_ops_heal instead. The plan is re-checked, snapshotted, verified, and recorded.",
      {
        env: envParam,
        token: z.string(),
        description: z.string(),
        collection: z.string(),
        filter: z.record(z.any()),
        action: z.object({
          kind: z.enum(["set", "unset", "delete"]),
          set: z.record(z.any()).optional(),
          unset: z.array(z.string()).optional()
        }),
        expectedMax: z.number(),
        ticket: z.string().optional(),
        touchesMoney: z.boolean().optional(),
        confirmWholeCollection: z.boolean().optional(),
        balanceCorrection: z
          .boolean()
          .optional()
          .describe("only to repair a broken liquidCapital or funds value; payments use heal_compensate_plan"),
        confirmProd: z.boolean().optional(),
        confirmAdminApply: z.boolean().describe("true only when an admin explicitly requested this guarded apply"),
        operator: operatorParam
      },
      async ({ env, token, confirmProd, confirmAdminApply, operator, ...spec }) => {
        if (!canWrite) return jsonResult(writeRefusal);
        const authorization = requireAdminAuthorization(confirmAdminApply, {
          tool: "heal_adhoc_apply",
          auth
        });
        if (authorization) return jsonResult(authorization);
        const args = [
          "adhoc-apply",
          "--env",
          env,
          "--token",
          token,
          "--spec",
          JSON.stringify(spec),
          ...opArgs(operator || defaultOperator)
        ];
        if (env === "prod" && confirmProd === true) args.push("--confirm-prod");
        return jsonResult(await runCli(args, env));
      }
    );

    // ── compensation ─────────────────────────────────────────────────────────
    // Paying corporations what a bug cost them: exact amounts, an idempotency
    // marker, the real moneyDelta and a restitution_credit receipt each, on the
    // same guarded path as every other heal. Never pay someone with an ad-hoc
    // liquidCapital set: that leaves money with no transaction record.

    const compensationSpec = {
      description: z.string().describe("who is owed what and why; kept in healRuns and on every receipt"),
      ticket: z.string().optional(),
      mode: z
        .enum(["credit", "receipt-only"])
        .describe("credit moves the money now; receipt-only records money that already moved outside the heal engine"),
      credits: z
        .array(
          z.object({
            corporationId: z.string().describe("corporations._id, 24 hex characters"),
            amountLocal: z.number().describe("positive, in the corporation's own currency"),
            basis: z.string().optional().describe("one line on how the amount was worked out")
          })
        )
        .min(1),
      expectedMax: z.number(),
      movedAt: z.string().optional().describe("receipt-only: ISO time the money actually moved"),
      ledgerTurn: z.number().optional().describe("receipt-only: the game clock at movedAt plus one")
    };

    server.tool(
      "heal_compensate_plan",
      "DRY RUN an owner-approved repayment to corporations. Use this, not heal_adhoc on liquidCapital, for any payment: it credits exact amounts once, reports the real moneyDelta and writes a restitution_credit receipt per corporation. receipt-only mode writes the missing receipts for money already paid outside the heal engine. Returns guard verdicts and a confirm token.",
      { env: envParam, ...compensationSpec, operator: operatorParam },
      async ({ env, operator, ...spec }) =>
        jsonResult(
          await runCli(
            ["compensate-plan", "--env", env, "--spec", JSON.stringify(spec), ...opArgs(operator || defaultOperator)],
            env
          )
        )
    );

    server.tool(
      "heal_compensate_apply",
      "ADMIN-AUTHORIZED writer. Apply a compensation planned with heal_compensate_plan, using its token and the identical spec. Requires confirmAdminApply:true after an explicit admin request, and confirmProd:true in prod.",
      {
        env: envParam,
        token: z.string(),
        ...compensationSpec,
        confirmProd: z.boolean().optional(),
        confirmAdminApply: z.boolean().describe("true only when an admin explicitly requested this guarded apply"),
        operator: operatorParam
      },
      async ({ env, token, confirmProd, confirmAdminApply, operator, ...spec }) => {
        if (!canWrite) return jsonResult(writeRefusal);
        const authorization = requireAdminAuthorization(confirmAdminApply, {
          tool: "heal_compensate_apply",
          auth
        });
        if (authorization) return jsonResult(authorization);
        const args = [
          "compensate-apply",
          "--env",
          env,
          "--token",
          token,
          "--spec",
          JSON.stringify(spec),
          ...opArgs(operator || defaultOperator)
        ];
        if (env === "prod" && confirmProd === true) args.push("--confirm-prod");
        return jsonResult(await runCli(args, env));
      }
    );

    server.tool(
      "heal_scaffold",
      "Print a ready-to-edit ledger entry for a new defect: detector, plan, apply, verify, guards, and the mandatory seedFix field. Use this the second time a repair recurs — the ad-hoc path is for one-offs, and boilerplate is the only reason people skip writing a proper entry.",
      {
        defectId: z.string().describe("e.g. AHD-1234"),
        collection: z.string().optional()
      },
      async ({ defectId, collection }) => {
        const args = ["scaffold", defectId];
        if (collection) args.push("--collection", collection);
        return jsonResult(await runCli(args));
      }
    );

    server.tool(
      "heal_indexes",
      "Create the healRuns / healBackups / healTokens indexes in an environment. Run once per database before the first heal. Idempotent.",
      { env: envParam },
      async ({ env }) => jsonResult(await runCli(["indexes", "--env", env], env))
    );

    return server;
  }

  createServer({
    name: "heal-ops-mcp", port: PORT, bind: "0.0.0.0", jsonLimit: "1mb",
    authorize: req => tokens.validate(opsDb, req.headers.authorization), buildServer,
    health: () => ({ port: PORT, repoDir: REPO_DIR, configuredEnvs: Object.keys(ENV_URIS).filter(e => Boolean(ENV_URIS[e])), railwayServices: RAILWAY_SERVICE_FOR_ENV }),
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
    console.error("[heal-ops-mcp] fatal:", e);
    process.exit(1);
  });
}

module.exports = { envUri, ENV_URIS };
