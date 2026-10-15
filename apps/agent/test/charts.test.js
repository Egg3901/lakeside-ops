"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const sharp = require("sharp"), charts = require("../lib/charts");
const base = { title: "Capacity & output", source: "Illustrative fixture", x: "turn", y: "capacity", data: [{ turn: 1, capacity: 12 }, { turn: 2, capacity: 18 }] };
test("all seven supported chart types render real PNGs with labelled sources", async () => {
  for (const type of charts.TYPES) {
    const s = { ...base, type };
    if (type === "pie") s.data = [{ turn: "Industry", capacity: 12 }, { turn: "Services", capacity: 18 }];
    if (type === "heatmap") { s.value = "amount"; s.data = [{ turn: "T1", capacity: "UK", amount: -2 }, { turn: "T2", capacity: "UK", amount: 5 }]; }
    const r = await charts.render(s), meta = await sharp(r.png).metadata();
    assert.equal(meta.format, "png", type); assert.ok(meta.width > 1000); assert.ok(meta.height > 500);
    assert.match(r.svg, /Illustrative fixture/); assert.match(r.svg, /ahousedividedgame.com/);
    assert.match(r.description, new RegExp(type));
  }
});
test("null line values stay gaps, signed scatter values survive, and CSV text cannot become formulas", async () => {
  const s = { ...base, type: "line", data: [{ turn: 1, capacity: -2 }, { turn: 2, capacity: null }, { turn: 3, capacity: 8 }] };
  const checked = charts.validate(s), spec = charts.spec(checked);
  assert.equal(spec.data.values[1].capacity, null); assert.equal(spec.mark.invalid, "break-paths-show-domains");
  assert.match(charts.csv(checked), /"1","-2"\r\n"2",""/);
  const text = charts.csv(charts.validate({ ...base, type: "bar", x: "category", data: [{ category: '=SUM(A1)', capacity: 1 }] }));
  assert.match(text, /'\=SUM\(A1\)/);
  await charts.render({ ...s, type: "scatter" });
});
test("unsafe or misleading chart specifications are rejected", () => {
  for (const overrides of [
    { url: "https://example.com" }, { expressions: "process.env" }, { data: [{ turn: 1, capacity: Infinity }] },
    { data: [{ turn: 1, capacity: { nested: 2 } }] }, { data: [] }, { title: '<script>\n' },
    { type: "pie", data: [{ turn: "A", capacity: -1 }] }, { type: "bar", series: "missing" },
    { data: Array(1501).fill(base.data[0]) }, { type: "line", series: "s", data: Array.from({ length: 9 }, (_, i) => ({ turn: i, capacity: i, s: `s${i}` })) },
  ]) assert.throws(() => charts.validate({ ...base, type: "line", ...overrides }));
  assert.throws(() => charts.validate({ ...base, type: "line", xType: "temporal" }));
});
test("bar baseline and explicit hypothetical labels remain visible", async () => {
  const s = charts.validate({ ...base, type: "bar", illustrative: true, orientation: "horizontal" });
  assert.equal(charts.spec(s).encoding.x.scale.zero, true);
  assert.match((await charts.render(s)).svg, /Illustrative example, not live game data/);
});
