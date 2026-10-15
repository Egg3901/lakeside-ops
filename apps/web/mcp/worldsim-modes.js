// Keep this capability list aligned with the game's MARKET_MODE_ORDER and the
// runWorld.ts --market-mode parser. This MCP is intentionally decoupled from
// the game repo, so the list must be updated when the CLI gains a new tier.
const MARKET_SYSTEM_MODES = Object.freeze([
  "off",
  "realization",
  "ledger",
  "clearing",
  "capital",
  "plants",
]);

function marketSystemModeSchema(z) {
  return z.enum(MARKET_SYSTEM_MODES);
}

module.exports = { MARKET_SYSTEM_MODES, marketSystemModeSchema };
