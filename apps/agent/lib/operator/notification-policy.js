"use strict";
// A monitor's inability to observe is not proof the monitored service failed.
// Episode counters and diagnostic payloads belong in Ops, not on the lock screen.
const crypto = require("node:crypto");
const SENSOR_GRACE_MS = 5 * 60000;
const SENSOR_REMINDER_MS = 60 * 60000;
function describeAlert(alert, data, now) {
  const raw = String(alert.content || "");
  const brace = raw.indexOf("{");
  let detail = null;
  if (brace >= 0) { try { detail = JSON.parse(raw.slice(brace)); } catch {} }
  const observation = detail?.incidentKey && data.operatorRoles?.observations?.[detail.incidentKey];
  if (detail?.status === "recovered" || observation?.recoveredAt) return { suppressed: true };
  if (/^sensor:/.test(detail?.incidentKey || "")) {
    const stable = detail.incidentKey.replace(/:\d+$/, "");
    const name = stable.slice("sensor:".length);
    const lastSuccess = Number(detail.lastSuccessAt) || observation?.at || alert.at;
    const duration = Math.max(0, now - lastSuccess);
    if (duration < SENSOR_GRACE_MS) return { pending: true };
    return { identity: stable, cooldown: SENSOR_REMINDER_MS, collapseId: `watchkeeper:${stable}`.slice(0, 64),
      text: `Monitoring is degraded: Watchkeeper has been unable to read ${name} for ${Math.max(5, Math.floor(duration / 60000))} minutes. Details are in Ops.` };
  }
  const text = (brace >= 0 ? raw.slice(0, brace) : raw).replace(/^Watchkeeper:\s*/i, "").trim();
  return { identity: alert.key, cooldown: 0, text: text || "Watchkeeper found an issue. Open Ops for details.", collapseId: crypto.createHash("sha256").update(alert.key).digest("hex").slice(0, 40) };
}
module.exports = { describeAlert, SENSOR_GRACE_MS, SENSOR_REMINDER_MS };
