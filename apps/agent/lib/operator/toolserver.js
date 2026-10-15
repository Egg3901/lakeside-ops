"use strict";
// Loopback MCP endpoint that exposes the broker's tools to a headless Claude
// Code session. Each activation gets its own unguessable path bound to one job,
// its tool list and its abort signal; nothing else is reachable through it.
const http = require("node:http");
const crypto = require("node:crypto");
const { redactSecrets } = require("../text");

function createToolServer({ broker, normalizeImage, port = 0 }) {
  const sessions = new Map();
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(body === undefined ? "" : JSON.stringify(body)); };
    const token = /^\/mcp\/([a-f0-9]{48})$/.exec(req.url || "")?.[1];
    const session = token && sessions.get(token);
    if (!session) return send(404, { error: "unknown session" });
    if (req.method !== "POST") return send(405, { error: "POST only" });
    let raw = ""; for await (const chunk of req) { raw += chunk; if (raw.length > 2e6) return send(413, { error: "too large" }); }
    let msg; try { msg = JSON.parse(raw); } catch { return send(400, { error: "invalid json" }); }
    if (msg.id === undefined) return send(202);
    const ok = (result) => send(200, { jsonrpc: "2.0", id: msg.id, result });
    if (msg.method === "initialize") return ok({ protocolVersion: msg.params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "keir", version: "1.0.0" } });
    if (msg.method === "ping") return ok({});
    if (msg.method === "tools/list") return ok({ tools: session.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })) });
    if (msg.method !== "tools/call") return send(200, { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
    const { name, arguments: input = {} } = msg.params || {};
    if (!session.tools.some((t) => t.name === name)) return ok({ isError: true, content: [{ type: "text", text: `tool ${name} is not available in this task` }] });
    try {
      const result = await broker.tool(session.job, name, input, session.signal);
      const images = result?.image ? [result.image] : result?._images || [];
      const safe = result && typeof result === "object" ? { ...result } : result;
      if (safe && typeof safe === "object") { delete safe._images; delete safe.image; }
      const content = [{ type: "text", text: redactSecrets(JSON.stringify(safe ?? null)).slice(0, 22000) }];
      for (const source of images) {
        try { const img = normalizeImage(source); content.push({ type: "image", data: img.data, mimeType: img.media_type }); }
        catch (e) { content.push({ type: "text", text: e.message }); }
      }
      session.calls++;
      return ok({ content });
    } catch (e) {
      return ok({ isError: true, content: [{ type: "text", text: redactSecrets(e.message) }] });
    }
  });
  const ready = new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server.address().port)));
  server.unref();
  async function open(job, tools, signal) {
    const token = crypto.randomBytes(24).toString("hex");
    const session = { job, tools, signal, calls: 0 };
    sessions.set(token, session);
    return { url: `http://127.0.0.1:${await ready}/mcp/${token}`, session, close: () => sessions.delete(token) };
  }
  return { open, close: () => server.close() };
}
module.exports = { createToolServer };
