"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../lib/operator/broker.js"), "utf8");
const JARGON = new Function(`return ${/const JARGON = (\/.*\/);/.exec(src)[1]}`)();

test("engine jargon and code names are caught, plain player words are not", () => {
  for (const bad of ["The fix adds growth headroom at 50% sell-through.", "Your reachable book is served.", "Live in turn processing as of turn 264.", "SHORTAGE_RELAXED_FILL is now 0.5.", "the demandThrottle eased", "the NPP market maker"])
    assert.ok(JARGON.test(bad), bad);
  for (const ok of ["Your mine sells only inside the US, and the US already has all the iron it needs.", "The change is live from the next turn.", "Your plant ran at 40% of its capacity last turn because it was short of steel."])
    assert.ok(!JARGON.test(ok), ok);
});
