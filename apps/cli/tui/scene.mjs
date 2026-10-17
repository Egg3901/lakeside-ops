// @ts-check
// The Lakeside mark as a small animated scene: a mountain range with snow and
// side lighting, a lake that reflects it with moving ripples, glints along the
// waterline and a few stars. Pure: frame(t) returns rows of colored runs, so it
// is testable and the renderer only maps color keys to the active theme.

const LEVELS = " ▁▂▃▄▅▆▇█";

/** Deterministic ridge height (in rows) for column x of width w. @param {number} x @param {number} w */
function ridge(x, w) {
  const peak = (/** @type {number} */ c, /** @type {number} */ h, /** @type {number} */ s) => {
    const d = Math.abs(x - c) / s;
    return d >= 1 ? 0 : h * Math.pow(1 - d, 1.15);
  };
  const base = Math.max(
    peak(w * 0.30, 5.7, w * 0.19),
    peak(w * 0.55, 4.6, w * 0.15),
    peak(w * 0.80, 3.1, w * 0.13),
    peak(w * 0.12, 2.2, w * 0.1),
  );
  // Small deterministic jaggedness so slopes read as rock, not a smooth curve.
  const rough = 0.28 * Math.sin(x * 1.7) + 0.18 * Math.sin(x * 3.1 + 1.3);
  return Math.max(0.35, base + (base > 0.8 ? rough : 0.1 * Math.sin(x * 0.9)));
}

/**
 * @param {number} t seconds since start (0 for a still frame)
 * @param {{ width?: number, sky?: number, mountain?: number, lake?: number }} [size]
 * @returns {{ ch: string, c: string }[][]} rows of cells; c is a palette key
 */
export function sceneCells(t, size = {}) {
  const w = size.width || 44, skyRows = size.sky ?? 1, mRows = size.mountain || 6, lakeRows = size.lake || 3;
  const heights = Array.from({ length: w }, (_, x) => ridge(x, w));
  const rows = [];
  for (let r = 0; r < skyRows; r++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      const star = (x * 37 + r * 11) % 23 === 0;
      const lit = star && Math.floor(t * 1.5 + x) % 4 !== 0;
      row.push(lit ? { ch: (x + r) % 3 ? "·" : "✦", c: "muted" } : { ch: " ", c: "muted" });
    }
    rows.push(row);
  }
  for (let r = 0; r < mRows; r++) {
    const row = [], floor = mRows - 1 - r;
    for (let x = 0; x < w; x++) {
      const h = heights[x], level = Math.max(0, Math.min(1, h - floor));
      const ch = LEVELS[Math.round(level * 8)];
      // Snow on the top cell of tall columns; the sunlit side faces left.
      const top = h - floor > 0 && h - floor <= 1.05;
      const sunlit = (heights[x + 1] ?? h) >= (heights[x - 1] ?? h);
      const c = ch === " " ? "dim" : top && h > 4.2 ? "text" : sunlit ? "primary" : "blue";
      row.push({ ch, c });
    }
    rows.push(row);
  }
  const shore = [];
  for (let x = 0; x < w; x++) {
    const glint = Math.floor(x + t * 3) % 11 === 0 || Math.floor(x * 1.3 - t * 2) % 17 === 0;
    shore.push(glint ? { ch: "━", c: "text" } : { ch: "━", c: "dim" });
  }
  rows.push(shore);
  for (let k = 0; k < lakeRows; k++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      // Reflection of the mountain row above the shore, shifted by a ripple.
      const shift = k === 0 ? 0 : Math.round(Math.sin(t * 1.6 + k * 1.9 + x * 0.35));
      const src = heights[Math.max(0, Math.min(w - 1, x + shift))];
      const depth = src - k * 1.6;
      const ch = depth > 1.1 ? "▓" : depth > 0.55 ? "▒" : depth > 0.15 ? "░" : Math.floor(x * 0.7 + t * 2 + k) % 9 === 0 ? "~" : " ";
      row.push({ ch, c: ch === "~" ? "dim" : k === 0 ? "blue" : "dim" });
    }
    rows.push(row);
  }
  return rows;
}

/** Merge equal-colored neighbors into runs for cheaper rendering. @param {{ ch: string, c: string }[][]} rows */
export function toRuns(rows) {
  return rows.map(row => row.reduce((/** @type {{ text: string, c: string }[]} */ runs, cell) => {
    const last = runs[runs.length - 1];
    if (last && last.c === cell.c) last.text += cell.ch; else runs.push({ text: cell.ch, c: cell.c });
    return runs;
  }, []));
}
