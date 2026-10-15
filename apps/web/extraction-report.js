// extraction-report.js — renders the extraction-capacity remediation report
// (live per-state audit from extraction-audit.js + the plan phases) for the ops dash.
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function n(x) { return Number(x || 0).toLocaleString(); }
function pctStr(f) { return f == null ? "—" : `${((f - 1) * 100).toFixed(0)}%`; }

const VERDICT_COLOR = { "re-strategize": "#2f9e59", "place-sectors": "#3987e5", "bump-capacity": "#e0824a", ok: "var(--text-3)" };

const EXR_CSS = `
.exr-wrap{max-width:1080px;margin:0 auto;padding:var(--s-5,20px) var(--s-4,16px) 64px}
.exr-h{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 14px;margin-bottom:4px}
.exr-h h1{font-size:1.4rem;font-weight:700;margin:0}
.exr-sub{color:var(--text-3);font-size:.82rem;font-family:var(--mono,monospace)}
.exr-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:18px 0 24px}
.exr-tile{border:1px solid var(--border);border-radius:14px;background:var(--surface);padding:13px 15px}
.exr-tile .k{font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text-3)}
.exr-tile .v{font-size:1.4rem;font-weight:750;margin-top:2px;font-variant-numeric:tabular-nums}
.exr-tile .d{font-size:.74rem;color:var(--text-3);margin-top:2px}
.exr-tile.alert{border-color:color-mix(in srgb,#e5484d 40%,var(--border))}
.exr-card{border:1px solid var(--border);border-radius:14px;background:var(--surface);overflow:hidden;margin:16px 0}
.exr-card h2{font-size:.82rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-2);margin:0;padding:13px 16px 9px}
table.exr{width:100%;border-collapse:collapse;font-size:.84rem}
table.exr th,table.exr td{padding:7px 14px;text-align:right;border-top:1px solid var(--border);white-space:nowrap}
table.exr th{font-size:.66rem;text-transform:uppercase;letter-spacing:.04em;color:var(--text-3);font-weight:600;border-top:none}
table.exr td:first-child,table.exr th:first-child{text-align:left;font-family:var(--mono,monospace)}
table.exr td{font-variant-numeric:tabular-nums}
.verdict{font-weight:700;font-size:.78rem}
.short{color:#ff8a8a}
.exr-tgt{padding:2px 16px 14px;font-size:.8rem;color:var(--text-2);line-height:1.7}
.exr-tgt b{color:var(--text)}
.exr-tgt .states{font-family:var(--mono,monospace);font-size:.76rem;color:var(--text-3)}
.exr-phase{border:1px solid var(--border);border-radius:12px;background:var(--bg-1,var(--surface));padding:13px 16px;margin-bottom:10px}
.exr-phase h3{font-size:.9rem;font-weight:700;margin:0 0 4px}
.exr-phase p{font-size:.84rem;color:var(--text-2);margin:0;line-height:1.55}
.exr-phase .tag{font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:1px 7px;border-radius:999px;margin-left:6px;background:var(--glass-2,#222);color:var(--text-2)}
.exr-note{font-size:.78rem;color:var(--text-3);margin-top:18px;border-left:3px solid var(--border);padding-left:12px;line-height:1.6}
`;

function renderExtractionReport(audit) {
  const s = audit.summary;
  const tiles = [
    ["Rev-wtd utilization", s.revWeightedUtil ?? "—", `${s.capacityBoundPct}% capacity-bound`, false],
    ["Haircut now", pctStr(s.currentHaircutFactor), "on extraction revenue", false],
    ["Full-ramp (floored)", pctStr(s.flooredHaircutFactor), `vs ${pctStr(s.revWeightedUtil)} unfloored`, false],
    ["Insolvent miners", s.insolventCount, s.insolventCorps.slice(0, 3).join(", ") || "none", s.insolventCount > 0],
  ];
  const rows = audit.perResource.map((r) => {
    const vc = VERDICT_COLOR[r.verdict] || "var(--text-2)";
    return `<tr>
      <td>${esc(r.resource)}</td>
      <td class="${r.shortage ? "short" : ""}">${r.sd != null ? r.sd.toFixed(2) : "—"}</td>
      <td>${r.reachableUtilPct}%</td>
      <td>${r.idlePct}%</td>
      <td>${r.statesHit}/${r.statesHeadroom}/${r.statesIdle}</td>
      <td style="text-align:left"><span class="verdict" style="color:${vc}">${esc(r.verdict)}</span></td>
    </tr>`;
  }).join("");

  // targeting detail for shortage resources
  const tgt = audit.perResource.filter((r) => r.shortage).map((r) => {
    const t = r.targeting;
    const list = (arr, key) => arr.slice(0, 6).map((x) => `${x.state}${x[key] != null ? "(" + n(x[key]) + ")" : ""}`).join(", ") || "—";
    let lines = "";
    if (r.verdict === "re-strategize" || t.restrategize.length)
      lines += `<div><b>Re-strategize</b> (standard miners on headroom deposits → focused): <span class="states">${list(t.restrategize, "standardMiners")}</span></div>`;
    if (t.place.length)
      lines += `<div><b>Place sectors</b> (idle-deposit states, no miner): <span class="states">${list(t.place, "cap")}</span></div>`;
    if (t.bump.length)
      lines += `<div><b>Bump capacity</b> (maxed states, shortfall): <span class="states">${list(t.bump, "shortfall")}</span></div>`;
    return `<div class="exr-card"><h2>${esc(r.resource)} · S/D ${r.sd?.toFixed(2)} · ${esc(r.verdict)}</h2><div class="exr-tgt">${lines}</div></div>`;
  }).join("");

  const phases = [
    ["Phase 0 — Stabilize", "SHIPPING", "Haircut floor at 0.5 (PR #2673, open) caps the worst case at −50% instead of −93%; insolvency backstop for the 5 negative miners."],
    ["Phase 1 — Tap reachable headroom", "BUILD", "1a Auto strategy adoption (C3): convert broad-mix miners on headroom deposits to focused mining (copper/rare_earth/timber). 1b Directed placement: seed extraction into idle-deposit shortage states (stranded copper/rare_earth/coal capacity)."],
    ["Phase 2 — Per-state capacity", "BUILD", "Raise seeded capacity in genuinely-maxed states (iron 37/42 maxed; some coal/gas) and audit the reset preset so a fresh game is balanced per state."],
    ["Phase 3 — Glut guardrail", "GUARD", "Halt adoption/placement for any resource whose S/D passes ~1.2 so the correction can't overshoot shortage → glut."],
    ["Phase 4 — Observability", "LIVE", "This page is the live extraction-health panel; add threshold alerts (shortage <0.4 / glut >1.3, rising insolvencies)."],
    ["Phase 5 — Validation & rollout", "GATE", "Sandbox 240-turn sim (floor+C3 vs floor-only) before prod; staged flag rollout with S/D + oscillation rollback triggers."],
  ].map(([t, tag, p]) => `<div class="exr-phase"><h3>${esc(t)}<span class="tag">${esc(tag)}</span></h3><p>${esc(p)}</p></div>`).join("");

  const body = `<div class="exr-wrap">
    <div class="exr-h"><h1>⛏️ Extraction Capacity Remediation</h1><span class="exr-sub">live audit · turn ${audit.currentTurn} · ${esc(audit.generatedAt.slice(0, 16).replace("T", " "))} UTC</span></div>
    <p style="color:var(--text-2);font-size:.9rem;max-width:760px;margin:6px 0 0">Follow-up to <b>The 240-Turn Fuse</b>. Capacity is enforced <b>per state</b>, so the fix differs by commodity: re-strategize where reachable-state capacity is idle, place sectors into stranded deposits, and bump capacity only where states are genuinely maxed.</p>
    <div class="exr-tiles">${tiles.map((t) => `<div class="exr-tile${t[3] ? " alert" : ""}"><div class="k">${esc(t[0])}</div><div class="v">${esc(t[1])}</div><div class="d">${esc(t[2])}</div></div>`).join("")}</div>

    <div class="exr-card"><h2>Per-resource state (live)</h2><table class="exr"><thead><tr><th>Resource</th><th>S/D</th><th>Reach util</th><th>Idle cap</th><th>Maxed/Head/Idle states</th><th>Verdict</th></tr></thead><tbody>${rows}</tbody></table></div>

    <h2 style="font-size:1rem;margin:26px 0 10px">Fix targeting — shortage commodities</h2>
    ${tgt || '<p style="color:var(--text-3)">No commodities below the shortage threshold right now.</p>'}

    <h2 style="font-size:1rem;margin:26px 0 10px">Remediation phases</h2>
    ${phases}

    <div class="exr-note">Full plan: <code>docs/plans/2026-07-04-extraction-capacity-remediation.md</code>. Numbers are live from the game DB each load. "Reach util" = supplied ÷ capacity in states that already have a miner for the resource; "idle cap" = capacity in states with no such miner. Verdict picks the dominant lever per commodity; targeting lists the specific states.</div>
  </div>`;
  return { extraCss: EXR_CSS, body };
}

module.exports = { renderExtractionReport, EXR_CSS };
