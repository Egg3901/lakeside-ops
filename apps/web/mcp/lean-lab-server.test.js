const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { getTsxBin } = require("./lean-lab-server");

describe("lean lab runner executable", () => {
  it("uses the checkout-local tsx binary and does not depend on service PATH", () => {
    const original = process.env.LEAN_LAB_TSX_BIN;
    delete process.env.LEAN_LAB_TSX_BIN;
    try {
      assert.equal(getTsxBin("/srv/game"), "/srv/game/node_modules/.bin/tsx");
    } finally {
      if (original === undefined) delete process.env.LEAN_LAB_TSX_BIN;
      else process.env.LEAN_LAB_TSX_BIN = original;
    }
  });
});
