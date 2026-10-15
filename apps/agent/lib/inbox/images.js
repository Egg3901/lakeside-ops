"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const sharp = require("sharp");

// Turns whatever a player sends into something the screenshot check can read.
//  - HEIC/HEIF (iPhone) decode through ImageMagick + libheif; everything else
//    through sharp. EXIF rotation is applied.
//  - A tall phone screenshot is cut into overlapping tiles, because the model
//    sees images downscaled to roughly 1.5k px on the long edge and small
//    comment text would not survive one long strip.

const MAGICK_EXT = new Set(["heic", "heif"]);
// The model reads each image at up to about 1.15 megapixels; anything larger
// is downscaled again. Tiles are sized to stay inside that.
const MAX_TILE_RATIO = 1.2; // tile height / width
const OVERLAP = 0.12;
const MAX_TILES_PER_IMAGE = 6;
const PORTRAIT_WIDTH = 1000;
const LANDSCAPE_WIDTH = 1400;

function magickToPng(file) {
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/magick", [file, "-auto-orient", "png:-"], { encoding: "buffer", maxBuffer: 200 << 20, timeout: 60000 }, (err, stdout) => {
      if (err) reject(new Error(`could not decode ${path.extname(file)} image`)); else resolve(stdout);
    });
  });
}

/** A sharp pipeline for any supported file, already rotated upright. */
async function load(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const input = MAGICK_EXT.has(ext) ? await magickToPng(file) : fs.readFileSync(file);
  // Only the first frame of an animation matters.
  const png = await sharp(input, { animated: false, limitInputPixels: 1e9 }).rotate().png().toBuffer();
  return png;
}

/** Vision-ready JPEG tiles for one file. */
async function tiles(file) {
  const png = await load(file);
  const { width, height } = await sharp(png).metadata();
  const cap = width > height ? LANDSCAPE_WIDTH : PORTRAIT_WIDTH;
  const scale = width > cap ? cap / width : 1;
  const w = Math.round(width * scale), h = Math.round(height * scale);
  const base = await sharp(png).resize(w, h).toBuffer();
  const tileH = Math.round(w * MAX_TILE_RATIO);
  if (h <= tileH * 1.15) return [await sharp(base).jpeg({ quality: 88 }).toBuffer()];
  const step = Math.round(tileH * (1 - OVERLAP));
  let tops = [];
  for (let top = 0; top + tileH < h; top += step) tops.push(top);
  tops.push(h - tileH); // the last tile always reaches the bottom edge
  // Very long scrolls: spread the allowed tiles evenly from top to bottom.
  if (tops.length > MAX_TILES_PER_IMAGE) tops = Array.from({ length: MAX_TILES_PER_IMAGE }, (_, i) => Math.round(((h - tileH) * i) / (MAX_TILES_PER_IMAGE - 1)));
  const out = [];
  for (const top of tops) out.push(await sharp(base).extract({ left: 0, top, width: w, height: tileH }).jpeg({ quality: 88 }).toBuffer());
  return out;
}

module.exports = { tiles, load, MAX_TILES_PER_IMAGE };
