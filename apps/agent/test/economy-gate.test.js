"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { ECONOMY_PATHS } = require("../lib/operator/blastradius");

test("money-moving areas are gated as economy changes", () => {
  for (const f of ["src/lib/governmentContracts/commands.ts", "src/lib/military/defenceFillEligibility.ts", "src/lib/bonds/issue.ts", "src/lib/commodities/realizedCommodityBasis.ts",
    "src/lib/trade/tariffs.ts", "src/lib/labour/wages.ts", "src/lib/logistics/sourcing.ts", "src/lib/moneySupply/qe.ts", "src/lib/turn/commodityPriceTurn.ts"])
    assert.ok(ECONOMY_PATHS.test(f), f);
  for (const f of ["src/components/corporation/DealsTab.tsx", "src/lib/commodity-map/colors.ts", "src/lib/scotus/careerEvents.ts"])
    assert.ok(!ECONOMY_PATHS.test(f), f);
});
