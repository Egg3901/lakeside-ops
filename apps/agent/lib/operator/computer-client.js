"use strict";
// Speaks OpenMuse's browser-worker protocol. Only the operator holds this
// credential; the iOS app stays on its authenticated Keir app channel.
function createComputerClient({ url, token, fetchImpl = fetch }) {
  if (!url || !token) return null;
  const base = new URL(url);
  if (!/^https?:$/.test(base.protocol) || base.username || base.password) throw new Error("invalid computer worker URL");
  async function request(path, body, signal, image = false) {
    const r = await fetchImpl(new URL(path, base), { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000) });
    if (!r.ok) {
      const error = await r.json().catch(() => ({}));
      throw Object.assign(new Error(error.error?.message || "Computer worker is unavailable"), { status: r.status >= 500 ? 503 : r.status });
    }
    const data = Buffer.from(await r.arrayBuffer());
    if (data.length > (image ? 3 * 1024 * 1024 : 200000)) throw new Error("computer response exceeded its limit");
    return image ? data : JSON.parse(data.toString());
  }
  const valid = (id) => { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("invalid browser session"); return id; };
  return {
    open: (id, url, signal) => request("/sessions", { id: valid(id), url }, signal),
    navigate: (id, url, signal) => request(`/sessions/${valid(id)}/navigate`, { url }, signal),
    input: (id, input, signal) => request(`/sessions/${valid(id)}/input`, input, signal),
    read: (id, signal) => request(`/sessions/${valid(id)}/read`, null, signal),
    screenshot: (id, signal) => request(`/sessions/${valid(id)}/screenshot`, null, signal, true),
    close: (id, signal) => request(`/sessions/${valid(id)}/close`, {}, signal),
    delete: (id, signal) => request(`/sessions/${valid(id)}/delete`, {}, signal),
  };
}
module.exports = { createComputerClient };
