"use strict";

/**
 * Lift the Cold War situation-room world map out of the game repo into navair/worldMap.js.
 *
 * The asset is generated game-side (AHDGame _genmap.cjs) from public/geo/countries-110m.json;
 * this script only re-exports it as CommonJS so the ops dash can serve the identical SVG
 * rather than a lookalike. Run it again whenever the game regenerates its map.
 *
 *   node scripts/lift-coldwar-map.js [path-to-AHDGame]
 */

const fs = require("fs");
const path = require("path");

const repo = process.argv[2] || "/root/projects/AHDGame";
const src = path.join(repo, "src/app/world/conflicts/_coldwar/mapSvg.ts");

const ts = fs.readFileSync(src, "utf8");
const match = ts.match(/export const MAP_SVG = ("(?:[^"\\]|\\.)*");/);
if (!match) {
  console.error(`Could not find MAP_SVG in ${src}`);
  process.exit(1);
}
const svg = JSON.parse(match[1]);

const out = `"use strict";

/**
 * The Cold War situation-room world map, lifted verbatim from the game.
 *
 * Source: AHDGame src/app/world/conflicts/_coldwar/mapSvg.ts, generated there from the
 * app's own world geometry (public/geo/countries-110m.json) via topojson-client and
 * d3-geo's geoEquirectangular. The projection — and therefore every overlay coordinate
 * in navair/map.js — is:
 *
 *     lon -180..180  ->  x 0..1000
 *     lat   84..-58  ->  y 0..394.4
 *
 * Every country path carries data-name and data-bloc, so the board recolours by
 * alignment exactly the way the in-game situation boards do.
 *
 * DO NOT hand-edit. Re-lift with scripts/lift-coldwar-map.js.
 */

module.exports = { MAP_SVG: ${JSON.stringify(svg)} };
`;

fs.writeFileSync(path.join(__dirname, "..", "navair", "worldMap.js"), out);
console.log(`wrote navair/worldMap.js — ${svg.length} chars`);
