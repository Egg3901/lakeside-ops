const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { detectUsageFromOutput } = require('./tmux-sessions');
const { resolveAgentUsage } = require('./agent-usage');

describe('cursor usage detection', () => {
  it('reads context % through styled SGR codes in the footer', () => {
    const styled = [
      '  Thinking 12.4k tokens',
      '  \x1b[2mCursor Grok 4.5 High\x1b[0m \x1b[2m·\x1b[0m \x1b[2m42.3%\x1b[0m \x1b[2m·\x1b[0m \x1b[2m2 files edited\x1b[0m',
    ].join('\n');
    const usage = detectUsageFromOutput('cursor', styled);
    assert.equal(usage.percent, 42.3);
    assert.match(usage.label, /42%\s+filled/);
  });

  it('prefers the bottom files-edited footer over earlier Cursor % mentions', () => {
    const output = [
      'example: Cursor Grok 4.5 High · 99.9% · 7 files edited',
      '  Cursor Grok 4.5 High · 31.2% · 3 files edited                 Run Everything',
    ].join('\n');
    const usage = detectUsageFromOutput('cursor', output);
    assert.equal(usage.percent, 31.2);
  });

  it('keeps the last known Cursor context % when the footer scrolls away', () => {
    const withFooter = '  Cursor Grok 4.5 High · 55.0% · 1 files edited';
    const midTurn = '  Thinking 46.22k tokens\n  esc to interrupt';
    const first = resolveAgentUsage('cursor', '/tmp/usage-cache-test', withFooter, detectUsageFromOutput);
    assert.equal(first.percent, 55);
    const second = resolveAgentUsage('cursor', '/tmp/usage-cache-test', midTurn, detectUsageFromOutput);
    assert.equal(second.percent, 55);
    assert.match(second.label, /55%\s+filled/);
  });

  it('does not publish Model X as the usage label', () => {
    const usage = resolveAgentUsage('cursor', '/tmp/usage-label-test', '  Thinking 1.2k tokens', detectUsageFromOutput);
    assert.ok(usage);
    assert.doesNotMatch(String(usage.label || ''), /^Model\s+/i);
  });
});
