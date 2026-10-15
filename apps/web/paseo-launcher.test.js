const test = require("node:test");
const assert = require("node:assert");
const { modeFromInvalidModeError } = require("./paseo-launcher");

// A stale PASEO_REPAIR_MODE (opencode's "build") against the muse provider failed
// every create-agent on 2026-09-04, and the daemon keeps the workspace it minted
// for the rejected call, so each retry left a ghost row in the UI. The retry now
// re-picks from the modes the daemon named instead of dropping --mode.
test("picks the most permissive mode the daemon offers", () => {
  assert.equal(
    modeFromInvalidModeError("Invalid mode 'build' for provider 'muse'. Available modes: sandboxed, trusted, yolo"),
    "yolo"
  );
  assert.equal(
    modeFromInvalidModeError("Invalid mode 'bypass' for provider 'cursor'. Available modes: agent, plan, ask"),
    "agent"
  );
  assert.equal(
    modeFromInvalidModeError("Invalid mode 'yolo' for provider 'codex'. Available modes: default, auto-review, full-access"),
    "full-access"
  );
});

test("falls back to the provider default when no offered mode is permissive", () => {
  assert.equal(modeFromInvalidModeError("Invalid mode 'yolo' for provider 'kimi'. Available modes: default"), null);
  assert.equal(modeFromInvalidModeError("something else entirely"), null);
  assert.equal(modeFromInvalidModeError(undefined), null);
});
