// @ts-check
import http from "node:http";
import crypto from "node:crypto";

/** @param {ReturnType<import('./runtime.mjs').createNativeRuntime>} runtime */
export async function serveNative(runtime) {
  const token = crypto.randomBytes(32).toString("hex");
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const authorization = req.headers.authorization;
    if (authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
    try {
      if (req.method === "GET" && req.url === "/state") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(runtime.snapshot())); return; }
      if (req.method !== "POST" || !["/prompt", "/permission", "/cancel"].includes(req.url || "")) { res.writeHead(404).end(); return; }
      let text = "";
      for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 256000) throw new Error("Request too large"); }
      const body = JSON.parse(text || "{}");
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Expected an object");
      let result;
      if (req.url === "/prompt") {
        if (typeof body.text !== "string" || typeof body.id !== "string") throw new Error("Prompt needs text and a durable id");
        result = await runtime.submit(body.text, body.id);
      } else if (req.url === "/permission") {
        if (typeof body.id !== "string" || !(body.option === null || typeof body.option === "string")) throw new Error("Invalid permission selection");
        runtime.permission(body.id, body.option); result = { selected: true };
      } else result = await runtime.cancel();
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Native request failed" }));
    }
  });
  server.requestTimeout = 10000;
  await new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Native bridge did not bind a loopback port");
  return { url: `http://127.0.0.1:${address.port}`, token, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
