"use strict";

const crypto = require("node:crypto");
const express = require("express");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");

function rpcError(code, message) {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}

function bearerFromEnv(tokenEnv, env = process.env) {
  return async request => {
    const expected = env[tokenEnv];
    const supplied = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!expected || !supplied || expected.length !== supplied.length) return null;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied)) ? true : null;
  };
}

function createServer({ name, version = "1.0.0", port, bind = "127.0.0.1", buildServer, authorize,
  auth, health, listen = true, jsonLimit = "256kb", logger = console, onListen,
  normalizeDuplicateJsonContentType = false,
  transportFactory = () => new StreamableHTTPServerTransport({ sessionIdGenerator: undefined }) } = {}) {
  if (!name || typeof buildServer !== "function") throw new Error("name and buildServer are required");
  if (listen && !Number.isInteger(port)) throw new Error("port is required when listen is enabled");
  const authenticate = authorize || (auth?.tokenEnv && bearerFromEnv(auth.tokenEnv));
  if (typeof authenticate !== "function") throw new Error("authorize or auth.tokenEnv is required");
  const app = express();
  if (normalizeDuplicateJsonContentType) {
    // The Rust serve_node proxy sends JSON itself and forwards the caller's
    // identical Content-Type. Normalize only that duplicate for the MCP SDK.
    app.use("/mcp", (req, _res, next) => {
      const type = req.headers["content-type"];
      if (typeof type === "string" && /^application\/json(?:\s*,\s*application\/json)+$/i.test(type)) {
        req.headers["content-type"] = "application/json";
      }
      const raw = req.rawHeaders;
      const copies = [];
      for (let i = 0; i < raw.length; i += 2) {
        if (raw[i].toLowerCase() === "content-type") copies.push(raw[i + 1]);
      }
      if (copies.length > 1 && copies.every(value => /^application\/json$/i.test(value.trim()))) {
        const cleaned = [];
        let kept = false;
        for (let i = 0; i < raw.length; i += 2) {
          const isType = raw[i].toLowerCase() === "content-type";
          if (!isType || !kept) cleaned.push(raw[i], raw[i + 1]);
          if (isType) kept = true;
        }
        req.rawHeaders = cleaned;
        req.headers["content-type"] = "application/json";
      }
      next();
    });
  }
  const started = Date.now();
  const counters = new Map();
  app.use(express.json({ limit: jsonLimit }));
  app.get("/healthz", async (_req, res) => {
    try { res.json({ ok: true, service: name, version, ...(health ? await health() : {}) }); }
    catch (error) { res.status(503).json({ ok: false, service: name, version }); logger.error(`[${name}] health error:`, error); }
  });
  app.get("/metrics", (req, res) => {
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)) return res.sendStatus(403);
    const metricName = name.replace(/[^a-zA-Z0-9_]/g, "_");
    const lines = [
      "# HELP mcp_server_uptime_seconds Seconds since the MCP server started",
      "# TYPE mcp_server_uptime_seconds gauge",
      `mcp_server_uptime_seconds{server="${metricName}",version="${version}"} ${Math.floor((Date.now() - started) / 1000)}`,
      "# HELP mcp_server_requests_total MCP requests by HTTP status",
      "# TYPE mcp_server_requests_total counter",
      ...[...counters].map(([status, count]) => `mcp_server_requests_total{server="${metricName}",status="${status}"} ${count}`),
      "",
    ];
    res.type("text/plain; version=0.0.4").send(lines.join("\n"));
  });
  app.post("/mcp", async (req, res) => {
    const count = () => counters.set(res.statusCode, (counters.get(res.statusCode) || 0) + 1);
    res.once("finish", count);
    let identity;
    try { identity = await authenticate(req); }
    catch (error) { logger.error(`[${name}] auth error:`, error); return res.status(503).json(rpcError(-32603, "authentication unavailable")); }
    if (!identity) return res.status(401).json(rpcError(-32001, "invalid or missing bearer token"));
    try {
      const server = buildServer(identity);
      const transport = transportFactory();
      res.once("close", () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error(`[${name}] request error:`, error);
      if (!res.headersSent) res.status(500).json(rpcError(-32603, "internal error"));
    }
  });
  const listener = listen ? app.listen(port, bind, () => {
    logger.log(`[${name}] on ${bind}:${port}`);
    if (onListen) Promise.resolve(onListen()).catch(error => logger.error(`[${name}] startup callback failed:`, error));
  }) : null;
  return { app, listener };
}

module.exports = { createServer, bearerFromEnv };
