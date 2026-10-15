"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { RELEASE, makeDownloadPortal, releaseAsset } = require("./download-portal");

test("renders public desktop downloads for AHDClient 2.0.2", () => {
  const html = makeDownloadPortal();

  assert.match(html, /<title>Download AHDClient \| Lakeside Games<\/title>/);
  assert.match(html, /Windows/);
  assert.match(html, /macOS/);
  assert.match(html, /Linux/);
  assert.match(html, /AHDClient 2\.0\.2/);

  for (const filename of Object.values(RELEASE.assets)) {
    assert.ok(html.includes(releaseAsset(filename)), `missing release asset ${filename}`);
  }
});

test("uses public same-origin download URLs", () => {
  assert.equal(
    releaseAsset(RELEASE.assets.windows),
    "/downloads/AHDClient_2.0.2_x64-setup.exe",
  );
  assert.doesNotMatch(makeDownloadPortal(), /github\.com\/Egg3901\/AHDClient\/releases\/download/);
  assert.match(makeDownloadPortal(), /Legacy version 1\.0\.3/);
  assert.match(makeDownloadPortal(), /Version 2\.0\.0/);
  assert.match(makeDownloadPortal(), /historical world-building loader/);
});
