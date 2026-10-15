"use strict";

// Called only with Discord API responses. Archive failure must never change a
// successful action's receipt; discovery polling recovers retained messages.
function createObserver({ url = "http://127.0.0.1:9767", token, fetchImpl = fetch, log = console.log }) {
  return async (channelId, messages) => {
    if (!token || !messages.length) return;
    try {
      const r = await fetchImpl(`${url}/observe`, { method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ channelId, messages }), signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`archive HTTP ${r.status}`);
    } catch (e) { log(`conversation archive: ${e.message}`); }
  };
}
module.exports = { createObserver };
