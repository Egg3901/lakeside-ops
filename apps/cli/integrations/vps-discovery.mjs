import { loadVps, readVpsToken } from "../vps-profile.mjs";

// A bounded, read-only Streamable HTTP probe. Never persist remote text or tokens.
export async function discoverVps(env = process.env, { fetchImpl = fetch, timeoutMs = 8000, signal } = {}) {
  const started = Date.now(), controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(timeoutMs, 15000)));
  const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  let profile, session, protocol = "2025-06-18", id = 0;
  const clean = value => String(value).replace(/[\x00-\x1f\x7f-\x9f]/g, "").slice(0, 160);
  try {
    profile = loadVps(env);
    if (!profile) return { state: "unconfigured", next: "Run lakeside code vps connect --url HTTPS_ORIGIN --token-file LOCAL_FILE" };
    const token = readVpsToken(profile.tokenFile);
    const url = profile.kind === "keir" ? `${profile.origin}/api/keir/app/desktop/mcp` : profile.origin;
    const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(profile.auth === "cookie" ? { Cookie: `${profile.cookieName}=${token}` } : { Authorization: `Bearer ${token}` }) };
    async function request(method, params, notification = false) {
      const requestId = notification ? undefined : ++id;
      const response = await fetchImpl(url, { method: "POST", headers: { ...headers, ...(session ? { "Mcp-Session-Id": session } : {}), ...(method !== "initialize" ? { "MCP-Protocol-Version": protocol } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id: requestId }), method, ...(params ? { params } : {}) }), redirect: "error", signal: controller.signal });
      if (!response.ok) throw Object.assign(Error("MCP request failed"), { status: response.status });
      session = response.headers.get("mcp-session-id") || session;
      if (notification) { await response.body?.cancel(); return; }
      if (!response.body) throw Error("Missing MCP response");
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let text = "", size = 0;
      const sse = (response.headers.get("content-type") || "").includes("text/event-stream");
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1024 * 1024) throw Error("MCP response exceeds discovery limit");
          text += decoder.decode(value, { stream: true });
          if (sse) {
            text = text.replace(/\r\n/g, "\n");
            let boundary;
            while ((boundary = text.indexOf("\n\n")) !== -1) {
              const event = text.slice(0, boundary); text = text.slice(boundary + 2);
              const data = event.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
              if (!data) continue;
              const message = JSON.parse(data);
              if (message.id === requestId) return result(message);
            }
          }
        }
        if (sse) throw Error("Missing MCP event response");
        const message = JSON.parse(text + decoder.decode());
        if (message.id !== requestId) throw Error("Mismatched MCP response");
        return result(message);
      } finally { await reader.cancel().catch(() => {}); }
    }
    function result(message) {
      if (message.error || !message.result || message.result.isError) throw Error("MCP capability unavailable");
      return message.result;
    }
    const initialized = await request("initialize", { protocolVersion: protocol, capabilities: {}, clientInfo: { name: "keir-code-discovery", version: "1" } });
    protocol = initialized.protocolVersion || protocol;
    await request("notifications/initialized", undefined, true);
    const tools = [];
    let cursor, complete = false;
    for (let page = 0; page < 5; page++) {
      const listed = await request("tools/list", cursor ? { cursor } : {});
      if (!Array.isArray(listed.tools)) throw Error("Invalid MCP tool list");
      tools.push(...listed.tools.filter(tool => typeof tool?.name === "string").map(tool => clean(tool.name)).filter(Boolean));
      cursor = listed.nextCursor;
      if (!cursor) { complete = true; break; }
    }
    const report = { state: "connected", id: profile.id, kind: profile.kind, tools: [...new Set(tools)], discoveryComplete: complete, checkedAt: new Date().toISOString(), latencyMs: Date.now() - started };
    // Generic MCPs never receive Keir-specific calls.
    if (profile.kind === "keir" && tools.includes("vps_status")) {
      try {
        const status = await request("tools/call", { name: "vps_status", arguments: {} });
        const value = status.structuredContent || JSON.parse(status.content?.find(block => block.type === "text")?.text || "{}");
        report.services = Array.isArray(value.services) ? value.services.map(clean).slice(0, 100) : [];
        report.projects = Object.keys(value.projects || {}).map(clean).slice(0, 200);
        report.sentryConfigured = value.sentryConfigured === true;
        report.environmentValues = "redacted";
        report.productionWrites = false;
      } catch { report.details = "Gateway connected; project/service discovery unavailable. Call vps_status to retry."; }
    }
    return report;
  } catch (error) {
    const auth = error.status === 401 || error.status === 403;
    return { state: "offline", ...(profile ? { id: profile.id, kind: profile.kind } : {}), errorKind: auth ? "auth" : controller.signal.aborted ? "timeout" : "connection", next: auth ? "Refresh the credential in the configured token file, then run lakeside code vps status. The connection profile is retained." : "Check the server URL, token file and network, then run lakeside code vps status. Local coding remains available.", latencyMs: Date.now() - started };
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
