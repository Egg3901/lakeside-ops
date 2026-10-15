"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { HOST_HEALTH_CSS, hostHealthPanel } = require("./host-health-panel");

test("landing host panel is mobile safe and shows all three resources", () => {
  const html = hostHealthPanel();
  assert.match(html, /CPU/);
  assert.match(html, /Memory/);
  assert.match(html, /Disk/);
  assert.match(html, /\/api\/scheduler/);
  assert.match(HOST_HEALTH_CSS, /max-width:700px/);
});
