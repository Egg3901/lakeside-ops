// End-to-end MCP test: connects to the live ops-knowledge MCP over HTTP the way
// a remote agent would, exercises the new tools, then cleans up + revokes.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const store = require("../knowledge-store");
const tokens = require("../agent-tokens");

const ENDPOINT = "http://127.0.0.1:9725/mcp";
const NAME = "zzz-brain-test-mcp";
const KIND = "memory";

function textOf(r) { return (r.content || []).map((c) => c.text).join("\n"); }

(async () => {
  const db = await store.getDb();
  const { raw: token, id } = await tokens.issue(db, { name: "brain-test-client", collections: ["docs", "skills", "memory"], write: true, actor: "test" });
  const out = [];
  const check = (label, cond, detail = "") => out.push(`${cond ? "✓" : "✗ FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  const client = new Client({ name: "brain-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });

  try {
    await client.connect(transport);
    const tl = await client.listTools();
    const names = tl.tools.map((t) => t.name);
    check("new tools registered", ["knowledge_bootstrap", "knowledge_related", "knowledge_feedback", "knowledge_review_queue", "knowledge_history"].every((n) => names.includes(n)), names.join(","));
    check("write tools present (write token)", names.includes("knowledge_save") && names.includes("knowledge_delete"));

    // bootstrap
    const boot = await client.callTool({ name: "knowledge_bootstrap", arguments: {} });
    check("bootstrap returns the brief", /SHARED BRAIN/.test(textOf(boot)) && /NEVER ASSUME/.test(textOf(boot)));

    // save WITHOUT title/description → auto-summarize; with a [[link]]
    const save = await client.callTool({ name: "knowledge_save", arguments: {
      collection: KIND, name: NAME,
      body: "When the ops MCP won't start, check MONGODB_URI in ../.env and that ahd-mcp.service is active. Related: [[zzz-brain-test-neighbor]].",
    }});
    const saved = JSON.parse(textOf(save));
    check("save ok + action=created", saved.ok && saved.action === "created");
    check("title auto-generated (was omitted)", !!saved.title && saved.title.length > 0, saved.title);
    check("tags auto-generated (was omitted)", Array.isArray(saved.tags) && saved.tags.length > 0, JSON.stringify(saved.tags));
    check("link parsed", (saved.links || []).includes("zzz-brain-test-neighbor"), JSON.stringify(saved.links));

    // get → neighbors present
    const got = await client.callTool({ name: "knowledge_get", arguments: { collection: KIND, name: NAME } });
    const gotObj = JSON.parse(textOf(got));
    check("get returns neighbors block", !!gotObj.neighbors && Array.isArray(gotObj.neighbors.danglingOut));
    check("dangling link surfaced", gotObj.neighbors.danglingOut.includes("zzz-brain-test-neighbor"));

    // feedback
    const fb = await client.callTool({ name: "knowledge_feedback", arguments: { collection: KIND, name: NAME, vote: "up" } });
    check("feedback ok", JSON.parse(textOf(fb)).feedback.up === 1);

    // related
    const rel = await client.callTool({ name: "knowledge_related", arguments: { collection: KIND, name: NAME } });
    check("related returns graph", "backlinks" in JSON.parse(textOf(rel)));

    // history: save a v2 then diff
    await client.callTool({ name: "knowledge_save", arguments: { collection: KIND, name: NAME, title: "t", description: "d", body: "line one\nCHANGED line two\nline three" } });
    const hist = await client.callTool({ name: "knowledge_history", arguments: { collection: KIND, name: NAME } });
    const histObj = JSON.parse(textOf(hist));
    check("history has timeline + diff patch", histObj.currentVersion >= 2 && !!histObj.diff && typeof histObj.diff.patch === "string", "v" + histObj.currentVersion);

    // review queue
    const rq = await client.callTool({ name: "knowledge_review_queue", arguments: { limit: 5 } });
    const rqObj = JSON.parse(textOf(rq));
    check("review queue returns items with recommendations", Array.isArray(rqObj.items) && (rqObj.items.length === 0 || "recommendation" in rqObj.items[0]));
  } catch (e) {
    out.push("✗ THREW: " + e.stack);
  } finally {
    try { await client.close(); } catch {}
    await db.collection(store.COLLECTION).deleteOne({ kind: KIND, name: NAME });
    await tokens.revoke(db, String(id), { ObjectId: store.ObjectId });
    console.log(out.join("\n"));
    const failed = out.filter((r) => r.startsWith("✗")).length;
    console.log(`\n${failed === 0 ? "ALL PASS" : failed + " FAILED"} (${out.length} checks); entry deleted, token revoked.`);
    process.exit(failed === 0 ? 0 : 1);
  }
})();
