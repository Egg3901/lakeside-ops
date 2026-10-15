"use strict";

const FIXED_NOW = "2026-07-26T18:00:00.000Z";

function ago(minutes) {
  return new Date(Date.parse(FIXED_NOW) - minutes * 60_000).toISOString();
}

const groups = [
  { id: "gameplay", name: "Gameplay" },
  { id: "platform", name: "Platform" },
];

const sessions = [
  {
    sessionId: "tmux:gpt-permission",
    tmuxName: "gpt-permission",
    externalTmux: true,
    kind: "codex",
    title: "Reconcile the production migration",
    worktreePath: "/root/projects/a-house-divided/worktrees/migration-safety",
    modelDetail: "gpt-5.6-sol · high",
    updatedAt: ago(1),
    needsInput: true,
    attentionExcerpt: "Run the verified database migration against the production replica?",
    statusLine: "Waiting for approval before applying the migration",
    taskExcerpt: "Verify the migration, apply it safely, and confirm row counts",
    activity: "ready",
    usage: { direction: "used", percent: 71, label: "71% filled" },
    groupId: "platform",
  },
  {
    sessionId: "tmux:claude-map",
    tmuxName: "claude-map",
    externalTmux: true,
    kind: "claude",
    title: "Election map interaction pass",
    worktreePath: "/root/projects/a-house-divided/worktrees/map-refinement",
    modelDetail: "Fable 5 · high",
    updatedAt: ago(3),
    activity: "working",
    statusLine: "Testing the responsive map transitions",
    taskExcerpt: "Refine map interactions and verify mobile gesture behavior",
    usage: { direction: "remaining", percent: 64, label: "64% remaining" },
    groupId: "gameplay",
  },
  {
    sessionId: "tmux:kimi-copy",
    tmuxName: "kimi-copy",
    externalTmux: true,
    kind: "kimi",
    title: "Polish onboarding copy",
    worktreePath: "/root/projects/ahd-client/worktrees/onboarding-copy",
    modelDetail: "K3 · thinking",
    updatedAt: ago(8),
    activity: "ready",
    statusLine: "Ready for your next direction",
    taskExcerpt: "Make first-run guidance concise and warm",
    usage: { direction: "used", percent: 19, label: "19% filled" },
    groupId: "gameplay",
  },
  {
    sessionId: "chat:budget",
    title: "Model cost guardrails",
    branchName: "feat/model-cost-guardrails",
    baseBranch: "main",
    model: "gpt-5.6-sol",
    status: "active",
    updatedAt: ago(28),
  },
  {
    sessionId: "chat:accessibility",
    title: "Accessibility audit follow-ups",
    branchName: "fix/accessibility-follow-ups",
    baseBranch: "main",
    model: "gpt-5.6-terra",
    status: "completed",
    updatedAt: ago(75),
    prUrl: "https://github.com/Egg3901/LSGD-ops-dash/pull/123",
    prNumber: 123,
    prState: "MERGED",
  },
];

const costs = {
  source: "codeburn",
  today: {
    cost: 184.43,
    label: "$184",
    byProvider: [
      { provider: "codex", cost: 98.2 },
      { provider: "claude", cost: 63.1 },
      { provider: "kimi", cost: 23.13 },
    ],
  },
  month: { cost: 14895.2, label: "$14,895" },
};

const transcript = {
  busy: true,
  turns: [
    {
      user: "Refine the main workspace and make the live state feel exceptional.",
      blocks: [
        {
          type: "thinking",
          text: "Comparing the desktop and mobile hierarchy",
        },
        {
          type: "tools",
          items: [
            { verb: "Read", args: "code-list-page.js", running: false },
            { verb: "Read", args: "tmux-terminal-page.js", running: false },
          ],
        },
        {
          type: "text",
          text: "I’ve consolidated the status chrome and made the active work easier to scan. The interface now prioritizes **what needs you** while keeping routine telemetry quiet.",
        },
        {
          type: "thinking",
          text: "Tuning the motion and contrast for the final visual pass",
        },
        {
          type: "tools",
          items: [
            { verb: "Edit", args: "tmux-terminal-page.js", running: true },
          ],
        },
      ],
    },
  ],
};

const capture = {
  version: "fixture-v1",
  output: "fixture",
  transcript,
  lastUser: transcript.turns[0].user,
  session: {
    tmuxName: "gpt-living-workspace",
    kind: "codex",
    worktreePath: "/root/projects/LSGD-ops-dash/worktrees/code-agent-living-workspace",
  },
  permissions: {
    mode: "auto",
    label: "Auto",
    modes: [
      { id: "auto", label: "Auto", description: "Skip permission prompts" },
      { id: "ask", label: "Ask", description: "Approve commands on request" },
    ],
  },
  model: "gpt-5.6-sol",
  usage: {
    direction: "used",
    percent: 58,
    label: "58% filled",
    detail: "Session context",
  },
  cost: {
    session: { label: "$8.42" },
    today: { label: "$184" },
  },
  activeTasks: {
    type: "tasks",
    title: "Refinement plan",
    items: [
      { status: "completed", text: "Fix transcript trust defects" },
      { status: "in_progress", text: "Complete the refined visual pass" },
      { status: "pending", text: "Verify desktop and mobile fixtures" },
    ],
  },
  queue: [],
  attention: null,
};

module.exports = {
  FIXED_NOW,
  capture,
  costs,
  groups,
  sessions,
  transcript,
};
