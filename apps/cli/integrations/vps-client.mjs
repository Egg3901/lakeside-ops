// @ts-check
// Bounded Streamable HTTP MCP client for the configured VPS. Never persists
// remote text or tokens. Used by discovery and the studio panels.

/**
 * @param {{ url: string, headers: Record<string, string>, fetchImpl?: typeof fetch, signal: AbortSignal, maxBytes?: number }} options
 */
export function openVpsClient({ url, headers, fetchImpl = fetch, signal, maxBytes = 1024 * 1024 }) {
  /** @type {string | undefined} */
  let session;
  let protocol = "2025-06-18", id = 0;
    /** @param {string} method @param {object} [params] @param {boolean} [notification] @returns {Promise<any>} */
  async function request(method, params, notification = false) {
    const requestId = notification ? undefined : ++id;
    const response = await fetchImpl(url, { method: "POST", headers: { ...headers, ...(session ? { "Mcp-Session-Id": session } : {}), ...(method !== "initialize" ? { "MCP-Protocol-Version": protocol } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id: requestId }), method, ...(params ? { params } : {}) }), redirect: "error", signal: signal });
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
        if (size > maxBytes) throw Error("MCP response exceeds limit");
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
  /** @param {any} message */
  function result(message) {
    if (message.error || !message.result || message.result.isError) throw Error("MCP capability unavailable");
    return message.result;
  }
  /** @param {string} clientName */
  async function initialize(clientName) {
    const initialized = await request("initialize", { protocolVersion: protocol, capabilities: {}, clientInfo: { name: clientName, version: "1" } });
    protocol = initialized.protocolVersion || protocol;
    await request("notifications/initialized", undefined, true);
    return initialized;
  }
  return { request, initialize };
}

/** Headers and endpoint for a loaded VPS profile and its token. @param {any} profile @param {string} token */
export function vpsEndpoint(profile, token) {
  return {
    url: profile.kind === "keir" ? `${profile.origin}/api/keir/app/desktop/mcp` : profile.origin,
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(profile.auth === "cookie" ? { Cookie: `${profile.cookieName}=${token}` } : { Authorization: `Bearer ${token}` }) },
  };
}
