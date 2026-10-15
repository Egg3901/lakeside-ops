"use strict";

const METRICS = [
  ["approval", "Government approval", "%"],
  ["economic.gdp", "GDP", "millions of local currency"],
  ["population.population", "Population", "people"],
];

function buildRegionalTelemetry({ states, approvals, macros, fromTurn = 1, toTurn }) {
  const regions = new Map();
  for (const state of states) {
    const country = String(state.countryId || "");
    const region = String(state._id || "");
    if (country && region) regions.set(`${country}\0${region}`, { country, region });
  }
  const rows = [
    ...approvals.map((row) => ({ ...row, metric: "approval", value: row.approval })),
    ...macros,
  ];
  const bySeries = new Map();
  for (const row of rows) {
    if (row.region == null || !METRICS.some(([metric]) => metric === row.metric)) continue;
    const country = String(row.country || "");
    const region = String(row.region || "");
    if (!country || !region) continue;
    const key = `${country}\0${region}`;
    if (!regions.has(key)) regions.set(key, { country, region });
    const seriesKey = `${key}\0${row.metric}`;
    if (!bySeries.has(seriesKey)) bySeries.set(seriesKey, []);
    bySeries.get(seriesKey).push(row);
  }
  return [...regions.values()].sort((a, b) => a.country.localeCompare(b.country) || a.region.localeCompare(b.region)).map(({ country, region }) => {
    const series = {};
    for (const [metric, label, defaultUnit] of METRICS) {
      const source = bySeries.get(`${country}\0${region}\0${metric}`) || [];
      const values = new Map();
      const provenance = new Set();
      for (const row of source) {
        if (!Number.isInteger(row.turn) || row.turn < fromTurn || row.turn > toTurn || !Number.isFinite(row.value)) continue;
        values.set(row.turn, {
          turn: row.turn, year: Number.isFinite(row.year) ? row.year : null,
          foundingTurn: row.foundingTurn === true, value: row.value,
        });
        provenance.add(JSON.stringify({
          runId: row.runId || null, sourceClass: row.sourceClass || null, codeVersion: row.codeVersion || null,
          worldId: row.worldId || null, retentionPolicy: row.retentionPolicy || null,
          retentionVersion: row.retentionVersion ?? null, schemaVersion: row.schemaVersion ?? null,
          calcVersion: row.calcVersion ?? null, units: row.units || defaultUnit,
        }));
      }
      const points = [...values.values()].sort((a, b) => a.turn - b.turn);
      const segmentStartTurns = points.filter((point, index) => index === 0 || point.turn > points[index - 1].turn + 1).map((point) => point.turn);
      const missingTurns = [];
      for (let turn = fromTurn; turn <= toTurn; turn += 1) {
        if (!values.has(turn)) missingTurns.push(turn);
      }
      const commonProvenance = provenance.size === 1 ? JSON.parse([...provenance][0]) : null;
      const required = ["runId", "sourceClass", "codeVersion", "worldId", "retentionPolicy", "retentionVersion", "schemaVersion", "calcVersion"];
      series[metric] = {
        label, units: defaultUnit, points, segmentStartTurns,
        coverage: {
          fromTurn, toTurn, observedPoints: points.length, firstObservedTurn: points[0]?.turn ?? null,
          lastObservedTurn: points.at(-1)?.turn ?? null, missingTurns,
        },
        provenance: commonProvenance,
        provenanceStatus: provenance.size === 0 ? "missing"
          : provenance.size > 1 ? "mixed"
            : required.every((field) => commonProvenance[field] !== null) ? "consistent" : "incomplete",
      };
    }
    return { country, region, series };
  });
}

function renderRegionalReport({ title, runId, sourceRevision, effectiveManifest, updated, regions, qualification = null }) {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
  const json = JSON.stringify(regions).replace(/</g, "\\u003c");
  const manifest = JSON.stringify(effectiveManifest || {}).replace(/</g, "\\u003c");
  const qualificationJson = JSON.stringify(qualification).replace(/</g, "\\u003c");
  const run = JSON.stringify(runId).replace(/</g, "\\u003c");
  const revision = JSON.stringify(sourceRevision).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · regional telemetry</title><style>
body{font:15px/1.5 system-ui,sans-serif;color:#eef6ff;background:#07111f;margin:auto;max-width:1100px;padding:24px}a{color:#72e6ea}select,button{font:inherit;padding:8px;background:#0e1c2f;color:#eef6ff;border:1px solid #43607e;border-radius:6px}article{background:#0e1c2f;border:1px solid #20334b;border-radius:9px;padding:16px;margin:14px 0}svg{width:100%;height:170px;background:#091625}table{width:100%;border-collapse:collapse}td,th{text-align:left;border-bottom:1px solid #20334b;padding:6px}code{overflow-wrap:anywhere}.muted{color:#aebed0}.missing{color:#ffc26b}pre{white-space:pre-wrap;overflow-wrap:anywhere}#detail{min-height:3em}
</style></head><body><main><p><a href="/reports">Reports</a></p><h1>${esc(title)} · regional trajectories</h1><p class="muted">Sanitized observed sandbox points. GDP is stored in millions of local currency. Missing turns stay missing; the bounded game-page history is not substituted. Founding turns retain their frozen in-game year.</p><p>Run <code>${esc(runId)}</code> · source <code>${esc(sourceRevision)}</code> · generated ${esc(updated)}</p><p>${qualification?.passing ? "Complete attributed regional approval, observed GDP and population telemetry." : "Not qualifying: " + esc(qualification?.reasons?.join("; ") || "No verified qualification envelope")}</p><p class="muted">Telemetry scope only, not an overall world or release pass.</p><details><summary>Source, seed, actor configuration and qualification</summary><pre>${esc(JSON.stringify(qualification, null, 2))}</pre></details><label>Country and region <select id="region"></select></label><button id="download" type="button">Download selected region JSON</button><div id="charts"></div><details><summary>Effective feature manifest</summary><pre id="manifest"></pre></details></main><script id="qualification-data" type="application/json">${qualificationJson}</script><script id="data" type="application/json">${json}</script><script id="manifest-data" type="application/json">${manifest}</script><script>
(()=>{const regions=JSON.parse(document.getElementById('data').textContent),manifest=JSON.parse(document.getElementById('manifest-data').textContent),select=document.getElementById('region'),container=document.getElementById('charts');document.getElementById('manifest').textContent=JSON.stringify(manifest,null,2);for(const row of regions){const option=document.createElement('option');option.value=row.country+'\\0'+row.region;option.textContent=row.country+' · '+row.region;select.append(option)}function render(){const row=regions.find(item=>item.country+'\\0'+item.region===select.value);container.replaceChildren();if(!row)return;for(const metric of ['approval','economic.gdp','population.population']){const series=row.series[metric],article=document.createElement('article'),heading=document.createElement('h2'),summary=document.createElement('p'),plot=document.createElementNS('http://www.w3.org/2000/svg','svg'),detail=document.createElement('p'),provenance=document.createElement('p');heading.textContent=series.label+' ('+series.units+')';summary.className=series.coverage.missingTurns.length?'missing':'muted';summary.textContent=series.coverage.observedPoints+' observed points, '+series.coverage.firstObservedTurn+'–'+series.coverage.lastObservedTurn+'; missing raw turns: '+(series.coverage.missingTurns.join(', ')||'none');const points=series.points;if(points.length>1){const values=points.map(p=>p.value),min=Math.min(...values),max=Math.max(...values),first=points[0].turn,span=points.at(-1).turn-first||1,range=max-min||1;plot.setAttribute('viewBox','0 0 100 100');const segments=[];for(const point of points){if(series.segmentStartTurns.includes(point.turn))segments.push([]);segments.at(-1).push(point)}for(const segment of segments){const path=document.createElementNS('http://www.w3.org/2000/svg','polyline');path.setAttribute('points',segment.map(p=>(5+(p.turn-first)/span*90)+','+(92-(p.value-min)/range*80)).join(' '));path.setAttribute('fill','none');path.setAttribute('stroke','#39d4d8');path.setAttribute('stroke-width','1.7');plot.append(path)}plot.addEventListener('pointermove',event=>{const rect=plot.getBoundingClientRect(),turn=first+(event.clientX-rect.left)/rect.width*span,nearest=points.reduce((a,b)=>Math.abs(b.turn-turn)<Math.abs(a.turn-turn)?b:a);detail.textContent='Raw turn '+nearest.turn+' · year '+(nearest.year??'?')+(nearest.foundingTurn?' · founding election':'')+' · '+nearest.value+' '+series.units})}else{detail.textContent='Not enough observed points to chart'}provenance.className='muted';provenance.textContent='Provenance: '+series.provenanceStatus+' · '+JSON.stringify(series.provenance);article.append(heading,summary,plot,detail,provenance);container.append(article)}}select.addEventListener('change',render);document.getElementById('download').addEventListener('click',()=>{const row=regions.find(item=>item.country+'\\0'+item.region===select.value);if(!row)return;const url=URL.createObjectURL(new Blob([JSON.stringify({runId:${run},sourceRevision:${revision},effectiveManifest:manifest,qualification:JSON.parse(document.getElementById("qualification-data").textContent),...row},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='regional-telemetry-'+row.country+'-'+row.region+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});render()})();
</script></body></html>`;
}

module.exports = { buildRegionalTelemetry, renderRegionalReport };
