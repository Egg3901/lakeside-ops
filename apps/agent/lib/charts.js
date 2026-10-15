"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");
const { redactSecrets } = require("./text");

const TYPES = ["line", "bar", "area", "scatter", "pie", "histogram", "heatmap"];
// AHD chart house style: the same tokens as the Discord bot's charts
// (adhd-bot src/utils/viz/theme.ts), lifted from the game's own theme so a
// chart Keir posts reads as the same product as the site.
const SURFACE = { page: "#14141c", plot: "#1d1d2a", border: "#2a2a3d" };
const INK = { primary: "#e8e8ee", secondary: "#b4b4c2", muted: "#8f8f9d" };
const BRAND = { primary: "#dc2626" };
const AXIS = { grid: "rgba(232, 232, 238, 0.07)", baseline: "rgba(232, 232, 238, 0.22)" };
const FONT = { sans: "Geist", mono: "JetBrains Mono" };
// Colourblind-safe categorical order, validated against the plot surface. Never reorder.
const COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const LOGO = (() => { try { return fs.readFileSync(path.join(__dirname, "../assets/brand/ahd-logo.png")).toString("base64"); } catch { return null; } })();
const KEYS = new Set(["type", "title", "subtitle", "source", "x", "y", "value", "series", "xLabel", "yLabel", "xType", "orientation", "stacked", "illustrative", "data"]);
function label(value, name, max = 180, required = false) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) throw new Error(`${name} must be plain text, at most ${max} characters`);
  if (redactSecrets(value) !== value) throw new Error(`${name} contains a secret`);
  return value.trim();
}
function validate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("a chart object is required");
  for (const k of Object.keys(input)) if (!KEYS.has(k)) throw new Error(`unsupported chart option: ${k}`);
  if (!TYPES.includes(input.type)) throw new Error(`type must be ${TYPES.join(", ")}`);
  const s = { ...input, title: label(input.title, "title", 100, true), source: label(input.source, "source", 180, true) };
  for (const k of ["subtitle", "xLabel", "yLabel"]) s[k] = label(input[k], k, 100);
  for (const k of ["stacked", "illustrative"]) if (input[k] !== undefined && typeof input[k] !== "boolean") throw new Error(`${k} must be boolean`);
  if (input.orientation && !["horizontal", "vertical"].includes(input.orientation)) throw new Error("invalid orientation");
  if (input.xType && !["quantitative", "temporal", "ordinal"].includes(input.xType)) throw new Error("invalid xType");
  if (!Array.isArray(s.data) || !s.data.length || s.data.length > 1500) throw new Error("provide 1 to 1500 data rows; aggregate larger results first");
  const fields = [...new Set(s.data.flatMap((r) => r && typeof r === "object" && !Array.isArray(r) ? Object.keys(r) : []))];
  if (!fields.length || fields.length > 8 || fields.some((k) => !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k))) throw new Error("use at most eight simple column names");
  for (const row of s.data) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("each data row must be an object");
    for (const v of Object.values(row)) {
      if (v !== null && typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") throw new Error("data cells must be primitive values or null");
      if (typeof v === "number" && (!Number.isFinite(v) || Math.abs(v) > 1e16)) throw new Error("data numbers must be finite and bounded");
      if (typeof v === "string") label(v, "data text", 100, true);
    }
  }
  for (const k of ["x", "y", "value", "series"]) {
    if (s[k] !== undefined && (typeof s[k] !== "string" || !fields.includes(s[k]))) throw new Error(`${k} must name a data column`);
  }
  if (!s.x || (s.type !== "histogram" && !s.y) || (s.type === "heatmap" && !s.value)) throw new Error("x and y columns are required (histogram needs x; heatmap also needs value)");
  const numeric = [s.type === "histogram" || s.type === "scatter" ? s.x : null, s.type !== "heatmap" && s.type !== "histogram" ? s.y : null, s.value].filter(Boolean);
  for (const f of numeric) {
    if (!s.data.some((r) => typeof r[f] === "number")) throw new Error(`${f} needs numeric observations`);
    if (s.data.some((r) => r[f] != null && typeof r[f] !== "number")) throw new Error(`${f} must contain numbers or null`);
  }
  const groups = [...new Set(s.data.map((r) => r[s.type === "pie" ? s.x : s.series || s.x]).filter((v) => v != null))];
  if ((s.series || s.type === "pie") && groups.length > 8) throw new Error("use at most eight series or pie categories");
  if (s.series && s.data.some((r) => r[s.series] == null)) throw new Error("each row needs its series label");
  if (s.type === "pie" && (s.data.some((r) => r[s.y] < 0) || s.data.reduce((sum, r) => sum + (r[s.y] || 0), 0) <= 0)) throw new Error("pie values must be nonnegative with a positive total");
  if (s.xType === "temporal" && s.data.some((r) => r[s.x] != null && (typeof r[s.x] !== "string" || !/^\d{4}-\d\d-\d\d(?:T|$)/.test(r[s.x]) || !Number.isFinite(Date.parse(r[s.x]))))) throw new Error("temporal x values must be ISO dates");
  return s;
}

function csv(s) {
  const fields = [...new Set(s.data.flatMap(Object.keys))];
  const cell = (v) => {
    let t = v == null ? "" : String(v);
    // Prevent spreadsheet formula execution in exported text, preserving numbers.
    if (typeof v === "string" && /^[\s]*[=+@-]/.test(t)) t = "'" + t;
    return `"${t.replace(/"/g, '""')}"`;
  };
  return [fields.map(cell).join(","), ...s.data.map((r) => fields.map((f) => cell(r[f])).join(","))].join("\r\n") + "\r\n";
}

function spec(s) {
  const xt = s.xType || (["bar", "pie", "heatmap"].includes(s.type) ? "ordinal" : typeof s.data.find((r) => r[s.x] != null)?.[s.x] === "number" ? "quantitative" : "ordinal");
  const x = { field: s.x, type: xt, title: s.xLabel || s.x, axis: { labelLimit: 110, labelOverlap: true }, scale: { zero: false } };
  if (xt === "quantitative" && s.data.every((r) => r[s.x] == null || Number.isInteger(r[s.x]))) x.axis.tickMinStep = 1;
  const y = { field: s.y, type: "quantitative", title: s.yLabel || s.y, scale: { zero: ["bar", "area"].includes(s.type) }, stack: s.stacked ? "zero" : null };
  const encoding = { x, y };
  let mark = { type: s.type === "scatter" ? "point" : s.type, color: COLORS[0] };
  if (s.series) encoding.color = { field: s.series, type: "nominal", scale: { range: COLORS }, legend: { title: null, orient: "bottom", columns: 3, labelLimit: 160 } };
  if (s.type === "line") mark = { ...mark, point: true, strokeWidth: 2.5, invalid: "break-paths-show-domains" };
  if (s.type === "area") mark = { ...mark, opacity: 0.65, line: true, invalid: "break-paths-show-domains" };
  if (s.type === "scatter") mark = { ...mark, filled: true, opacity: 0.8, size: 65 };
  if (s.type === "bar") {
    delete x.scale;
    if (s.orientation === "horizontal") { encoding.x = { ...y, axis: { labelOverlap: true } }; encoding.y = { ...x }; }
    if (s.series && !s.stacked) encoding[s.orientation === "horizontal" ? "yOffset" : "xOffset"] = { field: s.series };
  }
  if (s.type === "pie") {
    delete encoding.x; delete encoding.y;
    encoding.theta = { field: s.y, type: "quantitative", stack: true };
    encoding.color = { field: s.x, type: "nominal", scale: { range: COLORS }, legend: { title: null, orient: "bottom", columns: 3 } };
    mark = { type: "arc", innerRadius: 60, stroke: "#1d1d2a", strokeWidth: 2 };
  }
  if (s.type === "histogram") {
    mark = { type: "bar", color: COLORS[0] };
    encoding.x = { ...x, type: "quantitative", bin: { maxbins: 20 }, scale: { zero: false } };
    encoding.y = { aggregate: "count", type: "quantitative", title: s.yLabel || "Count" };
  }
  if (s.type === "heatmap") {
    mark = { type: "rect" };
    encoding.x = { ...x, type: "ordinal" }; delete encoding.x.scale;
    encoding.y = { field: s.y, type: "ordinal", title: s.yLabel || s.y };
    encoding.color = { field: s.value, type: "quantitative", scale: { scheme: "blues" }, legend: { title: s.value } };
  }
  return {
    width: 600, height: 300, padding: { left: 6, right: 12, top: 10, bottom: 6 }, background: SURFACE.plot,
    data: { values: s.data }, mark, encoding,
    // Only histogram null observations are omitted. Line gaps stay gaps.
    ...(s.type === "histogram" ? { transform: [{ filter: { field: s.x, valid: true } }] } : {}),
    config: {
      font: FONT.sans, view: { fill: SURFACE.plot, stroke: null },
      axis: { labelColor: INK.secondary, labelFont: FONT.mono, titleColor: INK.secondary, titleFont: FONT.sans, titleFontWeight: 500,
        gridColor: AXIS.grid, domainColor: AXIS.baseline, tickColor: AXIS.baseline, labelFontSize: 11, titleFontSize: 11.5, titlePadding: 10 },
      axisX: { grid: false }, axisY: { domain: false, ticks: false },
      legend: { labelColor: INK.primary, labelFont: FONT.sans, titleColor: INK.secondary, labelFontSize: 11.5, symbolType: "circle" },
      range: { category: COLORS },
    },
  };
}
// The house card: graphite page, red accent rule beside the title, the AHD
// badge top right, the chart on a rounded plot surface, source and site below.
function card(s, plot, pw, ph) {
  const padX = 20, padTop = 18, mark = 26;
  const subtitle = [s.subtitle, s.illustrative ? "Illustrative example, not live game data" : null].filter(Boolean).join(" · ");
  const headerH = subtitle ? 50 : 32, gap = 14;
  const footer = [s.source.slice(0, 96), s.source.slice(96, 192)].filter(Boolean);
  const footerH = 14 + footer.length * 15;
  const w = pw + padX * 2, plotY = padTop + headerH + gap, h = plotY + ph + 12 + footerH;
  const inner = plot.replace(/^<svg/, `<svg x="${padX}" y="${plotY}"`);
  const t = (x, y, size, color, text, extra = "") => `<text x="${x}" y="${y}" fill="${color}" font-family="${FONT.sans}" font-size="${size}" ${extra}>${escapeXml(text)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<rect width="${w}" height="${h}" rx="10" fill="${SURFACE.page}"/>`
    + `<rect x="${padX}" y="${padTop + 2}" width="3" height="${subtitle ? 38 : 22}" rx="1.5" fill="${BRAND.primary}"/>`
    + t(padX + 12, padTop + 18, 19, INK.primary, s.title, 'font-weight="600"')
    + (subtitle ? t(padX + 12, padTop + 38, 12.5, INK.secondary, subtitle) : "")
    + (LOGO ? `<clipPath id="ahdmark"><circle cx="${w - padX - mark / 2}" cy="${padTop + mark / 2}" r="${mark / 2}"/></clipPath><image x="${w - padX - mark}" y="${padTop}" width="${mark}" height="${mark}" clip-path="url(#ahdmark)" href="data:image/png;base64,${LOGO}" xlink:href="data:image/png;base64,${LOGO}"/>` : "")
    + `<rect x="${padX - 1}" y="${plotY - 1}" width="${pw + 2}" height="${ph + 2}" rx="8" fill="${SURFACE.plot}" stroke="${SURFACE.border}"/>`
    + inner
    + footer.map((line, i) => t(padX, plotY + ph + 24 + i * 15, 10.5, INK.muted, i === 0 ? `Source: ${line}` : line)).join("")
    + t(w - padX, h - 12, 10.5, INK.muted, "ahousedividedgame.com", 'text-anchor="end"')
    + `</svg>`;
}
const escapeXml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
let rendering = false;
async function render(input) {
  const s = validate(input);
  if (rendering) throw Object.assign(new Error("another chart is rendering; try again shortly"), { status: 429 });
  rendering = true;
  let view;
  try {
    const [vl, vega] = await Promise.all([import("vega-lite"), import("vega")]);
    view = new vega.View(vega.parse(vl.compile(spec(s)).spec), { renderer: "none" });
    const plot = await view.toSVG();
    const pw = Number(plot.match(/<svg[^>]*width="([\d.]+)"/)[1]);
    const ph = Number(plot.match(/<svg[^>]*height="([\d.]+)"/)[1]);
    const svg = card(s, plot, pw, ph);
    const png = await sharp(Buffer.from(svg), { density: 144, limitInputPixels: 8_000_000 }).png({ compressionLevel: 3 }).toBuffer();
    if (png.length > 8 << 20) throw new Error("chart image is too large");
    return { png, svg, csv: csv(s), title: s.title, source: s.source, description: `${s.type} chart: ${s.title}. ${s.data.length} observations. Source: ${s.source}${s.illustrative ? ". Illustrative example." : ""}`, rows: s.data.length };
  } finally { view?.finalize(); rendering = false; }
}

function save(session, chart) {
  const id = crypto.randomBytes(8).toString("hex");
  const dir = path.join(session.dir, "charts");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const name = `keir-${id}`;
  for (const [ext, data] of [["png", chart.png], ["svg", chart.svg], ["csv", chart.csv]]) fs.writeFileSync(path.join(dir, `${name}.${ext}`), data, { mode: 0o600 });
  return { id, fileName: `${name}.png`, path: path.join(dir, `${name}.png`), title: chart.title, source: chart.source, description: chart.description, rows: chart.rows };
}

module.exports = { validate, csv, spec, render, save, TYPES };
