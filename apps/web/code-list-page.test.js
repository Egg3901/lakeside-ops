// Regression: theme toggle belongs in the header actions row, not floating fixed.
// Run: node --test code-list-page.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const makeCodeListPage = require('./code-list-page');

describe('code list workspace layout', () => {
  const html = makeCodeListPage('', '/*BASE*/');

  it('keeps one primary header action and nests secondary controls', () => {
    const actions = html.match(/class="page-actions">([\s\S]*?)<\/details>\s*<\/div>/);
    assert.ok(actions, 'page-actions block found');
    assert.match(actions[1], /id="btn-spawn"/);
    assert.match(actions[1], /class="btn-new"[^>]*id="btn-spawn"|id="btn-spawn"[^>]*class="btn-new"/);
    assert.match(actions[1], /class="page-menu"/);
    assert.match(actions[1], /class="page-menu-popover"[\s\S]*?id="btn-new"[\s\S]*?id="btn-refresh"/);
    assert.doesNotMatch(html, /class="theme-toggle fixed"/);
    assert.doesNotMatch(html, /id="themeToggle"/);
  });

  it('labels the live band without a redundant Live prefix on cards', () => {
    assert.match(html, /id="live-label"[\s\S]*?>Now\s/);
    assert.match(html, /renameAgent/);
    assert.match(html, /moveAgentToGroup/);
    assert.match(html, /btn-new-group/);
    assert.match(html, /renderLiveGroups/);
  });

  it('keeps empty groups visible so create is not a no-op', () => {
    assert.match(html, /Empty — open a card/);
    assert.match(html, /agent-group-empty/);
    assert.doesNotMatch(html, /if \(!members\.length\) return;/);
  });

  it('keeps the mobile navigation trigger in the same flex row as the page name', () => {
    assert.match(
      html,
      /class="page-top">\s*<button class="icon-btn page-nav-toggle"[\s\S]*?class="page-head"/
    );
  });

  it('keeps the page header flush to the top of the page', () => {
    assert.match(html, /\.list-container\{[^}]*padding:0 /);
    assert.match(html, /\.page-top\{[^}]*padding:max\([^;]*safe-area-inset-top/);
    assert.doesNotMatch(html, /\.list-container\{[^}]*padding-top:max\(/);
  });

  it('shows live status and task lines on live cards without a cost chip', () => {
    assert.match(html, /class="live-status"/);
    assert.match(html, /class="task-excerpt"/);
    assert.match(html, /s\.statusLine/);
    assert.match(html, /s\.taskExcerpt/);
    assert.doesNotMatch(html, /s\.costToday/);
  });

  it('consolidates status and spend into one overview surface', () => {
    assert.match(html, /class="overview-bar"[\s\S]*?id="stats"[\s\S]*?id="cost-strip"/);
    assert.match(html, /class="cost-breakdown-link"/);
  });

  it('treats live work as an attention queue with dynamic section counts', () => {
    assert.match(html, /function livePriority/);
    assert.match(html, /live\.sort\(compareLiveSessions\)/);
    assert.match(html, /id="live-count"/);
    assert.match(html, /id="chats-count"/);
    assert.match(html, /return livePriority\(a\) - livePriority\(b\)/);
    assert.match(html, /orderedGroups\.sort/);
  });

  it('nests destructive session controls in card menus', () => {
    assert.match(html, /class="card-menu"/);
    assert.match(html, /class="card-menu-popover"/);
    assert.match(html, /End session/);
    assert.match(html, /Force end/);
    assert.match(html, /Delete chat/);
  });

  it('ends sessions with soft wrap-up by default', () => {
    assert.match(html, /Ask this agent to wrap up now/);
    assert.match(html, /force: isForce/);
    assert.match(html, /s\.wrapUp/);
    assert.match(html, /Wrapping up/);
    assert.match(html, /Ready to close/);
  });

  it('makes session cards keyboard-operable and shortens long paths', () => {
    assert.match(html, /role="link" tabindex="0"/);
    assert.match(html, /e\.target !== card/);
    assert.match(html, /function shortPath/);
  });

  it('brands kimi sessions with a comet, not a moon', () => {
    assert.match(html, /kind === 'kimi'\) return '<svg[^>]*><circle/);
    assert.doesNotMatch(html, /M20\.2 13\.6/);
  });

  it('shows loading and recoverable error states instead of a blank page', () => {
    assert.match(html, /id="list-state"/);
    assert.match(html, /Could not load sessions/);
    assert.match(html, /id="list-retry"/);
    assert.match(html, /cache:\s*'no-store'/);
  });

  it('emits parseable browser scripts', () => {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    assert.ok(scripts.length > 0);
    scripts.forEach((script) => assert.doesNotThrow(() => new Function(script)));
  });

  it('offers a stepped spawn flow with prompt and schedule controls', () => {
    assert.match(html, /id="spawn-steps"/);
    assert.match(html, /id="input-spawn-prompt"/);
    assert.match(html, /id="input-spawn-title"/);
    assert.match(html, /id="input-spawn-runat"/);
    assert.match(html, /data-when="schedule"/);
    assert.match(html, /id="btn-spawn-next"/);
    assert.match(html, /\/api\/code\/tmux\/schedule/);
    assert.match(html, /Schedule agent/);
  });

  it('shows a Scheduled band for pending one-shot jobs', () => {
    assert.match(html, /id="schedule-band"/);
    assert.match(html, /id="schedule-list"/);
    assert.match(html, /id="schedule-count"/);
    assert.match(html, /cancelScheduledAgent/);
    assert.match(html, /\/api\/code\/tmux\/schedules/);
  });
});
