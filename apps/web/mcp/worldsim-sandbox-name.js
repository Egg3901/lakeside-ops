"use strict";

function worldsimSandboxName(seed, runId, campaignEraPriceLevelEnabled) {
  if (typeof campaignEraPriceLevelEnabled !== "boolean") {
    return `ahd_sim_${seed}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  }
  // Matched campaign arms retain the same RNG seed but must never continue
  // one another's sandbox world. A UUID has 32 hex digits without hyphens;
  // the 20-character seed prefix keeps the Mongo name within 64 characters.
  return `ahd_sim_${seed.slice(0, 20)}_${runId.replace(/-/g, "")}`;
}

module.exports = { worldsimSandboxName };
