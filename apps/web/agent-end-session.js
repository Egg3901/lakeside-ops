// Soft end-session wrap-up for live tmux agents.
// Default "End session" asks the agent to commit / knowledge-save / pipeline,
// then waits for <!--END_READY-->. Force-kill remains an explicit escape hatch.

"use strict";

const END_READY_MARKER = "<!--END_READY-->";

const END_SESSION_WRAPUP_PROMPT = `END SESSION — WRAP UP NOW. Execute immediately; do not ask for confirmation.

The user clicked End session. Before this live agent is closed, finish cleanly:

1. Git: if there are uncommitted changes from this session, update CHANGELOG.md / PUBLIC_CHANGELOG.md as needed, run verify if this is AHD game code, and commit intentionally (never git add . / -A; never stash). Every commit must be pushed and linked to a PR, or recorded as a named recovery branch with an explicit handoff. "Committed locally" is not a finished state.
2. AHD prompt pipeline: if this work belongs on the AHD git pipeline (feature → development, or further), follow ahd-commit / ahd-git-workflow / the ship protocol as appropriate for the current branch. If this is ops-dash or non-AHD work, skip the AHD pipeline and just leave the branch clean.
3. Lifecycle: query ops-knowledge MCP worktree_fleet_status for this repository and confirm this checkout is not dirty or an orphaned unlanded branch. State the PR URL or recovery handoff in the final response.
4. Ops knowledge: save a concise wrap-up memory via the ops-knowledge MCP (knowledge_save) covering what changed, why, key paths, and any follow-ups. If nothing durable is worth saving, say so.
5. When (and only when) the above is done — or you confirm it was already done — reply with this marker alone on its own line and stop:
${END_READY_MARKER}

Do not kill yourself. Do not invent extra shipping beyond what this session needs. Prefer finishing over starting new work.`;

const END_READY_RE = /<!--\s*END_READY\s*-->/i;

function detectEndReady(output) {
  return END_READY_RE.test(String(output || ""));
}

module.exports = {
  END_READY_MARKER,
  END_READY_RE,
  END_SESSION_WRAPUP_PROMPT,
  detectEndReady,
};
