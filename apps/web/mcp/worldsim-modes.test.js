const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");
const {
  MARKET_SYSTEM_MODES,
  marketSystemModeSchema,
} = require("./worldsim-modes");

describe("worldsim market mode capability", () => {
  it("preserves every mode supported by the runWorld CLI", () => {
    assert.deepEqual(MARKET_SYSTEM_MODES, [
      "off",
      "realization",
      "ledger",
      "clearing",
      "capital",
      "plants",
    ]);
    for (const mode of MARKET_SYSTEM_MODES) assert.equal(marketSystemModeSchema(z).parse(mode), mode);
  });

  it("accepts plants through the schema used by sim_run_world", () => {
    assert.equal(marketSystemModeSchema(z).parse("plants"), "plants");
  });

  it("rejects modes the runWorld CLI does not support", () => {
    for (const mode of ["wages", "full", "unknown", ""]) {
      assert.throws(() => marketSystemModeSchema(z).parse(mode), /Invalid enum value/);
    }
  });
});
