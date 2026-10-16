import http from "node:http";

// A loopback MCP fixture proves authentication and native tool discovery.
export async function startMcpProbe(token) {
  const observed = new Set();
  const server = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    let body = "";
    for await (const chunk of req) body += chunk;
    const message = JSON.parse(body);
    observed.add(message.method);
    if (message.id === undefined) { res.writeHead(202).end(); return; }
    let result;
    if (message.method === "initialize") result = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "lakeside-probe", version: "1" } };
    else if (message.method === "tools/list") result = { tools: [{ name: "local_probe", description: "Read-only fixture", inputSchema: { type: "object", properties: {} } }] };
    else if (message.method === "tools/call") result = { content: [{ type: "text", text: "fixture connected" }] };
    else { res.writeHead(400).end(); return; }
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, observed, close: () => new Promise(resolve => server.close(resolve)) };
}
