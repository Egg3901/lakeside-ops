const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const makeTmuxTerminalPage = require('./tmux-terminal-page');

describe('live agent mobile header', () => {
  const html = makeTmuxTerminalPage('');

  it('combines model and effort into one picker control', () => {
    assert.match(
      html,
      /id="modelBtn"[\s\S]*?id="modelValue"[\s\S]*?id="effortValue"/
    );
    assert.doesNotMatch(html, /id="effortBtn"/);
  });

  it('keeps the composer backdrop full-bleed while centering the input', () => {
    assert.match(html, /\.composer\{[^}]*width:100%/);
    assert.match(html, /max\(14px,calc\(\(100% - 850px\) \/ 2\)\)/);
    assert.doesNotMatch(html, /\.composer\{[^}]*width:min\(850px,100%\)/);
  });

  it('pins shell rows with grid areas so hidden banners do not steal 1fr', () => {
    assert.match(html, /grid-template-areas:"top" "workspace" "delivery" "screen" "attention" "todos" "composer"/);
    assert.match(html, /class="workspace-bar"[\s\S]*?class="tools"[\s\S]*?class="context"/);
    assert.match(html, /\.screen\{grid-area:screen/);
    assert.match(html, /\.sticky-todos\{grid-area:todos/);
    assert.match(html, /\.composer\{grid-area:composer/);
  });

  it('surfaces a glowing usage burn meter on the model bar', () => {
    assert.match(html, /id="usageBurn"/);
    assert.match(html, /class="usage-burn"/);
    assert.match(html, /@keyframes burn-pulse/);
    assert.match(html, /function renderUsage/);
    assert.match(html, /burn\.style\.setProperty\('--burn'/);
    assert.match(html, /Remaining':'Context'/);
  });

  it('nests secondary agent metadata under one controls menu', () => {
    assert.match(
      html,
      /class="context-more"[\s\S]*?id="permSlot"[\s\S]*?id="cwdValue"[\s\S]*?id="usage"[\s\S]*?id="costChip"/
    );
  });

  it('removes the redundant More menu and nests its useful actions under Controls', () => {
    assert.doesNotMatch(html, /tools-more|>More</);
    assert.match(
      html,
      /class="context-popover"[\s\S]*?id="searchBtn"[\s\S]*?id="copyBtn"[\s\S]*?id="fontDown"[\s\S]*?id="fontUp"[\s\S]*?id="endBtn"/
    );
  });

  it('ends the live session with soft wrap-up instead of an immediate kill', () => {
    assert.match(html, /Ask this agent to wrap up now/);
    assert.match(html, /force:force/);
    assert.match(html, /d\.wrapUp/);
    assert.match(html, /Close session/);
  });

  it('keeps open agent todos sticky above the message bar and auto-updates them', () => {
    assert.match(html, /id="stickyTodos"/);
    assert.match(html, /\.sticky-todos\.show/);
    assert.match(html, /function renderStickyTodos/);
    assert.match(html, /lastActiveTasks=d\.activeTasks\|\|null/);
    assert.match(html, /transcriptHasTasks\(data\)\?activeTasksFromTranscript\(data\):lastActiveTasks/);
    assert.match(html, /if\(block\.type==='tasks'\)\{continue\}/);
  });

  it('pauses autoscroll when Follow is off', () => {
    assert.match(html, /function atBottom\(\)\{return follow&&/);
  });

  it('renders uploaded images as compact authenticated thumbnails', () => {
    assert.match(html, /className='user-images'/);
    assert.match(html, /userAttachments/);
    assert.match(html, /className='user-thumb'/);
  });

  it('offers Force send for queued messages', () => {
    assert.match(html, /Force send/);
    assert.match(html, /post\('queue',\{force:true\}\)/);
  });

  it('keeps queued images visible until the agent receives them', () => {
    assert.match(html, /item\.images&&item\.images\.length/);
    assert.match(html, /link\.href=image\.url/);
    assert.match(html, /img\.src=image\.url/);
  });

  it('shows the AHD delivery pipeline and queues checkpoint or release instructions', () => {
    assert.match(html, /id="deliveryBanner"[\s\S]*?id="deliverySteps"/);
    assert.match(html, /id="checkpointBtn"[\s\S]*?id="releaseBtn"/);
    assert.match(html, /displayText:label/);
  });

  it('uses Loading UI Classic only in the persistent activity row', () => {
    assert.doesNotMatch(html, /class="siri-indicator"/);
    assert.match(html, /id="activityHost"[\s\S]*?class="classic-spinner"/);
    assert.match(html, /loading-ui-classic-fade/);
    assert.equal((html.match(/class="classic-spinner-spoke"/g) || []).length, 12);
    assert.match(html, /setActivity\(busy,latestActivityIntent\(turns\)\)/);
  });

  it('rotates accessible agent phrases without rebuilding the spinner', () => {
    assert.match(html, /ACTIVITY_PHRASES/);
    assert.match(html, /Following the thread/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /activityPhraseFor/);
    assert.match(html, /@media\(prefers-reduced-motion:reduce\)/);
    assert.doesNotMatch(html, /function paintAgentPulse/);
  });

  it('offers the shared persistent light and dark theme toggle in the top bar', () => {
    assert.match(html, /id="themeToggle"/);
    assert.match(html, /data-theme="light"/);
    assert.match(html, /ahd-theme/);
    assert.match(html, /class="top-actions"/);
  });

  it('skips rebuilding the conversation DOM when the transcript is unchanged', () => {
    assert.match(html, /lastRenderKey/);
    assert.match(html, /if\(renderKey===lastRenderKey\)return/);
  });

  it('preserves expanded tool dropdowns across transcript rebuilds', () => {
    assert.match(html, /openToolKeys/);
    assert.match(html, /captureOpenTools/);
    assert.match(html, /data-tool-key/);
  });

  it('uses preceding intent text as the tool group label', () => {
    assert.match(html, /renderToolGroup\(block\.items,pendingIntent\)/);
    assert.match(html, /pendingIntent=String\(block\.text\)/);
  });

  it('polls without overlapping requests and compacts unchanged captures', () => {
    assert.match(html, /if\(refreshInFlight\)return refreshInFlight/);
    assert.match(html, /capture'\+\(lastVersion\?'\?v='/);
    assert.match(html, /d\.unchanged\?lastOutput/);
    assert.doesNotMatch(html, /setInterval\(function\(\)\{if\(!document\.hidden\)refresh\(\)\},1200\)/);
  });

  it('backs off polling while the agent is idle', () => {
    assert.match(html, /scheduleRefresh\(lastBusyState\?900:2500\)/);
  });

  it('accepts clipboard image paste in the composer', () => {
    assert.match(html, /addEventListener\('paste'/);
    assert.match(html, /addPendingImages/);
    assert.match(html, /clipboardData/);
  });

  it('keeps terminal keys inside Controls instead of a dedicated shortcut bar', () => {
    assert.doesNotMatch(html, /class="terminal-controls"|Keyboard shortcuts/);
    assert.match(html, /class="control-keys"/);
    assert.match(html, /class="context-popover"[\s\S]*?data-key="ctrl-c"/);
  });

  it('renders pending attachment thumbnails instead of bare filenames', () => {
    assert.match(html, /attach-thumb/);
    assert.match(html, /attach-rm/);
  });

  it('emits parseable browser scripts', () => {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    assert.ok(scripts.length > 0);
    scripts.forEach((script) => assert.doesNotThrow(() => new Function(script)));
  });
});
