const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const makeCodePage = require('./code-page');

describe('code session header layout', () => {
  const html = makeCodePage('', '');

  it('keeps the mobile navigation trigger inside the session top bar', () => {
    assert.match(
      html,
      /class="gem-top">\s*<button class="gem-icon-btn page-nav-toggle"[\s\S]*?class="gem-brand"/
    );
  });

  it('nests recent chats with the other secondary session actions', () => {
    assert.match(
      html,
      /class="top-more-menu"[\s\S]*?id="btn-menu"[\s\S]*?id="btn-terminal"/
    );
  });

  it('closes the sessions drawer with matching navigation markup', () => {
    assert.match(
      html,
      /<nav class="gem-drawer ca-nav"[\s\S]*?<\/nav>\s*<!-- Questions sidebar -->/
    );
    assert.doesNotMatch(html, /<\/aside>/);
  });

  it('uses one Siri-style visual language for loading and streaming', () => {
    assert.match(html, /class="spinner siri-loader"/);
    assert.match(html, /\.siri-loader,\.streaming-cursor/);
    assert.match(html, /radial-gradient\(circle at 50% 8%/);
  });

  it('keeps AHD git and release progress visible as a delivery banner', () => {
    assert.match(html, /id="delivery-banner"[\s\S]*?id="delivery-steps"/);
    assert.match(html, /id="delivery-checkpoint"[\s\S]*?id="delivery-release"/);
    assert.match(html, /renderDelivery\(data\.delivery\)/);
  });

  it('shows a reusable worktree snapshot with explicit commit and PR controls', () => {
    assert.match(html, /id="workspace-banner"[\s\S]*?id="workspace-commit"[\s\S]*?id="workspace-pr"/);
    assert.match(html, /id="commit-modal"[\s\S]*?id="commit-message"[\s\S]*?id="commit-submit"/);
    assert.match(html, /renderWorkspace\(data\.workspace\)/);
    assert.match(html, /\/commit'[\s\S]*?JSON\.stringify\(\{ message: message \}\)/);
  });

  it('refreshes the worktree display after file edits, commits, and completed turns', () => {
    assert.match(html, /case 'file_changes':[\s\S]*?refreshWorkspace\(200, true\)/);
    assert.match(html, /msg\.tool === 'git_commit'[\s\S]*?refreshWorkspace\(500, true\)/);
    assert.match(html, /case 'done':[\s\S]*?refreshDelivery\(\)/);
  });

  it('emits parseable browser scripts', () => {
    const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length > 0);
    scripts.forEach((match, index) => {
      assert.doesNotThrow(() => new vm.Script(match[1], { filename: `code-page-inline-${index}.js` }));
    });
  });
});
