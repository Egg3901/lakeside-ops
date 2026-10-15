// Shared ship-checkpoint prompts + protocol for the /code agent UI.
// Protocol text lives in code-ship-protocol.txt (also read by code-agent-bridge.py).

"use strict";

const fs = require("fs");
const path = require("path");

const SHIP_MARKER = "<!--SHIP-->";

const LAND_ON_DEVELOPMENT_LABEL = "Land on development (commit + PR/merge)";
const FULL_PIPELINE_LABEL = "Full pipeline (dev → staging → master)";

const LAND_ON_DEVELOPMENT_PROMPT = `Ship checkpoint: land this work on development only. Execute immediately — do not ask for confirmation.

Follow ahd-commit / ahd-git-workflow skills as needed.

1. Update CHANGELOG.md and PUBLIC_CHANGELOG.md for the changes in this session.
2. Run npm run verify; fix any failures before committing.
3. Commit intentionally — stage only relevant files. Never git add . / git add -A. Never stash.
4. Push the feature branch and open or update a PR targeting development (not master).
5. When the verify gate is green, merge into development (gh pr merge). If blocked, report why and stop.
6. Stop after development. Do NOT promote to staging or master.
7. Report the PR URL, merge result, and final development SHA.
8. For support-ticket repairs: the ops dashboard posts the #operations TL;DR when the PR opens — do not duplicate it. The dashboard posts one human-facing ticket-channel update when the fix reaches development; staging and master promotion steps are silent in the player channel. A development merge alone is not resolution. Only after the live fix is verified should you call support MCP support_resolve with the player-facing summary, actions taken, follow-up, and source agent. Do not call support_set_status with a terminal status and do not post to Discord yourself.`;

const FULL_PIPELINE_PROMPT = `Ship checkpoint: run the full AHD pipeline now. Execute immediately — do not ask for confirmation. When the user says commit and sync, just execute.

Follow the ahd-git-workflow skill (standard sync / feature-branch pipeline as appropriate for the current branch).

1. Update CHANGELOG.md and PUBLIC_CHANGELOG.md for the changes in this session.
2. Run npm run verify; fix any failures before committing.
3. Commit intentionally — stage only relevant files. Never git add . / git add -A. Never stash.
4. Land on development (PR + merge, or merge the feature branch into development per the skill).
5. Promote development → staging → master (fetch first; merge and push each step).
6. Report PR URLs / merge results / final SHAs for development, staging, and master. Flag anything risky or player-facing-irreversible instead of merging blind.
7. For support-ticket repairs: the ops dashboard posts the #operations TL;DR when the fix PR opens, one human-facing ticket-channel update when the fix reaches development, and one when it reaches production. Staging and other promotion steps are silent in the player channel. It also posts once for an applied heal. Do not duplicate those posts, do not post to Discord yourself, and do not call support_set_status for a terminal status. After verification, call support MCP support_resolve with the player-facing summary, actions taken, follow-up, and source agent.`;

let SHIP_PROTOCOL_INSTRUCTIONS = "";
try {
  SHIP_PROTOCOL_INSTRUCTIONS = fs
    .readFileSync(path.join(__dirname, "code-ship-protocol.txt"), "utf8")
    .trim();
} catch {
  SHIP_PROTOCOL_INSTRUCTIONS =
    "When you finish a coding task or reach a checkpoint, emit <!--SHIP--> alone and wait for the UI ship chooser.";
}

module.exports = {
  SHIP_MARKER,
  LAND_ON_DEVELOPMENT_LABEL,
  FULL_PIPELINE_LABEL,
  LAND_ON_DEVELOPMENT_PROMPT,
  FULL_PIPELINE_PROMPT,
  SHIP_PROTOCOL_INSTRUCTIONS,
};
