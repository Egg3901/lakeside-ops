// code-page.js — Session detail: chat interface for browser-based agentic coding
// Exported as a function that receives FONT_LINKS and BASE_CSS template strings.
// Uses Hermes AIAgent via persistent Python bridge over WebSocket.
//
// UI: AHD-native coding surface — slide-out recents drawer, centered greeting,
// composer, clean top bar. Light/dark theme support (scoped to the code-agent
// pages so the rest of the dashboard keeps its dark theme).
// All existing features retained: model picker, dynamic tool-call panels,
// markdown + mermaid rendering, context bar, streaming, message queue,
// stop button, PR creation, WebSocket reconnect.

const { icon, faviconFor, THEME_HEAD, themeToggle, THEME_TOGGLE_JS } = require('./ui-kit');
const {
  SHIP_MARKER,
  LAND_ON_DEVELOPMENT_LABEL,
  FULL_PIPELINE_LABEL,
  LAND_ON_DEVELOPMENT_PROMPT,
  FULL_PIPELINE_PROMPT,
} = require('./code-ship');

module.exports = function makeCodePage(FONT_LINKS, BASE_CSS) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>Code Agent — Lakeside Ops</title>
${THEME_HEAD}
<link rel="icon" href="${faviconFor('terminal')}">
${FONT_LINKS}
<style>${BASE_CSS}
:root{
  --g-bg:var(--bg-0);--g-surface:var(--bg-1);
  --g-surface-2:var(--glass-2);--g-surface-3:var(--glass-3);
  --g-text:var(--text);--g-text-2:var(--text-2);--g-text-3:var(--text-3);
  --g-accent:var(--accent);--g-accent-strong:var(--accent);
  --g-user-bub:var(--surface-2);--g-input:var(--bg-0);--g-input-border:var(--border);
  --g-hover:var(--glass-hover);--g-active:var(--accent-soft);
  --g-code:var(--bg-0);--g-shadow:var(--shadow);--g-line:var(--border);
}
.theme-switching,.theme-switching *,.theme-switching *::before,.theme-switching *::after{transition:none!important}
html,body{height:100%;overflow:hidden;overscroll-behavior:none}
body{position:fixed;inset:0;background:var(--bg-0);color:var(--text);-webkit-tap-highlight-color:transparent}
*{-webkit-tap-highlight-color:transparent}

.gem-spark{display:inline-block;line-height:0}
.gem-spark svg{display:block}

.ca-root{position:fixed;inset:0;display:grid;grid-template-columns:264px 1fr;grid-template-rows:100%;background:var(--bg-0);overflow:hidden}
/* Sessions rail */
.ca-nav{grid-column:1;grid-row:1;border-right:1px solid var(--border);background:color-mix(in srgb,var(--bg-1) 55%,transparent);display:flex;flex-direction:column;min-height:0;overflow:hidden}
/* Main activity */
.ca-main{grid-column:2;grid-row:1;display:flex;flex-direction:column;min-height:0;min-width:0;position:relative}
/* code-container is now the ca-main inner, kept for JS compat */
.code-container{display:flex;flex-direction:column;height:100%;min-height:0;-webkit-tap-highlight-color:transparent}
/* Rail head */
.ca-nav-head{display:flex;align-items:center;gap:8px;padding:13px 14px 10px;flex-shrink:0;border-bottom:1px solid var(--border)}
.ca-brand-mark{width:30px;height:30px;border-radius:var(--r-sm);background:linear-gradient(135deg,var(--glass-3),var(--glass-1));border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:.95rem;flex-shrink:0}
.ca-brand-text .nm{font-size:.95rem;font-weight:700;letter-spacing:-.02em}
.ca-brand-text .sub{font-size:.6rem;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em}
.ca-newbtn{margin:8px 10px;display:flex;align-items:center;gap:7px;justify-content:center;padding:.58rem;border-radius:var(--r-md);border:1px solid transparent;background:var(--accent);color:var(--on-accent);font-weight:600;font-size:.8rem;cursor:pointer;box-shadow:var(--e1);transition:filter var(--t),transform var(--t);font-family:var(--font);flex-shrink:0}
.ca-newbtn:hover{filter:brightness(1.08);transform:translateY(-1px)}
.ca-nav-scroll{flex:1;overflow-y:auto;scrollbar-width:thin;padding-bottom:8px}
.ca-seclabel{font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-3);padding:12px 14px 6px}
.ca-sess{display:flex;align-items:center;gap:8px;width:calc(100% - 12px);margin:1px 6px;padding:8px 10px;border:1px solid transparent;border-radius:var(--r-sm);background:transparent;cursor:pointer;text-align:left;transition:background var(--t),border-color var(--t);font-family:var(--font)}
.ca-sess:hover{background:var(--glass-2)}
.ca-sess.active{background:var(--glass-2);border-color:color-mix(in srgb,var(--accent) 28%,var(--border))}
.ca-sess .s-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.ca-sess .s-dot.active{background:var(--green);box-shadow:0 0 0 0 rgba(52,211,153,.45);animation:pulse 2s var(--ease) infinite}
.ca-sess .s-dot.error{background:var(--red)}
.ca-sess .s-dot.completed{background:var(--accent)}
.ca-sess .s-dot.idle,.ca-sess .s-dot.stub{background:var(--text-3)}
.ca-sess .s-title{font-size:.8rem;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
.ca-sess.active .s-title{color:var(--accent);font-weight:600}
.ca-nav-foot{border-top:1px solid var(--border);padding:10px 14px;flex-shrink:0;display:flex;align-items:center;gap:10px}
.ca-user-av{width:28px;height:28px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;color:#fff;font-size:.72rem;font-weight:700;flex-shrink:0}
.ca-user-info{flex:1;min-width:0}
.ca-user-info .un{font-size:.8rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ca-user-info .ur{font-size:.65rem;color:var(--text-3)}
/* Rail search */
.ca-search{padding:6px 10px}
.ca-search input{width:100%;padding:.42rem .7rem;border-radius:var(--r-full);border:1px solid var(--border);background:var(--glass-1);color:var(--text);font-size:.78rem;font-family:var(--font);outline:none;transition:border-color var(--t)}
.ca-search input:focus{border-color:color-mix(in srgb,var(--accent) 45%,transparent)}
/* Session rail = a slide-over drawer, closed by default and reliably closeable
   everywhere (X / backdrop / menu). The persistent ops sidebar is the primary
   nav; this is a secondary, on-demand panel. (Replaces the old grid-column +
   nav-collapsed + gem-drawer.open tangle that left it stuck open.) */
.ca-root{grid-template-columns:1fr}
.ca-nav{position:fixed!important;left:0;top:0;bottom:0;width:min(300px,84vw);z-index:120;box-shadow:var(--shadow-lg);transform:translateX(-102%)!important;transition:transform .26s var(--ease)}
.ca-root.rail-open .ca-nav{transform:none!important}
#ca-rail-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:115;opacity:0;pointer-events:none;transition:opacity .26s}
.ca-root.rail-open #ca-rail-backdrop{opacity:1;pointer-events:auto}
#btn-mob-nav-ca{display:none!important}

/* ───────────────────────── Top bar ───────────────────────── */
.gem-top{display:flex;align-items:center;gap:var(--s-2);padding:var(--s-2) var(--s-4);padding-top:max(var(--s-2),env(safe-area-inset-top));flex-shrink:0;z-index:6;background:color-mix(in srgb,var(--bg-0) 82%,transparent);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);border-bottom:1px solid transparent}
.gem-icon-btn{display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:var(--r-md);border:1px solid transparent;background:transparent;color:var(--g-text-2);cursor:pointer;transition:background var(--t),color var(--t),border-color var(--t);font-size:1.15rem;flex-shrink:0}
.gem-icon-btn:hover{background:var(--g-hover);border-color:var(--border);color:var(--g-text)}
.gem-icon-btn svg{width:18px;height:18px}
.page-nav-toggle{display:none}
.gem-brand{flex:1;min-width:0;display:flex;align-items:center;justify-content:flex-start}
.gem-top-actions{display:flex;align-items:center;gap:2px;flex-shrink:0}
.top-more{position:relative;flex:0 0 auto}.top-more-btn{font-size:1.35rem;line-height:1;padding-bottom:.28rem}.top-more-menu{position:absolute;top:calc(100% + 8px);right:0;z-index:80;display:none;min-width:224px;padding:6px;border:1px solid var(--g-line);border-radius:var(--r-lg);background:var(--g-surface);box-shadow:var(--e3),var(--hi);animation:rise .16s var(--ease)}.top-more-menu.open{display:flex;flex-direction:column;gap:2px}.top-more-menu button{display:flex!important;align-items:center;justify-content:flex-start;gap:.6rem;width:100%;padding:.62rem .7rem;border:0;border-radius:var(--r-sm);background:transparent;color:var(--g-text-2);text-align:left}.top-more-menu button:hover{background:var(--g-hover);color:var(--g-text)}.top-more-menu .header-btn[style*="display:none"],.top-more-menu .header-btn[style*="display: none"]{display:none!important}.top-more-menu .menu-divider{height:1px;margin:4px 6px;background:var(--g-line)}

/* Model picker — brand control */
.model-picker{position:relative;display:inline-flex;align-items:center;min-width:0;max-width:100%}
.model-picker-btn{display:flex;align-items:center;gap:.45rem;padding:.4rem .7rem;background:var(--glass-1);border:1px solid var(--border);border-radius:var(--r-md);color:var(--g-text);font-size:.92rem;font-weight:600;cursor:pointer;transition:background var(--t),border-color var(--t);white-space:nowrap;min-width:0;letter-spacing:-.015em}
.model-picker-btn:hover{background:var(--g-hover);border-color:color-mix(in srgb,var(--accent) 30%,var(--border))}
.gem-brand-name{font-weight:700;letter-spacing:-.02em}
.model-picker-btn .gem-model-tag{font-size:.72rem;font-weight:500;color:var(--g-text-3);font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;max-width:140px;background:var(--glass-2);padding:.12em .45em;border-radius:5px}
.model-picker-btn .arrow{font-size:.6rem;opacity:.55;align-self:center;color:var(--g-text-3)}
.model-picker-dd{position:absolute;top:calc(100% + 6px);left:0;min-width:280px;max-height:340px;overflow-y:auto;background:var(--g-surface);border:1px solid var(--g-line);border-radius:var(--r-lg);box-shadow:var(--e3),var(--hi);z-index:50;display:none;animation:rise .18s var(--ease);padding:var(--s-2) 0}
.model-picker-dd.open{display:block}
.mp-section{padding:var(--s-2) var(--s-4) var(--s-1);font-size:.66rem;font-weight:700;color:var(--g-text-3);text-transform:uppercase;letter-spacing:.06em}
.mp-item{display:flex;align-items:center;gap:.5rem;padding:.55rem var(--s-4);font-size:.85rem;color:var(--g-text);cursor:pointer;transition:background var(--t)}
.mp-item:hover{background:var(--g-hover)}
.mp-item.active{color:var(--g-accent);background:var(--g-active)}
.mp-item .mp-provider{margin-left:auto;font-size:.66rem;color:var(--g-text-3);font-family:var(--mono)}

.header-btn{font-size:.76rem;padding:.38rem .8rem;border-radius:var(--r-md);border:1px solid var(--g-line);background:transparent;color:var(--g-text-2);cursor:pointer;transition:all var(--t);font-family:var(--font);white-space:nowrap;font-weight:600}
.header-btn:hover{background:var(--g-hover);color:var(--g-text)}
.header-btn.pr-btn{border-color:color-mix(in srgb,var(--green) 45%,transparent);color:var(--green)}
.header-btn.pr-btn:hover{background:var(--green-soft)}
.header-btn.pr-btn.done{opacity:1;cursor:pointer}
.header-btn.review-btn{border-color:color-mix(in srgb,var(--amber) 45%,transparent);color:var(--amber)}
.header-btn.review-btn:hover{background:var(--amber-soft)}
.header-btn.review-btn.working{opacity:.6;cursor:not-allowed}
.header-btn.ship-btn{border-color:color-mix(in srgb,var(--accent) 45%,transparent);color:var(--accent)}
.header-btn.ship-btn:hover{background:var(--accent-soft)}
.delivery-banner{display:none;align-items:center;gap:.75rem;padding:.65rem .9rem;border-bottom:1px solid color-mix(in srgb,var(--accent) 24%,var(--g-line));background:linear-gradient(90deg,color-mix(in srgb,var(--accent) 9%,var(--g-surface)),var(--g-surface));flex-shrink:0}.delivery-banner.show{display:grid;grid-template-columns:minmax(180px,1fr) auto auto}.delivery-copy{min-width:0}.delivery-title{font-size:.78rem;font-weight:750}.delivery-detail{font-size:.66rem;color:var(--g-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.delivery-steps{display:flex;gap:.3rem;align-items:center}.delivery-step{display:flex;align-items:center;gap:.28rem;font-size:.61rem;color:var(--g-text-3);white-space:nowrap}.delivery-step:not(:last-child):after{content:"›";margin-left:.2rem;color:var(--g-line)}.delivery-dot{width:7px;height:7px;border-radius:50%;border:1px solid var(--g-line)}.delivery-step.done .delivery-dot{background:var(--green);border-color:var(--green)}.delivery-step.active .delivery-dot{background:var(--accent);border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}.delivery-step.next .delivery-dot{border-color:var(--accent)}.delivery-step.failed{color:var(--red)}.delivery-step.failed .delivery-dot{background:var(--red);border-color:var(--red)}.delivery-step a{color:inherit;text-decoration:none}.delivery-actions{display:flex;gap:.35rem}.delivery-action{min-height:34px;padding:0 .65rem;border-radius:var(--r-sm);border:1px solid color-mix(in srgb,var(--accent) 35%,var(--g-line));background:var(--accent-soft);color:var(--accent);font-size:.67rem;font-weight:700;cursor:pointer}.delivery-action.release{background:var(--accent);color:var(--on-accent)}
@media(max-width:700px){.delivery-banner.show{grid-template-columns:1fr auto;padding:.55rem .65rem}.delivery-steps{grid-column:1/-1;grid-row:2;overflow-x:auto}.delivery-detail{max-width:58vw}.delivery-action{padding:0 .5rem}.delivery-action span{display:none}}
.workspace-banner{display:none;align-items:center;gap:.8rem;padding:.62rem .9rem;border-bottom:1px solid var(--g-line);background:color-mix(in srgb,var(--g-surface) 90%,var(--accent-soft));flex-shrink:0}.workspace-banner.show{display:flex}.workspace-git{display:flex;align-items:center;gap:.48rem;min-width:0;flex:1}.workspace-copy{min-width:0}.workspace-branch{font:700 .72rem var(--mono);color:var(--g-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.workspace-path{font:.62rem var(--mono);color:var(--g-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}.workspace-stats{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap;min-width:0}.workspace-chip{display:inline-flex;align-items:center;gap:.25rem;padding:.2rem .42rem;border-radius:var(--r-full);border:1px solid var(--g-line);font-size:.61rem;color:var(--g-text-2);white-space:nowrap}.workspace-chip:last-child{max-width:240px;overflow:hidden;text-overflow:ellipsis}.workspace-chip.dirty{color:var(--amber);border-color:color-mix(in srgb,var(--amber) 40%,var(--g-line));background:color-mix(in srgb,var(--amber) 8%,transparent)}.workspace-chip.clean{color:var(--green)}.workspace-actions{display:flex;gap:.38rem}.workspace-btn{min-height:32px;padding:0 .68rem;border-radius:var(--r-sm);border:1px solid var(--g-line);background:var(--g-surface-2);color:var(--g-text);font-size:.68rem;font-weight:700;cursor:pointer;font-family:var(--font)}.workspace-btn.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}.workspace-btn:disabled{opacity:.45;cursor:not-allowed}
.commit-modal .commit-files{max-height:145px;overflow:auto;margin:.7rem 0;padding:.55rem .65rem;border-radius:var(--r-sm);background:var(--g-code);font:.65rem/1.55 var(--mono);color:var(--g-text-2)}.commit-modal label{display:block;font-size:.68rem;font-weight:700;color:var(--g-text-2);margin-bottom:.35rem}.commit-modal input{width:100%;padding:.72rem .78rem;border:1px solid var(--g-line);border-radius:var(--r-sm);background:var(--g-input);color:var(--g-text);font:.8rem var(--mono);outline:none}.commit-modal input:focus{border-color:var(--accent)}.commit-error{min-height:1.2em;margin-top:.45rem;color:var(--red);font-size:.7rem}.commit-actions{display:flex;justify-content:flex-end;gap:.45rem;margin-top:.7rem}
@media(max-width:700px){.workspace-banner.show{display:grid;grid-template-columns:minmax(0,1fr) auto;padding:.5rem .65rem}.workspace-stats{grid-column:1/-1;grid-row:2}.workspace-path{max-width:58vw}.workspace-btn{padding:0 .52rem}.workspace-btn .wide{display:none}}
.ship-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.48);z-index:80;display:none;align-items:center;justify-content:center;padding:1.25rem;animation:rise .18s var(--ease)}
.ship-modal-backdrop.open{display:flex}
.ship-modal{width:min(440px,100%);background:var(--g-surface);border:1px solid var(--g-line);border-radius:var(--r-lg);box-shadow:var(--e3),var(--hi);padding:1.15rem 1.25rem 1.1rem}
.ship-modal h2{margin:0 0 .35rem;font-size:1.05rem;font-weight:700;letter-spacing:-.02em}
.ship-modal .ship-lead{margin:0 0 1rem;font-size:.84rem;color:var(--g-text-2);line-height:1.45}
.ship-opt{display:block;width:100%;text-align:left;padding:.75rem .9rem;margin:.4rem 0;border:1px solid var(--g-line);border-radius:var(--r-md);background:var(--g-surface-2);color:var(--g-text);cursor:pointer;font-family:var(--font);transition:border-color var(--t),background var(--t)}
.ship-opt:hover{border-color:color-mix(in srgb,var(--accent) 50%,var(--g-line));background:var(--g-hover)}
.ship-opt .ship-opt-title{display:block;font-size:.88rem;font-weight:700;margin-bottom:.2rem}
.ship-opt .ship-opt-desc{display:block;font-size:.76rem;color:var(--g-text-3);line-height:1.4}
.ship-opt.pipeline .ship-opt-title{color:var(--accent)}
.ship-opt.dev .ship-opt-title{color:var(--green)}
.ship-modal-cancel{display:block;width:100%;margin-top:.55rem;padding:.5rem;border:none;background:transparent;color:var(--g-text-3);font-size:.8rem;cursor:pointer;font-family:var(--font)}
.ship-modal-cancel:hover{color:var(--g-text-2)}
/* Reviewer message style */
.msg-reviewer{background:color-mix(in srgb,var(--amber) 7%,transparent);border:1px solid color-mix(in srgb,var(--amber) 22%,transparent);border-radius:var(--r-md);padding:var(--s-4) var(--s-5);margin:.4rem 0;animation:rise .25s var(--ease)}
.reviewer-header{display:flex;align-items:center;gap:var(--s-2);font-size:.82rem;font-weight:600;color:var(--amber);margin-bottom:var(--s-3)}
/* Memory panel */
.mem-panel{position:fixed;right:0;top:0;bottom:0;width:min(400px,88vw);background:var(--g-surface);border-left:1px solid var(--g-line);z-index:55;display:flex;flex-direction:column;transform:translateX(102%);transition:transform .28s var(--ease);box-shadow:var(--g-shadow)}
/* Questions sidebar */
.qs-sidebar{position:fixed;left:0;top:0;bottom:0;width:320px;max-width:85vw;background:var(--g-surface);border-right:1px solid var(--g-line);z-index:45;display:flex;flex-direction:column;transform:translateX(-102%);transition:transform .28s var(--ease);box-shadow:var(--g-shadow)}
.qs-sidebar.open{transform:none}
.qs-sidebar-head{display:flex;align-items:center;gap:var(--s-2);padding:var(--s-3) var(--s-4);border-bottom:1px solid var(--g-line);flex-shrink:0}
.qs-sidebar-title{flex:1;font-size:.95rem;font-weight:700}
.qs-sidebar-search{padding:var(--s-2) var(--s-3);border-bottom:1px solid var(--g-line)}
.qs-sidebar-search input{width:100%;padding:.5rem .75rem;border-radius:var(--r-full);border:1px solid var(--g-line);background:var(--g-surface-2);color:var(--g-text);font-size:.8rem;font-family:var(--font);outline:none}
.qs-sidebar-search input:focus{border-color:var(--g-accent)}
.qs-sidebar-body{flex:1;overflow-y:auto;padding:var(--s-2) var(--s-3);scrollbar-width:thin}
.qs-item{display:block;width:100%;padding:.55rem .7rem;margin:2px 0;border:none;background:transparent;color:var(--g-text-2);font-size:.8rem;font-family:var(--font);cursor:pointer;border-radius:var(--r-md);transition:background var(--t),color var(--t);text-align:left;word-break:break-word;line-height:1.4}
.qs-item:hover{background:var(--g-hover);color:var(--g-text)}
.qs-item .qs-session{font-size:.68rem;color:var(--g-text-3);margin-top:.15rem;font-family:var(--mono)}
.qs-item .qs-time{font-size:.65rem;color:var(--g-text-3);margin-left:.3rem}
.qs-empty{color:var(--g-text-3);font-size:.82rem;text-align:center;padding:var(--s-6) 0}
.qs-count{font-size:.7rem;color:var(--g-text-3);padding:var(--s-2) var(--s-3);border-top:1px solid var(--g-line);text-align:center}
/* Shift main content when sidebar is open */
/* qs-sidebar overlays like .mem-panel — it must NOT reflow the grid-based main
   content (the old margin-left shove double-counted the offset and scrambled
   the layout on desktop). */
@media(max-width:800px){.qs-sidebar{width:280px}}
.mem-panel.open{transform:none}
.mem-overlay{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:54;opacity:0;pointer-events:none;transition:opacity .28s var(--ease)}
.mem-overlay.show{opacity:1;pointer-events:auto}
.mem-head{display:flex;align-items:center;gap:var(--s-2);padding:var(--s-4);border-bottom:1px solid var(--g-line);flex-shrink:0}
.mem-title{flex:1;font-size:1rem;font-weight:700}
.mem-body{flex:1;overflow-y:auto;padding:var(--s-3) var(--s-4)}
.mem-empty{color:var(--g-text-3);font-size:.85rem;text-align:center;padding:var(--s-8) 0}
.mem-item{background:var(--g-surface-2);border:1px solid var(--g-line);border-radius:var(--r-md);padding:var(--s-3) var(--s-4);margin-bottom:var(--s-3);position:relative}
.mem-item:hover .mem-del{opacity:1}
.mem-content{font-size:.82rem;line-height:1.6;color:var(--g-text);white-space:pre-wrap;word-break:break-word}
.mem-meta{font-size:.68rem;color:var(--g-text-3);margin-top:.35rem;font-family:var(--mono)}
.mem-del{position:absolute;top:.4rem;right:.4rem;background:transparent;border:none;color:var(--g-text-3);cursor:pointer;opacity:0;transition:opacity var(--t);font-size:.85rem;padding:.2em .4em;border-radius:var(--r-xs)}
.mem-del:hover{background:var(--red-soft);color:var(--red)}
.mem-footer{padding:var(--s-3) var(--s-4);border-top:1px solid var(--g-line);flex-shrink:0}
.mem-add-area{width:100%;padding:.55rem .75rem;background:var(--g-surface-2);border:1px solid var(--g-line);border-radius:var(--r-md);color:var(--g-text);font-size:.82rem;font-family:var(--font);resize:none;outline:none;min-height:64px;max-height:120px;transition:border-color var(--t)}
.mem-add-area:focus{border-color:var(--accent)}
.mem-add-area::placeholder{color:var(--g-text-3)}
/* "Remember this" button on AI messages */
.msg-remember-btn{display:none;align-items:center;gap:.25em;background:transparent;border:none;color:var(--g-text-3);cursor:pointer;font-size:.68rem;padding:.2em .45em;border-radius:var(--r-xs);transition:all var(--t);font-family:var(--font)}
.msg-remember-btn:hover{background:var(--accent-soft);color:var(--accent)}
.msg-ai:hover .msg-remember-btn,.msg-ai:focus-within .msg-remember-btn{display:inline-flex}
/* Skill banner */
.skill-banner{display:flex;align-items:center;gap:.5rem;padding:.35rem .65rem;margin:.35rem 0;border-radius:6px;font-size:.78rem;font-family:var(--mono);animation:rise .25s var(--ease) both}
/* Multiple-choice clarification cards */
.mc-card{border-radius:8px;padding:.75rem 1rem;margin:.5rem 0;animation:rise .25s var(--ease) both}
.mc-opt{display:block;width:100%;text-align:left;padding:.45rem .75rem;margin:.2rem 0;border:1px solid var(--g-line);border-radius:6px;background:var(--g-surface-2);color:var(--g-text);font-size:.84rem;cursor:pointer;transition:border-color var(--t),background var(--t);font-family:var(--font)}
.mc-opt:hover{border-color:var(--accent);background:var(--g-hover)}
.mc-opt:focus{outline:2px solid var(--accent);outline-offset:1px}
.pr-state{display:inline-flex;align-items:center;font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:.1em .4em;border-radius:var(--r-full);margin-left:.3rem;vertical-align:middle}
.pr-state.open{background:var(--green-soft);color:var(--green)}
.pr-state.merged{background:color-mix(in srgb,var(--accent-2) 14%,transparent);color:var(--accent-2)}
.pr-state.closed{background:var(--red-soft);color:var(--red)}

.ws-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;margin:0 var(--s-1)}
.ws-dot.connected{background:var(--green);box-shadow:0 0 0 0 rgba(52,211,153,.5);animation:pulse 2.4s var(--ease) infinite}
.ws-dot.disconnected{background:var(--red)}
.ws-dot.connecting{background:var(--amber);animation:pulse 1s var(--ease) infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(129,201,149,.45)}70%{box-shadow:0 0 0 6px rgba(129,201,149,0)}100%{box-shadow:0 0 0 0 rgba(129,201,149,0)}}

/* ───────────────────────── Sub bar ───────────────────────── */
.gem-subbar{display:flex;align-items:center;gap:var(--s-3);padding:.45rem var(--s-5);font-size:.72rem;color:var(--g-text-3);flex-shrink:0;overflow-x:auto;scrollbar-width:none;border-bottom:1px solid var(--border);background:color-mix(in srgb,var(--bg-1) 40%,transparent)}
.gem-subbar::-webkit-scrollbar{display:none}
.gem-subbar #session-title{font-weight:600;color:var(--g-text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:50%;cursor:text;border-bottom:1px dashed transparent;transition:border-color .15s;letter-spacing:-.01em}
.gem-subbar #session-title:hover{border-bottom-color:var(--g-text-3)}
.gem-subbar #session-title.editing{outline:none;border-bottom-color:var(--g-accent);background:var(--g-surface-2);padding:0 .3rem;border-radius:3px}
.pr-link-card{margin:.5rem 0;padding:.6rem .8rem;background:var(--green-soft);border:1px solid color-mix(in srgb,var(--green) 30%,transparent);border-radius:var(--r-md);display:flex;align-items:center;gap:.5rem;font-size:.8rem}
.pr-link-card a{color:var(--green);text-decoration:none;font-weight:600}
.pr-link-card a:hover{text-decoration:underline}
.pr-link-card .pr-icon{font-size:1rem}
.gem-subbar .info{display:flex;align-items:center;gap:.35rem;white-space:nowrap;flex-shrink:0}
.gem-subbar .info code{font-family:var(--mono);font-size:.7rem;color:var(--g-text-2);background:var(--g-surface-2);padding:.12em .4em;border-radius:5px}
.gem-subbar .sep{opacity:.4;flex-shrink:0}
.agent-status{display:inline-flex;align-items:center;gap:.35rem;color:var(--g-accent);font-weight:600;white-space:nowrap}
.agent-status .status-icon{width:7px;height:7px;border-radius:50%;background:var(--g-accent);animation:pulse 1.4s var(--ease) infinite}
.elapsed{font-family:var(--mono);font-size:.68rem;color:var(--g-text-3);white-space:nowrap}

/* Permission toggle */
.perm-toggle{display:inline-flex;align-items:stretch;gap:0;border:1px solid var(--g-line);border-radius:var(--r-md);overflow:hidden;flex-shrink:0;background:var(--glass-1);max-width:100%}
.perm-btn{font-size:.68rem;padding:.28rem .55rem;border:none;background:transparent;color:var(--g-text-3);cursor:pointer;font-family:var(--mono);font-weight:600;transition:all var(--t);white-space:nowrap;line-height:1.35;min-height:30px}
.perm-btn:hover{background:var(--g-hover);color:var(--g-text)}
.perm-btn.active{background:var(--accent-soft);color:var(--accent)}
.perm-btn+.perm-btn{border-left:1px solid var(--g-line)}
.perm-btn:disabled{opacity:.55;cursor:wait}

/* Approval modal */
.approval-card{background:var(--g-surface-2);border:1px solid var(--amber);border-radius:var(--r-md);padding:var(--s-3) var(--s-4);margin:.4rem 0;animation:rise .25s var(--ease)}
.approval-card .approval-header{display:flex;align-items:center;gap:var(--s-2);margin-bottom:var(--s-2);font-size:.82rem;font-weight:600;color:var(--amber)}
.approval-card .approval-header .approval-icon{font-size:1rem}
.approval-card .approval-tool{font-family:var(--mono);font-size:.78rem;color:var(--g-text-2);background:var(--g-surface-3);padding:.3rem .6rem;border-radius:6px;margin-bottom:var(--s-2);word-break:break-all}
.approval-card .approval-args{font-family:var(--mono);font-size:.74rem;color:var(--g-text-3);max-height:120px;overflow-y:auto;margin-bottom:var(--s-2);white-space:pre-wrap;word-break:break-all}
.approval-card .approval-actions{display:flex;gap:var(--s-2)}
.approval-card .approval-btn{font-size:.78rem;padding:.35rem .8rem;border-radius:var(--r-full);border:none;cursor:pointer;font-weight:600;font-family:var(--font);transition:all var(--t)}
.approval-card .approval-btn.approve{background:var(--green);color:#fff}
.approval-card .approval-btn.approve:hover{filter:brightness(1.1)}
.approval-card .approval-btn.deny{background:var(--g-surface-3);color:var(--g-text-2);border:1px solid var(--g-line)}
.approval-card .approval-btn.deny:hover{background:var(--red-soft);color:var(--red);border-color:var(--red)}

/* Diff review card */
.diff-card{background:var(--g-surface-2);border:1px solid var(--g-line);border-radius:var(--r-md);margin:.5rem 0;overflow:hidden;animation:rise .25s var(--ease)}
.diff-card-header{display:flex;align-items:center;gap:var(--s-2);padding:.4rem .7rem;background:var(--g-surface-3);cursor:pointer;font-size:.78rem;font-weight:600;color:var(--g-text-2);transition:background var(--t)}
.diff-card-header:hover{background:var(--g-hover)}
.diff-card-header .diff-file{font-family:var(--mono);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.diff-card-header .diff-badge{font-size:.64rem;padding:.1em .45em;border-radius:var(--r-full);font-weight:700;flex-shrink:0}
.diff-badge.write{background:var(--green-soft);color:var(--green)}
.diff-badge.patch{background:var(--accent-soft);color:var(--accent)}
.diff-card-header .diff-chevron{font-size:.7rem;transition:transform var(--t);flex-shrink:0}
.diff-card-header.open .diff-chevron{transform:rotate(90deg)}
.diff-card-body{display:none;padding:var(--s-2) var(--s-3);max-height:300px;overflow-y:auto;font-family:var(--mono);font-size:.74rem;line-height:1.5}
.diff-card-body.open{display:block}

/* File-changes summary card (end of turn) */
.file-changes-card{background:var(--g-surface-2);border:1px solid var(--g-line);border-radius:var(--r-md);margin:.75rem 0 0;overflow:hidden;animation:rise .25s var(--ease)}
.file-changes-card .fc-head{padding:.55rem .85rem;font-size:.78rem;font-weight:600;color:var(--g-text-2);background:var(--g-surface-3);border-bottom:1px solid var(--g-line)}
.file-changes-card .fc-list{padding:.4rem .85rem .6rem;display:flex;flex-direction:column;gap:.2rem}
.file-changes-card .fc-item{display:flex;align-items:center;gap:.5em;font-family:var(--mono);font-size:.72rem;color:var(--g-text-2);padding:.15rem 0}
.file-changes-card .fc-icon{opacity:.6;font-size:.8em}

/* Activity stats card — high-level summary of what the agent did this turn.
   Sits next to the file-changes card so the user gets a single glance view. */
.stats-card{background:var(--g-surface-2);border:1px solid var(--g-line);border-radius:var(--r-md);margin:.5rem 0 0;overflow:hidden;animation:rise .25s var(--ease)}
.stats-card .stats-head{padding:.5rem .85rem;font-size:.78rem;font-weight:600;color:var(--g-text-2);background:var(--g-surface-3);border-bottom:1px solid var(--g-line)}
.stats-card .stats-line{padding:.55rem .85rem;font-size:.78rem;color:var(--g-text-2);line-height:1.55}
.stats-card .stats-line strong{color:var(--g-text);font-weight:600}
.stats-card .stat-err{color:var(--red);font-weight:600}

/* Stage log — live "what is the agent doing right now" ticker that appears
   above the streaming response and disappears once the answer lands. */
.stage-log{margin:.5rem 0 0;background:var(--g-surface-2);border:1px solid var(--g-line);border-radius:var(--r-md);overflow:hidden;animation:rise .2s var(--ease)}
.stage-log .stage-log-head{padding:.4rem .85rem;font-size:.7rem;font-weight:600;color:var(--g-text-3);background:var(--g-surface-3);border-bottom:1px solid var(--g-line);text-transform:uppercase;letter-spacing:.04em}
.stage-log .stage-log-body{padding:.4rem .85rem .5rem;display:flex;flex-direction:column;gap:.2rem;max-height:170px;overflow:hidden}
.stage-log .stage-line{font-size:.74rem;color:var(--g-text-3);font-family:var(--mono);padding:.1rem 0;animation:fadein .25s var(--ease);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stage-log .stage-line:first-child{color:var(--g-text-2);font-weight:500}
@keyframes fadein{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:translateY(0)}}

/* Context window bar */
.ctx-bar-wrap{display:flex;align-items:center;gap:.4rem;flex-shrink:0}
.ctx-bar{width:70px;height:5px;background:var(--g-surface-2);border-radius:3px;overflow:hidden;position:relative}
.ctx-bar-fill{height:100%;border-radius:3px;transition:width .4s var(--ease);background:var(--g-accent)}
.ctx-bar-fill.warn{background:var(--amber)}
.ctx-bar-fill.crit{background:var(--red)}
.ctx-label{font-size:.65rem;color:var(--g-text-3);font-family:var(--mono);white-space:nowrap}

/* ───────────────────────── Drawer ───────────────────────── */
.gem-scrim{display:none}@media(max-width:860px){.gem-scrim{display:block;position:fixed;inset:0;background:rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:opacity .25s var(--ease);z-index:42}.gem-scrim.open{opacity:1;pointer-events:auto}}
.gem-scrim.open{opacity:1;pointer-events:auto}
.gem-drawer{width:264px;background:var(--bg-1);border-right:1px solid var(--border);display:flex;flex-direction:column;min-height:0;overflow:hidden}@media(max-width:860px){.gem-drawer{position:fixed;top:0;left:0;bottom:0;width:min(288px,84vw);z-index:50;box-shadow:var(--shadow-lg);transform:translateX(-104%);transition:transform .28s var(--ease);padding-top:env(safe-area-inset-top)}.gem-drawer.open{transform:none}}
.gem-drawer.open{transform:none}
.gem-drawer-head{display:flex;align-items:center;gap:var(--s-2);padding:var(--s-3) var(--s-3) var(--s-2) var(--s-5)}
.gem-drawer-title{flex:1;font-size:1.25rem;font-weight:600;letter-spacing:-.01em}
.gem-drawer-item{display:flex;align-items:center;gap:var(--s-3);width:calc(100% - var(--s-4));margin:.15rem var(--s-2);padding:.65rem var(--s-3);border:none;background:var(--accent);color:var(--on-accent);font-size:.88rem;font-family:var(--font);font-weight:600;cursor:pointer;border-radius:var(--r-md);transition:filter var(--t),transform var(--t);text-align:left;box-shadow:var(--e1)}
.gem-drawer-item:hover{filter:brightness(1.08);transform:translateY(-1px);background:var(--accent)}
.gem-di-ico{width:22px;text-align:center;flex-shrink:0;color:inherit;display:inline-flex;align-items:center;justify-content:center;opacity:.9}
.gem-search{padding:var(--s-2) var(--s-3)}
.gem-search input{width:100%;padding:.55rem .9rem;border-radius:var(--r-full);border:1px solid var(--g-line);background:var(--g-surface-2);color:var(--g-text);font-size:.82rem;font-family:var(--font);outline:none;transition:border-color var(--t)}
.gem-search input:focus{border-color:var(--g-accent)}
.gem-drawer-sec{padding:var(--s-3) var(--s-5) var(--s-1);font-size:.72rem;font-weight:600;color:var(--g-text-3)}
.gem-recents{flex:1;overflow-y:auto;padding:0 var(--s-2) var(--s-2);scrollbar-width:thin}
.gem-recent{display:block;width:100%;padding:.6rem var(--s-3);border:none;background:transparent;color:var(--g-text-2);font-size:.85rem;font-family:var(--font);cursor:pointer;border-radius:var(--r-md);transition:background var(--t),color var(--t);text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:1px 0}
.gem-recent:hover{background:var(--g-hover);color:var(--g-text)}
.gem-recent.active{background:var(--g-active);color:var(--g-accent);font-weight:600}
.gem-recent .gem-recent-dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:.5rem;vertical-align:middle}
.gem-recent .gem-recent-dot.active{background:var(--green)}
.gem-recent .gem-recent-dot.error{background:var(--red)}
.gem-recent .gem-recent-dot.completed{background:var(--g-accent)}
.gem-recent .gem-recent-dot.idle,.gem-recent .gem-recent-dot.stub{background:var(--g-text-3)}
.gem-recents-empty{padding:var(--s-4) var(--s-5);font-size:.8rem;color:var(--g-text-3)}
.gem-drawer-foot{border-top:1px solid var(--g-line);padding:var(--s-3) var(--s-4);padding-bottom:max(var(--s-3),env(safe-area-inset-bottom));display:flex;align-items:center;gap:var(--s-3)}
.gem-user{display:flex;align-items:center;gap:var(--s-3);flex:1;min-width:0}
.gem-avatar-sm{width:34px;height:34px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.85rem;color:#fff;background:var(--accent)}
.gem-user-name{font-size:.85rem;font-weight:600;color:var(--g-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gem-user-sub{font-size:.72rem;color:var(--g-text-3)}

/* ───────────────────────── Messages ───────────────────────── */
.code-messages{flex:1;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:var(--s-5) var(--s-5) var(--s-8);display:flex;flex-direction:column;align-items:center;gap:var(--s-6);scroll-behavior:smooth;scrollbar-width:thin}
.code-messages>*{width:100%;max-width:760px;margin-left:auto;margin-right:auto}
.msg{display:flex;gap:var(--s-3);max-width:100%;animation:rise .34s var(--ease) both}
.msg.user{flex-direction:row-reverse}
.msg-avatar{width:30px;height:30px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;flex-shrink:0;position:relative}
.msg-avatar.ai{background:linear-gradient(135deg,var(--accent),var(--accent-2));color:var(--on-accent);box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 30%,transparent)}
.msg-avatar.ai .gem-spark{display:flex;align-items:center;justify-content:center}
.msg-avatar.ai .gem-spark svg{fill:#fff!important}
.msg-avatar.person{background:var(--accent);color:var(--on-accent);font-size:.78rem;font-weight:700;border-radius:50%}
.msg-body{max-width:calc(100% - 44px);min-width:0;display:flex;flex-direction:column}
.msg.user .msg-body{align-items:flex-end;max-width:82%}
.msg-name{font-size:.72rem;font-weight:600;color:var(--g-text-3);margin-bottom:.3rem;letter-spacing:.01em}
.msg.user .msg-name{display:none}
.msg-content{line-height:1.7;font-size:.94rem;word-break:break-word;max-width:100%;color:var(--g-text)}
.msg.user .msg-content{background:var(--surface-2);padding:.7rem 1.05rem;border-radius:var(--r-lg);border-bottom-right-radius:6px;color:var(--g-text);border:1px solid var(--border);box-shadow:var(--hi)}
.msg.ai .msg-content code{background:var(--g-surface-2);padding:.14em .4em;border-radius:5px;font-family:var(--mono);font-size:.84em}
.msg.ai .msg-content pre{background:var(--g-code);border:1px solid var(--g-line);border-radius:var(--r-md);padding:var(--s-3) var(--s-4);overflow-x:auto;margin:.6rem 0;font-size:.82rem;line-height:1.55;white-space:pre;scrollbar-width:thin}
.msg.ai .msg-content pre code{background:none;padding:0;font-size:inherit}
.msg.ai .msg-content h3{font-size:1rem;font-weight:700;margin:.8rem 0 .35rem;letter-spacing:-.01em}
.msg.ai .msg-content h3:first-child{margin-top:0}
.msg.ai .msg-content p{margin:.4rem 0}
.msg.ai .msg-content p:first-child{margin-top:0}
.msg.ai .msg-content p:last-child{margin-bottom:0}
.msg.ai .msg-content ul,.msg.ai .msg-content ol{padding-left:1.4rem;margin:.4rem 0}
.msg.ai .msg-content li{margin:.2rem 0}
.msg.ai .msg-content a{color:var(--g-accent)}
.msg.ai .msg-content strong{font-weight:700}

/* ───────────────── Dynamic tool-call panels ───────────────── */
.tool-panel{margin:var(--s-3) 0;border:1px solid var(--g-line);border-radius:var(--r-md);overflow:hidden;font-size:.82rem;background:var(--g-surface-2);animation:rise .25s var(--ease) both;box-shadow:var(--hi)}
.tool-panel.is-err{border-color:color-mix(in srgb,var(--red) 35%,var(--g-line))}
.tool-header{display:flex;align-items:center;gap:var(--s-2);padding:.55rem var(--s-3);cursor:pointer;user-select:none;-webkit-user-select:none;transition:background var(--t);background:color-mix(in srgb,var(--surface) 50%,transparent)}
.tool-header:hover{background:var(--g-hover)}
.tool-icon{font-size:.95rem;flex-shrink:0;width:1.3em;text-align:center;line-height:1}
.tool-verb-main{font-weight:600;font-size:.8rem;color:var(--g-text);flex-shrink:0}
.tool-name{font-weight:600;font-family:var(--mono);font-size:.66rem;color:var(--g-text-3);background:var(--g-surface-3);padding:.1em .45em;border-radius:5px;flex-shrink:0;letter-spacing:.02em}
.tool-args{color:var(--g-accent);font-family:var(--mono);font-size:.75rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.tool-meta{font-size:.68rem;font-family:var(--mono);color:var(--g-text-3);flex-shrink:0;white-space:nowrap}
.tool-meta .m-add{color:var(--green);font-weight:600}
.tool-meta .m-del{color:var(--red);font-weight:600}
.tool-status{font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:.2em .55em;border-radius:var(--r-full);flex-shrink:0;display:inline-flex;align-items:center;gap:.4em}
.tool-status.ok{background:var(--green-soft);color:var(--green)}
.tool-status.err{background:var(--red-soft);color:var(--red)}
.tool-status.running{background:var(--amber-soft);color:var(--amber)}
.tool-status.running::before{content:'';width:8px;height:8px;border:1.5px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin .7s linear infinite}
.tool-toggle{color:var(--g-text-3);font-size:.7rem;transition:transform var(--t);flex-shrink:0;width:1em;text-align:center}
.tool-toggle.open{transform:rotate(90deg)}
.tool-body{display:none;background:var(--g-code);border-top:1px solid var(--g-line);max-height:420px;overflow:auto;scrollbar-width:thin}
.tool-body.open{display:block}
.tool-body .tb-pad{padding:var(--s-3);font-family:var(--mono);font-size:.76rem;line-height:1.55;white-space:pre;overflow-x:auto}
.tool-body .tb-text{padding:var(--s-3);font-family:var(--mono);font-size:.76rem;line-height:1.55;white-space:pre-wrap;word-break:break-word;color:var(--g-text-2)}
.tool-status.empty{background:var(--amber-soft);color:var(--amber)}
.tool-panel.is-empty{border-color:color-mix(in srgb,var(--amber) 28%,var(--g-line))}
/* grouped consecutive tool calls */
.tool-group{margin:var(--s-3) 0;border:1px solid var(--g-line);border-radius:var(--r-md);overflow:hidden;background:var(--g-surface-2);animation:rise .25s var(--ease) both}
.tool-group-head{display:flex;align-items:center;gap:var(--s-2);padding:.45rem var(--s-3);cursor:pointer;user-select:none;-webkit-user-select:none;font-size:.78rem;transition:background var(--t)}
.tool-group-head:hover{background:var(--g-hover)}
.tool-group-head .tg-chevron{color:var(--g-text-3);font-size:.7rem;transition:transform var(--t);width:1em;text-align:center}
.tool-group-head .tg-chevron:not(.open){transform:rotate(-90deg)}
.tool-group-head .tg-label{font-weight:600;color:var(--g-text-2)}
.tool-group-head .tg-summary{flex:1;min-width:0;font-family:var(--mono);font-size:.7rem;color:var(--g-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tg-summary .tg-ok{color:var(--green)}
.tg-summary .tg-empty{color:var(--amber)}
.tg-summary .tg-err{color:var(--red)}
.tool-group-body{display:none}
.tool-group-body.open{display:block}
.tool-group-body .tool-panel{margin:0;border-width:0;border-top:1px solid var(--g-line);border-radius:0;animation:none;background:transparent}
.tool-group-body .tool-panel.is-err{border-top-color:color-mix(in srgb,var(--red) 35%,var(--g-line))}
/* raw output toggle */
.tool-raw{border-top:1px dashed var(--g-line);padding:var(--s-2) var(--s-3);background:var(--g-surface-2)}
.tool-raw-btn{background:transparent;border:1px solid var(--g-line);color:var(--g-text-3);font-size:.68rem;font-family:var(--mono);padding:.2em .65em;border-radius:var(--r-md);cursor:pointer;transition:all var(--t)}
.tool-raw-btn:hover{background:var(--g-hover);color:var(--g-text-2)}
.tool-raw-pre{margin:var(--s-2) 0 0;padding:var(--s-2);background:var(--g-code);border-radius:var(--r-md);font-family:var(--mono);font-size:.72rem;line-height:1.5;white-space:pre-wrap;word-break:break-word;color:var(--g-text-2);max-height:300px;overflow:auto}
/* file-content / numbered listing */
.code-listing{font-family:var(--mono);font-size:.74rem;line-height:1.5;white-space:pre;counter-reset:none}
.code-listing .cl-row{display:flex}
.code-listing .cl-gutter{flex:0 0 auto;min-width:2.6em;padding:0 .7em 0 .9em;text-align:right;color:var(--g-text-3);opacity:.55;user-select:none;-webkit-user-select:none}
.code-listing .cl-code{flex:1;padding-right:var(--s-3);color:var(--g-text)}
/* diff rendering — line-numbered, GitHub-style gutters */
.diff-view{font-family:var(--mono);font-size:.74rem;line-height:1.5;white-space:pre}
.diff-view .diff-file{display:flex;align-items:center;gap:.4em;padding:.45rem var(--s-3);background:var(--g-surface-2);border-bottom:1px solid var(--g-line);color:var(--g-text-2);font-weight:600;font-size:.72rem;position:sticky;top:0}
.diff-view .dl{display:flex}
.diff-view .dl-num{flex:0 0 auto;width:3.2em;padding:0 .55em;text-align:right;color:var(--g-text-3);opacity:.5;user-select:none;-webkit-user-select:none}
.diff-view .dl-mark{flex:0 0 auto;width:1.1em;text-align:center;user-select:none;-webkit-user-select:none}
.diff-view .dl-text{flex:1;padding-right:var(--s-3);white-space:pre}
.diff-view .dl.add{background:color-mix(in srgb,var(--green) 13%,transparent)}
.diff-view .dl.add .dl-mark,.diff-view .dl.add .dl-text{color:var(--green)}
.diff-view .dl.del{background:color-mix(in srgb,var(--red) 13%,transparent)}
.diff-view .dl.del .dl-mark,.diff-view .dl.del .dl-text{color:var(--red)}
.diff-view .dl.hunk{background:color-mix(in srgb,var(--cyan) 12%,transparent)}
.diff-view .dl.hunk .dl-text,.diff-view .dl.hunk .dl-num{color:var(--cyan);opacity:1}
.diff-view .dl.meta .dl-text{color:var(--g-text-3)}

/* Thinking indicator */
.thinking{display:flex;align-items:center;gap:var(--s-2);padding:.3rem 0;color:var(--g-text-3);font-size:.85rem}
.thinking .dots span{animation:dotPulse 1.4s infinite;opacity:.3;font-weight:700}
.thinking .dots span:nth-child(2){animation-delay:.2s}
.thinking .dots span:nth-child(3){animation-delay:.4s}
@keyframes dotPulse{0%,80%,100%{opacity:.3}40%{opacity:1}}

/* Siri-inspired loading and streaming indicator */
.siri-loader,.streaming-cursor,.loading .spinner{display:inline-block;flex:0 0 auto;width:24px;height:24px;border:0;border-radius:50%;background:radial-gradient(circle at 50% 8%,#fff 0 2px,transparent 2.7px),radial-gradient(circle at 80% 20%,#d9f2ff 0 2px,transparent 2.7px),radial-gradient(circle at 92% 50%,#9ee7ff 0 2px,transparent 2.7px),radial-gradient(circle at 80% 80%,#83ddff 0 2px,transparent 2.7px),radial-gradient(circle at 50% 92%,#b9edff 0 2px,transparent 2.7px),radial-gradient(circle at 20% 80%,#fff4df 0 2px,transparent 2.7px),radial-gradient(circle at 8% 50%,#fff 0 2px,transparent 2.7px),radial-gradient(circle at 20% 20%,#c9ebff 0 2px,transparent 2.7px);filter:drop-shadow(0 0 4px rgba(166,225,255,.88));animation:siriOrbit 1.05s cubic-bezier(.45,0,.55,1) infinite;vertical-align:middle;margin-left:4px}
@keyframes siriOrbit{to{transform:rotate(360deg)}}

/* ───────────────────────── Composer ───────────────────────── */
.code-input{flex-shrink:0;padding:var(--s-2) var(--s-4) var(--s-4);padding-bottom:max(var(--s-4),env(safe-area-inset-bottom));background:linear-gradient(180deg,transparent,color-mix(in srgb,var(--bg-0) 88%,transparent) 28%)}
.code-input .input-row,.code-input .input-hint,.code-input #img-preview-strip{max-width:760px;margin-left:auto;margin-right:auto}
.input-row{display:flex;gap:var(--s-2);align-items:flex-end;background:var(--surface);border:1px solid var(--g-input-border);border-radius:var(--r-xl);padding:.4rem .4rem .4rem .7rem;transition:border-color var(--t),box-shadow var(--t);box-shadow:var(--e1),var(--hi)}
.input-row:focus-within{border-color:color-mix(in srgb,var(--g-accent) 55%,transparent);box-shadow:var(--ring),var(--e2)}
.input-plus{width:36px;height:36px;border-radius:var(--r-md);border:none;background:transparent;color:var(--g-text-2);font-size:1.3rem;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:background var(--t),color var(--t)}
.input-plus:hover{background:var(--g-hover);color:var(--g-text)}
.input-attach{width:34px;height:34px;border-radius:var(--r-md);border:none;background:transparent;color:var(--g-text-3);font-size:1rem;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:background var(--t),color var(--t)}
.input-attach:hover{background:var(--g-hover);color:var(--accent)}
.input-attach.has-images{color:var(--accent)}
/* Image preview strip above the input */
.img-preview-strip{display:flex;gap:var(--s-2);padding:var(--s-2) var(--s-3) var(--s-1);flex-wrap:wrap}
.img-thumb{position:relative;flex-shrink:0}
.img-thumb img{width:64px;height:64px;object-fit:cover;border-radius:6px;border:1px solid var(--g-line);display:block}
.img-thumb .img-rm{position:absolute;top:-5px;right:-5px;width:16px;height:16px;border-radius:50%;background:var(--red);color:#fff;border:none;cursor:pointer;font-size:.6rem;display:flex;align-items:center;justify-content:center;line-height:1}
.img-thumb .img-rm:hover{background:#c0392b}
.input-field{flex:1;min-height:38px;max-height:170px;padding:.55rem .35rem;background:transparent;border:none;color:var(--g-text);font-size:.95rem;font-family:var(--font);line-height:1.5;resize:none;outline:none;-webkit-appearance:none}
.input-field::placeholder{color:var(--g-text-3)}
.send-btn{width:38px;height:38px;border-radius:var(--r-md);background:var(--g-accent);border:none;color:var(--on-accent);font-size:1.05rem;cursor:pointer;transition:all var(--t);flex-shrink:0;display:flex;align-items:center;justify-content:center;box-shadow:var(--e1)}
.send-btn:hover{filter:brightness(1.08);transform:scale(1.04)}
.send-btn:disabled{opacity:.4;cursor:not-allowed;transform:none;filter:none;box-shadow:none}
.send-btn.cancel{background:var(--red);color:#fff}
.send-btn svg{width:18px;height:18px}
.input-hint{display:flex;align-items:center;gap:var(--s-3);margin-top:var(--s-2);padding:0 var(--s-3);font-size:.68rem;color:var(--g-text-3);justify-content:center}
.input-hint kbd{background:var(--g-surface-2);border:1px solid var(--g-line);border-radius:4px;padding:.1em .4em;font-family:var(--mono);font-size:.66rem}
@media(max-width:600px){.input-hint .hint-keys{display:none}}

/* ───────────────────────── Greeting / empty ───────────────────────── */
.empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;gap:var(--s-4);text-align:center;padding:var(--s-8) var(--s-5);animation:rise .5s var(--ease) both}
.empty-state .gem-greet-spark{width:52px;height:52px;border-radius:var(--r-md);display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--accent),var(--accent-2));box-shadow:var(--e2),0 0 0 1px color-mix(in srgb,var(--accent) 35%,transparent);margin-bottom:var(--s-1)}
.empty-state .gem-greet-spark .gem-spark svg{fill:#fff!important}
.empty-state h2{font-size:clamp(1.45rem,4.5vw,1.95rem);font-weight:700;letter-spacing:-.03em;color:var(--g-text);line-height:1.2}
.empty-state p{font-size:.9rem;max-width:420px;line-height:1.6;color:var(--g-text-3)}
.empty-state .suggestions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s-2);margin-top:var(--s-3);max-width:520px;width:100%}
.empty-state .suggestion{font-size:.8rem;padding:.75rem .9rem;border-radius:var(--r-md);border:1px solid var(--g-line);background:color-mix(in srgb,var(--surface) 80%,transparent);color:var(--g-text-2);cursor:pointer;transition:all var(--t);display:flex;align-items:center;gap:.55rem;text-align:left;box-shadow:var(--hi)}
.empty-state .suggestion:hover{background:var(--g-surface-2);border-color:color-mix(in srgb,var(--g-accent) 40%,transparent);color:var(--g-text);transform:translateY(-1px)}
.empty-state .suggestion .s-ico{font-size:.95em;color:var(--accent);flex-shrink:0}
@media(max-width:520px){.empty-state .suggestions{grid-template-columns:1fr}}

/* Loading */
.loading{display:flex;align-items:center;justify-content:center;flex:1;color:var(--g-text-3);font-size:.9rem;gap:var(--s-2)}
.loading .spinner{margin-left:0}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

/* Floating stop button */
.stop-fab{position:fixed;bottom:104px;left:50%;transform:translateX(-50%);z-index:20;display:none;align-items:center;gap:.45rem;padding:.5rem 1.1rem;background:var(--red);border:none;border-radius:var(--r-full);color:#fff;font-size:.82rem;font-weight:600;font-family:var(--font);cursor:pointer;box-shadow:0 6px 22px -6px rgba(217,48,37,.6);transition:all var(--t);animation:rise .25s var(--ease)}
.stop-fab:hover{filter:brightness(1.06);transform:translateX(-50%) scale(1.04)}
.stop-fab.visible{display:flex}
.stop-fab .stop-icon{width:12px;height:12px;border-radius:3px;background:#fff;flex-shrink:0}

/* Live Codex terminal — structured activity only, never a browser shell. */
.live-terminal{position:fixed;left:16px;right:16px;bottom:92px;z-index:34;height:min(42vh,390px);display:flex;flex-direction:column;background:color-mix(in srgb,#050907 94%,var(--bg-0));border:1px solid color-mix(in srgb,var(--green) 32%,var(--border));border-radius:14px;box-shadow:0 22px 70px rgba(0,0,0,.5),inset 0 1px rgba(255,255,255,.04);overflow:hidden;transform:translateY(calc(100% + 120px));opacity:0;pointer-events:none;transition:transform .22s var(--ease),opacity .22s var(--ease)}
.live-terminal.open{transform:none;opacity:1;pointer-events:auto}
.lt-head{display:flex;align-items:center;gap:9px;padding:9px 12px;border-bottom:1px solid rgba(74,222,128,.17);background:linear-gradient(180deg,rgba(74,222,128,.07),transparent);flex-shrink:0}
.lt-lights{display:flex;gap:5px}.lt-light{width:8px;height:8px;border-radius:50%;background:#334139}.lt-light.live{background:#4ade80;box-shadow:0 0 9px rgba(74,222,128,.72)}
.lt-title{font:700 .72rem/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:#b7f7c8;flex:1}
.lt-route{font:500 .64rem/1 var(--mono);color:#5e8d6b}.lt-route strong{color:#4ade80}
.lt-action{border:0;background:transparent;color:#71917a;font:600 .67rem var(--mono);cursor:pointer;padding:6px 7px;border-radius:6px}.lt-action:hover{background:rgba(74,222,128,.09);color:#b7f7c8}
.lt-output{flex:1;overflow:auto;padding:12px 14px;font:500 .72rem/1.55 var(--mono);color:#8fc99e;white-space:pre-wrap;overflow-wrap:anywhere;scrollbar-width:thin;scrollbar-color:#274c31 transparent}
.lt-line{display:grid;grid-template-columns:72px minmax(0,1fr);gap:9px;padding:2px 0}.lt-time{color:#405c48;user-select:none}.lt-command{color:#d4ffe0}.lt-command::before{content:'› ';color:#4ade80}.lt-result{color:#87a990}.lt-error{color:#ff8f8f}.lt-info{color:#6fa7ce}
.lt-empty{height:100%;display:flex;align-items:center;justify-content:center;text-align:center;color:#486652;line-height:1.7}.lt-empty strong{display:block;color:#75aa84;font-size:.8rem}
.terminal-btn.active{background:rgba(74,222,128,.1);color:var(--green)}

/* Tables */
.msg.ai .msg-content table{border-collapse:collapse;width:100%;margin:.6rem 0;font-size:.82rem}
.msg.ai .msg-content th{background:var(--g-surface-2);color:var(--g-text-2);font-weight:600;text-align:left;padding:.45rem .65rem;border:1px solid var(--g-line);font-size:.76rem}
.msg.ai .msg-content td{padding:.4rem .65rem;border:1px solid var(--g-line);color:var(--g-text)}
.msg.ai .msg-content tr:hover td{background:var(--g-hover)}

/* Mermaid diagrams */
.mermaid-wrap{margin:.8rem 0;padding:var(--s-4) var(--s-3);background:var(--g-surface-2);border:1px solid var(--g-line);border-radius:var(--r-md);overflow-x:auto;text-align:center;position:relative}
.mermaid-wrap::before{content:'diagram';position:absolute;top:7px;right:11px;font-size:.6rem;text-transform:uppercase;letter-spacing:.08em;color:var(--g-text-3);opacity:.6}
.mermaid-wrap svg{max-width:100%;height:auto}
.mermaid-err{color:var(--red);font-size:.75rem;font-family:var(--mono);padding:.5rem;text-align:left;white-space:pre-wrap}

@media(max-width:600px){
  .gem-top{padding:var(--s-2) var(--s-2);padding-top:max(var(--s-2),env(safe-area-inset-top))}
  .page-nav-toggle{display:flex}
  .model-picker-btn{font-size:.86rem}
  .model-picker-btn .gem-model-tag{max-width:84px}
  .gem-icon-btn{width:44px;height:44px}
  .gem-subbar{flex-wrap:wrap;gap:.45rem .55rem;padding:.4rem var(--s-3);align-items:center}
  .gem-subbar #session-title{max-width:100%;flex:1 1 100%;order:-1;font-size:.78rem}
  .gem-subbar .sep{display:none}
  .perm-toggle{width:100%;display:grid;grid-auto-flow:column;grid-auto-columns:1fr;flex-shrink:1}
  .perm-btn{min-height:40px;padding:.35rem .4rem;font-size:.72rem;text-align:center}
  .ctx-bar-wrap{width:100%}
  .ctx-bar{flex:1;width:auto}
  .approval-card{padding:var(--s-3)}
  .approval-card .approval-actions{flex-wrap:wrap}
  .approval-card .approval-btn{min-height:40px;flex:1 1 calc(50% - .35rem)}
  .code-messages{padding:var(--s-4) var(--s-4) var(--s-6);gap:var(--s-5)}
  .code-input{padding:var(--s-2) var(--s-3) var(--s-3);padding-bottom:max(var(--s-3),env(safe-area-inset-bottom))}
  .msg-content{font-size:.92rem}
  .msg.user .msg-body{max-width:88%}
  .tool-body{max-height:260px;font-size:.72rem}
  .input-field{font-size:16px}
  .empty-state .suggestions{grid-template-columns:1fr}
}

/* ─── Design refinement pass (2026-07) ──────────────────────────────────
   Layered last. Same thesis as the sessions list: depth and finish through
   elevation, hairlines, rhythm and micro-typography — the neutral platform
   look, just more considered. No new colour vocabulary.                    */

/* Top bar — settles onto a hairline once you scroll; brand tightens up */
.gem-top{border-bottom-color:var(--border)}
.gem-brand-name,.model-picker-btn{letter-spacing:-.02em}
.model-picker-btn{transition:background var(--t),border-color var(--t),box-shadow var(--t)}
.model-picker-btn:hover{box-shadow:var(--hi)}
.ws-dot.connected{box-shadow:0 0 0 3px color-mix(in srgb,var(--green) 18%,transparent)}

/* Messages — tighten the column rhythm a touch and quiet the repeated name */
.code-messages{gap:var(--s-5)}
.msg-name{font-size:.7rem;color:var(--g-text-3);opacity:.85;text-transform:none}
.msg-avatar.ai{box-shadow:var(--hi),0 0 0 1px color-mix(in srgb,var(--accent) 32%,transparent),0 2px 6px -2px color-mix(in srgb,var(--accent) 45%,transparent)}
.msg-content{font-size:.925rem;line-height:1.72}
.msg.ai .msg-content h3{letter-spacing:-.015em}

/* User bubble — a hair more depth so it reads as "yours" without shouting */
.msg.user .msg-content{background:linear-gradient(180deg,color-mix(in srgb,var(--surface-2) 92%,var(--accent-soft)),var(--surface-2));box-shadow:var(--e1),var(--hi)}

/* Inline code & code blocks — crisper container, subtle top highlight */
.msg.ai .msg-content code{border:1px solid var(--border)}
.msg.ai .msg-content pre{box-shadow:var(--hi);background:color-mix(in srgb,var(--g-code) 92%,var(--bg-1))}

/* Tool panels & groups — clearer resting elevation, springier open chevron */
.tool-panel,.tool-group{box-shadow:var(--e1),var(--hi)}
.tool-header,.tool-group-head{transition:background var(--t)}
.tool-toggle,.tg-chevron{transition:transform var(--t-slow),color var(--t)}
.tool-name{border:1px solid var(--border)}
.tool-status{box-shadow:var(--hi);font-variant-numeric:tabular-nums}
.tool-group-head .tg-label{letter-spacing:.01em}
/* nested panels stay flat inside a group (avoid double shadows) */
.tool-group-body .tool-panel{box-shadow:none}

/* Diff / file-change / stats cards — one consistent finished card language */
.diff-card,.file-changes-card,.stats-card,.stage-log{box-shadow:var(--e1),var(--hi)}
.diff-badge,.pr-state{box-shadow:var(--hi);font-variant-numeric:tabular-nums}

/* Sub bar — quieter dividers, legible worktree/model chips */
.gem-subbar .info code{border:1px solid var(--border)}
.perm-toggle{box-shadow:var(--hi)}
.ctx-bar{box-shadow:inset 0 0 0 1px var(--border)}
.ctx-bar-fill{box-shadow:0 0 8px -1px color-mix(in srgb,var(--accent) 55%,transparent)}

/* Composer — the primary surface: more presence, springier send, calm focus */
.input-row{box-shadow:var(--e2),var(--hi);transition:border-color var(--t),box-shadow var(--t),transform var(--t)}
.input-row:focus-within{box-shadow:var(--ring),var(--e2),var(--hi)}
.send-btn{transition:filter var(--t),transform var(--t),box-shadow var(--t)}
.send-btn:not(:disabled):hover{box-shadow:var(--e2),0 0 0 1px color-mix(in srgb,var(--accent) 40%,transparent)}
.input-plus,.input-attach{transition:background var(--t),color var(--t),transform var(--t)}
.input-plus:hover,.input-attach:hover{transform:translateY(-1px)}
.input-hint kbd{box-shadow:var(--hi)}

/* Greeting / empty — considered focal mark + springier suggestion chips */
.empty-state .gem-greet-spark{box-shadow:var(--e2),var(--hi),0 0 0 1px color-mix(in srgb,var(--accent) 35%,transparent)}
.empty-state h2{letter-spacing:-.035em}
.empty-state .suggestion{transition:background var(--t),border-color var(--t),transform var(--t),box-shadow var(--t)}
.empty-state .suggestion:hover{box-shadow:var(--e1),var(--hi)}
.empty-state .suggestion .s-ico{transition:transform var(--t-slow)}
.empty-state .suggestion:hover .s-ico{transform:translateX(2px)}

/* Header action buttons — defined hover, consistent with the sessions list */
.header-btn{transition:background var(--t),color var(--t),border-color var(--t),box-shadow var(--t)}
.header-btn:hover{box-shadow:var(--hi)}
</style>
</head>
<body>
${themeToggle('fixed')}
<!-- gradient sparkle definition (referenced by fill:url) -->
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <linearGradient id="gem-grad" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-2)"/>
  </linearGradient>
</defs></svg>

<!-- Mobile nav backdrop -->
<div id="ca-backdrop" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:41"></div>

<div class="ca-root" id="ca-root">
<div id="ca-rail-backdrop"></div>
<!-- Sessions rail — closed by default; slides over on demand (header menu),
     closeable via X / backdrop. The persistent ops sidebar is primary nav. -->
<nav class="gem-drawer ca-nav" id="drawer">
  <div class="gem-drawer-head">
    <a class="gem-icon-btn" href="/" title="Back to Ops" aria-label="Back to Ops">${icon('arrow-left', { size: 18 })}</a>
    <span class="gem-drawer-title">Code Agent</span>
    <button class="gem-icon-btn" id="btn-drawer-close" title="Close">${icon('x', { size: 18 })}</button>
  </div>
  <button class="gem-drawer-item" id="drawer-new"><span class="gem-di-ico">${icon('plus', { size: 18 })}</span> New chat</button>
  <div class="gem-search"><input id="drawer-search" type="text" placeholder="Search chats" autocomplete="off"></div>
  <div class="gem-drawer-sec">Recents</div>
  <div class="gem-recents" id="drawer-recents"><div class="gem-recents-empty">Loading…</div></div>
  <div class="gem-drawer-foot">
    <div class="gem-user">
      <span class="gem-avatar-sm" id="user-initial">·</span>
      <div style="min-width:0">
        <div class="gem-user-name" id="user-name">…</div>
        <div class="gem-user-sub">Admin</div>
      </div>
    </div>
  </div>
</nav>

<!-- Questions sidebar -->
<div class="qs-sidebar" id="qs-sidebar">
  <div class="qs-sidebar-head">
    <span class="qs-sidebar-title" style="display:flex;align-items:center;gap:.4rem">${icon('message', { size: 18 })} Your Questions</span>
    <button class="gem-icon-btn" id="qs-close" title="Close">${icon('x', { size: 18 })}</button>
  </div>
  <div class="qs-sidebar-search"><input id="qs-search" type="text" placeholder="Search questions…" autocomplete="off"></div>
  <div class="qs-sidebar-body" id="qs-body"><div class="qs-empty">Loading…</div></div>
  <div class="qs-count" id="qs-count"></div>
</div>

<div class="ca-main">
<div class="code-container" id="code-container">
  <div class="gem-top">
    <button class="gem-icon-btn page-nav-toggle" type="button" onclick="document.body.classList.toggle('sb-open')" title="Navigation" aria-label="Toggle navigation">${icon('menu', { size: 20 })}</button>
    <button class="gem-icon-btn" onclick="location.href='/code'" title="Back to sessions">${icon('arrow-left', { size: 20 })}</button>
    <div class="gem-brand">
      <div class="model-picker" id="model-picker">
        <button class="model-picker-btn" id="mp-btn"><span class="gem-brand-name" id="runtime-label">Code Agent</span> <span class="gem-model-tag" id="mp-label">model</span> <span class="arrow">${icon('chevron-down', { size: 14 })}</span></button>
        <div class="model-picker-dd" id="mp-dd"></div>
      </div>
    </div>
    <div class="gem-top-actions">
      <span class="ws-dot connecting" id="ws-dot"></span>
      <div class="top-more">
        <button class="gem-icon-btn top-more-btn" id="btn-more" title="More agent actions" aria-label="More agent actions" aria-expanded="false">⋯</button>
        <div class="top-more-menu" id="top-more-menu" role="menu" aria-label="Agent actions">
          <button class="gem-icon-btn" id="btn-menu" title="Recent chats">${icon('message', { size: 18 })}<span>Recent chats</span></button>
          <button class="gem-icon-btn terminal-btn" id="btn-terminal" title="Live Codex terminal" aria-expanded="false">${icon('terminal', { size: 18 })}<span>Live terminal</span></button>
          <button class="header-btn review-btn" id="btn-review" style="display:none" title="Request AI code review of current changes">${icon('search', { size: 15 })}<span>Review changes</span></button>
          <button class="header-btn ship-btn" id="btn-ship" style="display:none" title="Ship checkpoint — land on development or run full pipeline"><span>Ship checkpoint</span></button>
          <button class="header-btn pr-btn" id="btn-pr" style="display:none" title="Create Pull Request"><span>Create PR</span></button>
          <div class="menu-divider"></div>
          <button class="gem-icon-btn" id="btn-handoff" title="Copy a link and work summary for another operator">${icon('share-2', { size: 18 })}<span>Copy handoff</span></button>
          <button class="gem-icon-btn" id="btn-history" title="View conversation history">${icon('message', { size: 18 })}<span>Conversation history</span></button>
          <button class="gem-icon-btn" id="btn-memory" title="Agent memory — facts preserved across sessions">${icon('pin', { size: 18 })}<span>Agent memory</span></button>
          <button class="gem-icon-btn" id="btn-newchat" title="New chat">${icon('plus', { size: 18 })}<span>New chat</span></button>
        </div>
      </div>
    </div>
  </div>

  <div class="gem-subbar" id="session-bar">
    <span id="session-title">Loading…</span>
    <span class="sep">·</span>
    <div class="perm-toggle" id="perm-toggle">
      <button class="perm-btn active" data-mode="auto" title="Agent executes all tools without asking">Auto</button>
      <button class="perm-btn" data-mode="safe" title="Ask before destructive tools only">Safe</button>
      <button class="perm-btn" data-mode="confirm" title="Ask before every tool">Confirm</button>
    </div>
    <span class="sep">·</span>
    <span class="agent-status" id="agent-status" style="display:none"><span class="status-icon"></span> <span id="agent-status-text">working</span></span>
    <span class="elapsed" id="elapsed" style="display:none">0:00</span>
    <span class="ctx-bar-wrap" id="ctx-bar-wrap" style="display:none">
      <span class="ctx-label" id="ctx-label">0 / 0</span>
      <div class="ctx-bar"><div class="ctx-bar-fill" id="ctx-bar-fill" style="width:0%"></div></div>
      <span class="ctx-label" id="ctx-pct">0%</span>
    </span>
  </div>
  <section class="workspace-banner" id="workspace-banner" aria-label="Git worktree status">
    <div class="workspace-git">
      <span aria-hidden="true">${icon('git-branch', { size: 17 })}</span>
      <div class="workspace-copy">
        <div class="workspace-branch" id="workspace-branch">Pending worktree</div>
        <div class="workspace-path" id="workspace-path" title="Copy worktree path"></div>
      </div>
    </div>
    <div class="workspace-stats" id="workspace-stats"></div>
    <div class="workspace-actions">
      <button class="workspace-btn" id="workspace-commit" type="button">Commit</button>
      <button class="workspace-btn primary" id="workspace-pr" type="button">Create <span class="wide">PR</span></button>
    </div>
  </section>
  <section class="delivery-banner" id="delivery-banner" aria-label="A House Divided delivery pipeline">
    <div class="delivery-copy"><div class="delivery-title" id="delivery-title">Delivery checkpoint</div><div class="delivery-detail" id="delivery-detail"></div></div>
    <div class="delivery-steps" id="delivery-steps"></div>
    <div class="delivery-actions"><button class="delivery-action" id="delivery-checkpoint">Checkpoint <span>→ dev</span></button><button class="delivery-action release" id="delivery-release">Release</button></div>
  </section>

  <div class="code-messages" id="messages">
    <div class="loading" id="loading">
      <div class="spinner siri-loader"></div>
      <span>Loading session…</span>
    </div>
  </div>

  <button class="stop-fab" id="stop-fab" title="Stop agent (Esc)">
    <span class="stop-icon"></span> Stop
  </button>

  <div class="code-input">
    <div id="img-preview-strip" class="img-preview-strip" style="display:none"></div>
    <div class="input-row">
      <button class="input-plus" id="btn-plus" title="Suggestions">${icon('plus', { size: 20 })}</button>
      <button class="input-attach" id="btn-attach" title="Attach image (vision)">${icon('image', { size: 17 })}</button>
      <input type="file" id="img-file-input" accept="image/*" multiple style="display:none">
      <textarea class="input-field" id="input" placeholder="Ask the code agent…" rows="1"></textarea>
      <button class="send-btn" id="send-btn" title="Send (Enter)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>
    </div>
    <div class="input-hint">
      <span class="hint-keys"><kbd>Enter</kbd> send · <kbd>Shift+Enter</kbd> newline</span>
      <span id="status-text">Loading…</span>
    </div>
  </div>
</div>
</div><!-- /ca-main -->
</div><!-- /ca-root -->
<section class="live-terminal" id="live-terminal" aria-label="Live Codex activity" aria-hidden="true">
  <div class="lt-head">
    <span class="lt-lights" aria-hidden="true"><span class="lt-light live" id="lt-live"></span><span class="lt-light"></span><span class="lt-light"></span></span>
    <span class="lt-title">Live activity</span>
    <span class="lt-route">routed through <strong>Codex</strong></span>
    <button class="lt-action" id="lt-copy" type="button">Copy</button>
    <button class="lt-action" id="lt-clear" type="button">Clear</button>
    <button class="lt-action" id="lt-close" type="button" aria-label="Close terminal">Close</button>
  </div>
  <div class="lt-output" id="lt-output" role="log" aria-live="polite">
    <div class="lt-empty" id="lt-empty"><span><strong>Codex activity will appear here</strong>Commands, file edits, checks, and results stream live.<br>This is a structured agent view, not a raw VPS shell.</span></div>
  </div>
</section>
<!-- Ship checkpoint chooser -->
<div class="ship-modal-backdrop" id="ship-modal" role="dialog" aria-modal="true" aria-labelledby="ship-modal-title">
  <div class="ship-modal">
    <h2 id="ship-modal-title">Ship checkpoint</h2>
    <p class="ship-lead">How should this work land? Your choice is injected into the agent as full shipping instructions.</p>
    <button type="button" class="ship-opt dev" id="ship-opt-dev" data-ship="development">
      <span class="ship-opt-title">Land on development</span>
      <span class="ship-opt-desc">Verify, commit, PR/merge into development — stop there. No staging or master.</span>
    </button>
    <button type="button" class="ship-opt pipeline" id="ship-opt-pipeline" data-ship="pipeline">
      <span class="ship-opt-title">Full pipeline</span>
      <span class="ship-opt-desc">Land on development, then promote development → staging → master.</span>
    </button>
    <button type="button" class="ship-modal-cancel" id="ship-modal-cancel">Not now</button>
  </div>
</div>
<!-- Explicit Git commit chooser -->
<div class="ship-modal-backdrop" id="commit-modal" role="dialog" aria-modal="true" aria-labelledby="commit-modal-title">
  <div class="ship-modal commit-modal">
    <h2 id="commit-modal-title">Commit worktree changes</h2>
    <p class="ship-lead" id="commit-modal-lead">Review the changed files and choose the commit message that will appear in Git history.</p>
    <div class="commit-files" id="commit-files"></div>
    <label for="commit-message">Commit message</label>
    <input id="commit-message" maxlength="240" autocomplete="off" placeholder="feat: describe the completed work">
    <div class="commit-error" id="commit-error" role="alert"></div>
    <div class="commit-actions">
      <button type="button" class="workspace-btn" id="commit-cancel">Cancel</button>
      <button type="button" class="workspace-btn primary" id="commit-submit">Commit changes</button>
    </div>
  </div>
</div>
<!-- Memory panel -->
<div id="mem-panel" class="mem-panel" role="dialog" aria-modal="true">
  <div class="mem-head">
    <span class="mem-title" style="display:flex;align-items:center;gap:.4rem">${icon('pin', { size: 18 })} Agent Memory</span>
    <button class="gem-icon-btn" id="mem-close" title="Close">${icon('x', { size: 18 })}</button>
  </div>
  <div class="mem-body" id="mem-body"><div class="mem-empty">Loading…</div></div>
  <div class="mem-footer">
    <textarea id="mem-add-area" class="mem-add-area" placeholder="Add a memory (e.g. 'Always use the existing createStateUpdate helper in src/lib/db/')…" rows="3"></textarea>
    <button class="btn" id="mem-save-btn" style="margin-top:.5rem;width:100%">Save to Memory</button>
  </div>
</div>
<div id="mem-overlay" class="mem-overlay"></div>

  <div class="mem-body" id="hist-body"><div class="mem-empty">Loading…</div></div>
  <div class="mem-footer" style="display:flex;gap:var(--s-2);padding:var(--s-3) var(--s-4);border-top:1px solid var(--g-line);flex-shrink:0">
    <button class="btn" id="hist-refresh" style="flex:1">Refresh</button>
    <button class="btn" id="hist-export" style="flex:1">Export JSON</button>
  </div>
</div>
<div id="hist-overlay" class="mem-overlay"></div>

<script>
(function(){
  // Extract session ID from URL: /code/session/:id
  var pathParts = location.pathname.split('/');
  var sessionId = pathParts[pathParts.length - 1];

  var ws = null;
  var reconnectTimer = null;
  var currentMsg = null;
  var currentActivity = null;
  var currentToolPanels = {};
  var currentToolGroup = null;
  var streamingEl = null;
  var sessionData = null;
  var workspaceData = null;
  var messageCount = 0;
  var currentTurnChanges = new Set();  // files touched during this turn (write_file/patch/git_commit)
  var currentTurnStats = emptyTurnStats();  // tool-call counts for the end-of-turn stats card
  var currentStageLog = null;  // transient "what is happening" ticker (lives at the top of the current AI message)
  var stageLogLines = [];  // recent stage strings (capped) — kept so a stats line can show the longest stage

  function emptyTurnStats() {
    return { read: 0, write: 0, patch: 0, search: 0, find: 0, terminal: 0,
             tsc: 0, git: 0, skill: 0, total: 0, hits: 0, miss: 0, errors: 0 };
  }
  function bumpStat(tool, hit) {
    currentTurnStats.total++;
    if (tool === 'read_file' || tool === 'read_files') currentTurnStats.read++;
    else if (tool === 'write_file') currentTurnStats.write++;
    else if (tool === 'patch') currentTurnStats.patch++;
    else if (tool === 'search_files') currentTurnStats.search++;
    else if (tool === 'find_files') currentTurnStats.find++;
    else if (tool === 'terminal') currentTurnStats.terminal++;
    else if (tool === 'tsc_check') currentTurnStats.tsc++;
    else if (tool === 'git_status' || tool === 'git_diff' || tool === 'git_log' || tool === 'git_commit' || tool === 'git_branch') currentTurnStats.git++;
    else if (tool === 'use_skill') currentTurnStats.skill++;
    if (hit === true) currentTurnStats.hits++;
    else if (hit === false) currentTurnStats.miss++;
  }

  var messagesEl = document.getElementById('messages');
  var loadingEl = document.getElementById('loading');
  var input = document.getElementById('input');
  var sendBtn = document.getElementById('send-btn');
  var wsDot = document.getElementById('ws-dot');
  var statusText = document.getElementById('status-text');
  var sessionTitle = document.getElementById('session-title');
  var sessionBar = document.getElementById('session-bar');
  var btnPR = document.getElementById('btn-pr');
  var btnReview = document.getElementById('btn-review');
  var btnShip = document.getElementById('btn-ship');
  var shipModal = document.getElementById('ship-modal');
  var deliveryBanner = document.getElementById('delivery-banner');
  var workspaceBanner = document.getElementById('workspace-banner');
  var workspaceCommit = document.getElementById('workspace-commit');
  var workspacePR = document.getElementById('workspace-pr');
  var commitModal = document.getElementById('commit-modal');
  var commitMessage = document.getElementById('commit-message');
  var commitSubmit = document.getElementById('commit-submit');
  var commitError = document.getElementById('commit-error');
  var commitThenPR = false;
  var workspaceRefreshTimer = null;
  var btnMemory = document.getElementById('btn-memory');
  var btnHistory = document.getElementById('btn-history');
  var btnHandoff = document.getElementById('btn-handoff');
  var btnTerminal = document.getElementById('btn-terminal');
  var btnMore = document.getElementById('btn-more');
  var moreMenu = document.getElementById('top-more-menu');
  var liveTerminal = document.getElementById('live-terminal');
  var terminalOutput = document.getElementById('lt-output');
  var terminalEmpty = document.getElementById('lt-empty');
  var runtimeLabel = document.getElementById('runtime-label');
  var terminalHasAutoOpened = false;

  function closeMoreMenu() {
    if (moreMenu) moreMenu.classList.remove('open');
    if (btnMore) btnMore.setAttribute('aria-expanded', 'false');
  }
  if (btnMore && moreMenu) btnMore.onclick = function(e) {
    e.stopPropagation();
    var open = moreMenu.classList.toggle('open');
    btnMore.setAttribute('aria-expanded', String(open));
  };
  document.addEventListener('click', function(e) {
    if (moreMenu && !moreMenu.contains(e.target) && e.target !== btnMore) closeMoreMenu();
  });
  [btnTerminal, btnReview, btnShip, btnPR, btnHistory, btnMemory, btnHandoff].forEach(function(btn) {
    if (btn) btn.addEventListener('click', closeMoreMenu);
  });
  btnHandoff.onclick = function() {
    var lines = [
      'Code session: ' + ((sessionData && sessionData.title) || 'Untitled'),
      'Open: ' + window.location.origin + '/code/session/' + encodeURIComponent(sessionId),
      'Branch: ' + ((workspaceData && workspaceData.branch) || (sessionData && sessionData.branchName) || 'Pending'),
      'Worktree: ' + (workspaceData ? (workspaceData.dirty ? 'Uncommitted changes' : 'Clean') : 'No snapshot'),
    ];
    if (sessionData && safePrUrl(sessionData.prUrl)) lines.push('PR: ' + safePrUrl(sessionData.prUrl));
    var summary = lines.join('\\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(summary).then(function() { appendTerminal('info', 'Session handoff copied.'); }).catch(function() { window.prompt('Copy session handoff', summary); });
    } else window.prompt('Copy session handoff', summary);
  };

  // Git worktree — one reusable snapshot powers branch, dirty, commit and PR UI.
  function renderWorkspace(workspace) {
    workspaceData = workspace || null;
    if (!workspaceBanner) return;
    if (!workspace || !workspace.available) {
      workspaceBanner.classList.remove('show');
      return;
    }
    workspaceBanner.classList.add('show');
    document.getElementById('workspace-branch').textContent =
      workspace.branch + ' → ' + workspace.baseBranch;
    var pathEl = document.getElementById('workspace-path');
    pathEl.textContent = workspace.path || '';
    pathEl.title = 'Copy ' + (workspace.path || 'worktree path');
    var stats = document.getElementById('workspace-stats');
    var stateClass = workspace.dirty ? 'dirty' : 'clean';
    var stateText = workspace.dirty
      ? workspace.changedFiles.length + ' changed'
      : 'Clean';
    var commitText = workspace.lastCommit
      ? workspace.lastCommit.shortSha + ' ' + workspace.lastCommit.subject
      : 'No commits';
    stats.innerHTML =
      '<span class="workspace-chip ' + stateClass + '">' + escapeHtml(stateText) + '</span>' +
      '<span class="workspace-chip">↑ ' + Number(workspace.ahead || 0) + ' · ↓ ' + Number(workspace.behind || 0) + '</span>' +
      '<span class="workspace-chip" title="' + escapeHtml(commitText) + '">' + escapeHtml(commitText) + '</span>';
    workspaceCommit.disabled = !workspace.dirty;
    workspaceCommit.textContent = workspace.dirty ? 'Commit ' + workspace.changedFiles.length : 'Committed';
    if (sessionData && sessionData.prUrl) {
      workspacePR.disabled = false;
      workspacePR.innerHTML = 'Open PR #' + escapeHtml(String(sessionData.prNumber || ''));
    } else {
      workspacePR.disabled = workspace.ahead === 0 && !workspace.dirty;
      workspacePR.innerHTML = 'Create <span class="wide">PR</span>';
    }
  }

  function refreshWorkspace(delay, fresh) {
    if (workspaceRefreshTimer) clearTimeout(workspaceRefreshTimer);
    workspaceRefreshTimer = setTimeout(function() {
      fetch('/api/code/sessions/' + sessionId + (fresh ? '?workspace=fresh' : ''), { cache: 'no-store' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          if (!data) return;
          if (data.session) sessionData = data.session;
          renderWorkspace(data.workspace);
          renderDelivery(data.delivery);
        })
        .catch(function() {});
    }, delay || 0);
  }

  function defaultCommitMessage() {
    var title = String((sessionData && sessionData.title) || 'save code agent work')
      .trim().replace(/[.]+$/, '');
    return 'feat: ' + title.charAt(0).toLowerCase() + title.slice(1);
  }

  function closeCommitModal() {
    commitModal.classList.remove('open');
    commitThenPR = false;
    commitError.textContent = '';
  }

  function openCommitModal(thenPR) {
    if (!workspaceData || !workspaceData.dirty) {
      if (thenPR) createPR();
      return;
    }
    commitThenPR = Boolean(thenPR);
    document.getElementById('commit-modal-title').textContent =
      commitThenPR ? 'Commit before creating PR' : 'Commit worktree changes';
    document.getElementById('commit-modal-lead').textContent = commitThenPR
      ? 'The PR will be created only after this commit succeeds.'
      : 'Review the changed files and choose the message that will appear in Git history.';
    document.getElementById('commit-files').innerHTML = workspaceData.changedFiles
      .map(function(file) {
        return '<div><strong>' + escapeHtml(file.status) + '</strong> ' + escapeHtml(file.path) + '</div>';
      }).join('');
    commitMessage.value = defaultCommitMessage();
    commitError.textContent = '';
    commitSubmit.textContent = commitThenPR ? 'Commit & create PR' : 'Commit changes';
    commitSubmit.disabled = false;
    commitModal.classList.add('open');
    setTimeout(function() { commitMessage.focus(); commitMessage.select(); }, 20);
  }

  function submitCommit() {
    var message = commitMessage.value.trim();
    if (!message) { commitError.textContent = 'Enter a commit message.'; return; }
    var shouldCreatePR = commitThenPR;
    commitSubmit.disabled = true;
    commitSubmit.textContent = 'Committing…';
    fetch('/api/code/sessions/' + sessionId + '/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message })
    }).then(function(r) {
      return r.json().then(function(data) {
        if (!r.ok) throw new Error(data.error || 'Commit failed');
        return data;
      });
    }).then(function(data) {
      renderWorkspace(data.workspace);
      closeCommitModal();
      appendSystem('Committed ' + data.commit.shortSha + ': ' + data.commit.subject);
      if (shouldCreatePR) createPR(true);
    }).catch(function(error) {
      commitSubmit.disabled = false;
      commitSubmit.textContent = shouldCreatePR ? 'Commit & create PR' : 'Commit changes';
      commitError.textContent = error.message;
    });
  }

  workspaceCommit.onclick = function() { openCommitModal(false); };
  workspacePR.onclick = function() {
    if (sessionData && sessionData.prUrl && safePrUrl(sessionData.prUrl)) window.open(safePrUrl(sessionData.prUrl), '_blank', 'noopener');
    else if (workspaceData && workspaceData.dirty) openCommitModal(true);
    else createPR();
  };
  document.getElementById('workspace-path').onclick = function() {
    if (workspaceData && workspaceData.path && navigator.clipboard) {
      navigator.clipboard.writeText(workspaceData.path);
      this.textContent = 'Copied worktree path';
      setTimeout(function() { renderWorkspace(workspaceData); }, 900);
    }
  };
  document.getElementById('commit-cancel').onclick = closeCommitModal;
  commitSubmit.onclick = submitCommit;
  commitMessage.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); submitCommit(); }
  });
  commitModal.addEventListener('click', function(e) {
    if (e.target === commitModal) closeCommitModal();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && commitModal.classList.contains('open')) closeCommitModal();
  });

  // Ship checkpoint — prompts injected from code-ship.js
  var SHIP_MARKER = ${JSON.stringify(SHIP_MARKER)};
  var LAND_ON_DEVELOPMENT_LABEL = ${JSON.stringify(LAND_ON_DEVELOPMENT_LABEL)};
  var FULL_PIPELINE_LABEL = ${JSON.stringify(FULL_PIPELINE_LABEL)};
  var LAND_ON_DEVELOPMENT_PROMPT = ${JSON.stringify(LAND_ON_DEVELOPMENT_PROMPT)};
  var FULL_PIPELINE_PROMPT = ${JSON.stringify(FULL_PIPELINE_PROMPT)};
  var shipModalOpen = false;

  function openShipModal() {
    if (!shipModal) return;
    shipModal.classList.add('open');
    shipModalOpen = true;
  }
  function closeShipModal() {
    if (!shipModal) return;
    shipModal.classList.remove('open');
    shipModalOpen = false;
  }
  function injectShipChoice(kind) {
    closeShipModal();
    fetch('/api/code/sessions/' + sessionId + '/ship', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: kind === 'pipeline' ? 'pipeline' : 'development' }),
      cache: 'no-store',
    }).then(function(r) { return r.json().then(function(data) { return { ok: r.ok, data: data }; }); })
      .then(function(res) {
        if (!res.ok) throw new Error((res.data && res.data.error) || 'Ship prepare failed');
        var label = res.data.label || (kind === 'pipeline' ? FULL_PIPELINE_LABEL : LAND_ON_DEVELOPMENT_LABEL);
        var prompt = res.data.prompt || (kind === 'pipeline' ? FULL_PIPELINE_PROMPT : LAND_ON_DEVELOPMENT_PROMPT);
        addUserMessage(label);
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'message', content: prompt }));
          setRunning(true);
        } else {
          appendSystem('Not connected — reconnect and try Ship again.');
        }
      })
      .catch(function(err) {
        appendSystem('Ship failed: ' + (err && err.message ? err.message : String(err)));
      });
  }
  function renderDelivery(data) {
    if (!deliveryBanner) return;
    if (!data || !data.eligible) { deliveryBanner.classList.remove('show'); return; }
    deliveryBanner.className = 'delivery-banner show ' + (data.phase || '');
    document.getElementById('delivery-title').textContent = data.headline || 'AHD delivery checkpoint';
    document.getElementById('delivery-detail').textContent = (data.branch ? data.branch + ' · ' : '') + (data.detail || '');
    var steps = document.getElementById('delivery-steps');
    steps.innerHTML = '';
    (data.steps || []).forEach(function(step) {
      var item = document.createElement('span');
      item.className = 'delivery-step ' + (step.state || 'idle');
      var dot = document.createElement('i');
      dot.className = 'delivery-dot';
      item.appendChild(dot);
      var label = step.url ? document.createElement('a') : document.createElement('span');
      label.textContent = step.label;
      if (step.url) { label.href = step.url; label.target = '_blank'; label.rel = 'noopener'; }
      item.appendChild(label);
      steps.appendChild(item);
    });
    document.getElementById('delivery-release').style.display = data.phase === 'complete' ? 'none' : '';
  }
  function refreshDelivery() {
    // The delivery banner only changes between turns, not during one — skip
    // the poll while the agent is running to avoid pointless fetches. Uses the
    // lightweight /workspace endpoint (git/delivery state only, no message
    // history) instead of the full-session fetch that refreshWorkspace does.
    if (isRunning) return;
    fetch('/api/code/sessions/' + sessionId + '/workspace', { cache: 'no-store' })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) { if (data) renderDelivery(data.delivery); })
      .catch(function() {});
  }
  document.getElementById('delivery-checkpoint').onclick = function() { injectShipChoice('development'); };
  document.getElementById('delivery-release').onclick = function() {
    if (confirm('Run the full AHD release pipeline through production?')) injectShipChoice('pipeline');
  };
  function stripShipMarkerFrom(containerEl) {
    if (!containerEl) return false;
    var html = containerEl.innerHTML;
    // Match raw <!--SHIP--> or HTML-escaped form after markdown render
    var re = /&lt;!--SHIP--&gt;|<!--SHIP-->/g;
    if (!re.test(html)) return false;
    re.lastIndex = 0;
    containerEl.innerHTML = html.replace(re, '');
    return true;
  }
  function detectAndOpenShip(containerEl) {
    if (stripShipMarkerFrom(containerEl)) openShipModal();
  }

  if (shipModal) {
    var shipOptDev = document.getElementById('ship-opt-dev');
    var shipOptPipeline = document.getElementById('ship-opt-pipeline');
    var shipCancel = document.getElementById('ship-modal-cancel');
    if (shipOptDev) shipOptDev.addEventListener('click', function() { injectShipChoice('development'); });
    if (shipOptPipeline) shipOptPipeline.addEventListener('click', function() { injectShipChoice('pipeline'); });
    if (shipCancel) shipCancel.addEventListener('click', closeShipModal);
    shipModal.addEventListener('click', function(e) {
      if (e.target === shipModal) closeShipModal();
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && shipModalOpen) closeShipModal();
    });
  }

  function toggleTerminal(force) {
    var open = typeof force === 'boolean' ? force : !liveTerminal.classList.contains('open');
    liveTerminal.classList.toggle('open', open);
    liveTerminal.setAttribute('aria-hidden', open ? 'false' : 'true');
    btnTerminal.classList.toggle('active', open);
    btnTerminal.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function terminalText(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value, null, 2); } catch (e) { return String(value); }
  }
  function appendTerminal(kind, text) {
    if (!text) return;
    if (terminalEmpty) { terminalEmpty.remove(); terminalEmpty = null; }
    var line = document.createElement('div');
    line.className = 'lt-line';
    var time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    line.innerHTML = '<span class="lt-time">' + escapeHtml(time) + '</span><span class="lt-' + escapeHtml(kind) + '"></span>';
    line.lastChild.textContent = text;
    terminalOutput.appendChild(line);
    // Cap retained terminal lines so a long Codex session can't grow the
    // DOM unbounded — drop the oldest beyond the cap.
    while (terminalOutput.childElementCount > 500) {
      terminalOutput.removeChild(terminalOutput.firstChild);
    }
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
  }
  btnTerminal.onclick = function() { toggleTerminal(); };
  document.getElementById('lt-close').onclick = function() { toggleTerminal(false); };
  document.getElementById('lt-clear').onclick = function() { terminalOutput.innerHTML = ''; terminalEmpty = null; appendTerminal('info', 'Activity cleared.'); };
  document.getElementById('lt-copy').onclick = function() {
    navigator.clipboard.writeText(terminalOutput.innerText || '').then(function() {
      appendTerminal('info', 'Copied terminal activity to clipboard.');
    }).catch(function() {});
  };

  var SEND_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  var STOP_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>';

  function sparkSVG(size, useGrad) {
    var fill = useGrad ? 'url(#gem-grad)' : 'currentColor';
    return '<span class="gem-spark"><svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="' + fill + '">' +
      '<path d="M12 1.5c.3 4.7 4.3 8.7 9 9c-4.7.3-8.7 4.3-9 9c-.3-4.7-4.3-8.7-9-9c4.7-.3 8.7-4.3 9-9z"/></svg></span>';
  }

  // ── Theme ───────────────────────────────────────────────
  // Theme toggling is handled by the shared ui-kit toggle (#themeToggle,
  // localStorage key 'ahd-theme'). Here we only observe data-theme changes so
  // mermaid diagrams can be re-rendered with matching colors.
  function currentTheme() { return document.documentElement.getAttribute('data-theme') || 'dark'; }
  (function watchTheme() {
    var last = currentTheme();
    new MutationObserver(function() {
      var now = currentTheme();
      if (now !== last) { last = now; applyMermaidTheme(); }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  })();

  // ── Mermaid (theme-aware) ───────────────────────────────
  function mermaidConfig() {
    var light = currentTheme() === 'light';
    return {
      startOnLoad: false, securityLevel: 'loose',
      theme: light ? 'default' : 'dark',
      themeVariables: {
        fontFamily: "'Inter',system-ui,sans-serif", fontSize: '14px',
        primaryColor: light ? 'rgba(2,132,199,.10)' : 'rgba(56,189,248,.16)',
        primaryBorderColor: light ? '#0284c7' : '#38bdf8',
        primaryTextColor: light ? '#1a1d24' : '#eaf0f6',
        lineColor: light ? 'rgba(26,29,36,.42)' : 'rgba(234,240,246,.38)',
        textColor: light ? '#1a1d24' : '#eaf0f6',
        mainBkg: light ? 'rgba(2,132,199,.08)' : 'rgba(56,189,248,.14)',
        nodeBorder: light ? '#0284c7' : '#38bdf8',
        clusterBkg: light ? 'rgba(2,132,199,.04)' : 'rgba(56,189,248,.05)',
        clusterBorder: light ? 'rgba(2,132,199,.2)' : 'rgba(56,189,248,.2)',
        edgeLabelBackground: light ? '#f7f8fa' : '#111b26',
      }
    };
  }
  function initMermaid() { if (typeof mermaid !== 'undefined') mermaid.initialize(mermaidConfig()); }

  // Lazy-load the (multi-MB) mermaid CDN bundle only the first time a message
  // actually contains a diagram — keeps initial page load snappy on mobile.
  var _mermaidLoading = false, _mermaidCbs = [];
  function ensureMermaid(cb) {
    if (typeof mermaid !== 'undefined') { if (cb) cb(); return; }
    if (cb) _mermaidCbs.push(cb);
    if (_mermaidLoading) return;
    _mermaidLoading = true;
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
    s.crossOrigin = 'anonymous';
    s.onload = function() {
      initMermaid();
      var cbs = _mermaidCbs; _mermaidCbs = [];
      cbs.forEach(function(f) { try { f(); } catch (e) {} });
    };
    s.onerror = function() { _mermaidLoading = false; };
    document.head.appendChild(s);
  }

  function applyMermaidTheme() {
    if (typeof mermaid === 'undefined') return;
    initMermaid();
    var wraps = document.querySelectorAll('.mermaid-wrap[data-src]');
    wraps.forEach(function(wrap, i) {
      var code = wrap.getAttribute('data-src');
      if (!code) return;
      var mid = 'mmd-re-' + Date.now() + '-' + i;
      try {
        mermaid.render(mid, code).then(function(res) { wrap.innerHTML = res.svg; }).catch(function() {});
      } catch(e) {}
    });
  }

  // ── Drawer ──────────────────────────────────────────────
  var drawer = document.getElementById('drawer');
  var scrim = document.getElementById('scrim') || document.getElementById('ca-backdrop');
  var recentsEl = document.getElementById('drawer-recents');
  var drawerSearch = document.getElementById('drawer-search');
  var allSessions = [];

  // Session rail = slide-over. Closed by default; toggled by the header menu,
  // closed by the X, the backdrop, or picking a session. Same on every width.
  var caRoot = document.getElementById('ca-root');
  function openDrawer() { if(caRoot)caRoot.classList.add('rail-open'); loadRecents(); }
  function closeDrawer() { if(caRoot)caRoot.classList.remove('rail-open'); }
  document.getElementById('btn-menu').onclick = function(){
    if(caRoot && caRoot.classList.contains('rail-open')) closeDrawer(); else openDrawer();
  };
  document.getElementById('btn-drawer-close').onclick = closeDrawer;
  if(scrim)scrim.onclick = closeDrawer;
  var railBd=document.getElementById('ca-rail-backdrop');
  if(railBd)railBd.onclick=closeDrawer;

  // Swipe: edge→open recents rail; left-swipe on open rail→close (≤860px).
  (function bindRailGestures(){
    var mq = window.matchMedia('(max-width:860px)');
    var sx=0, sy=0, tracking=false, fromEdge=false, onRail=false;
    function railOpen(){ return !!(caRoot && caRoot.classList.contains('rail-open')); }
    document.addEventListener('touchstart', function(e){
      if(!mq.matches || e.touches.length!==1) return;
      var t=e.touches[0];
      sx=t.clientX; sy=t.clientY;
      // Prefer ops sidebar gesture when starting at the very edge and ops is closed.
      if(!document.body.classList.contains('sb-open') && sx<=28){
        tracking=false; return;
      }
      fromEdge=!railOpen() && sx<=56;
      onRail=railOpen() && !!(e.target.closest && (e.target.closest('.gem-drawer') || e.target.closest('#ca-rail-backdrop') || e.target.closest('#scrim') || e.target.closest('#ca-backdrop')));
      tracking=fromEdge || onRail;
    }, {passive:true});
    document.addEventListener('touchmove', function(e){
      if(!tracking || !e.touches.length) return;
      var t=e.touches[0], dx=t.clientX-sx, dy=t.clientY-sy;
      if(Math.abs(dx)<Math.abs(dy)*1.15) return;
      if(fromEdge && dx>56){ openDrawer(); tracking=false; e.preventDefault(); }
      else if((onRail||railOpen()) && dx<-56){ closeDrawer(); tracking=false; e.preventDefault(); }
    }, {passive:false});
    document.addEventListener('touchend', function(){ tracking=false; }, {passive:true});
    document.addEventListener('touchcancel', function(){ tracking=false; }, {passive:true});
  })();

  function loadRecents() {
    fetch('/api/code/sessions').then(function(r) { return r.json(); }).then(function(data) {
      allSessions = data.sessions || [];
      renderRecents();
    }).catch(function() {});
  }

  function renderRecents() {
    var q = (drawerSearch.value || '').toLowerCase();
    var list = allSessions.filter(function(s) {
      return !q || (s.title || '').toLowerCase().indexOf(q) !== -1 || (s.branchName || '').toLowerCase().indexOf(q) !== -1;
    });
    if (!list.length) {
      recentsEl.innerHTML = '<div class="gem-recents-empty">' + (q ? 'No matching chats.' : 'No sessions yet.') + '</div>';
      return;
    }
    recentsEl.innerHTML = list.map(function(s) {
      var active = s.sessionId === sessionId ? ' active' : '';
      var st = s.status || 'idle';
      return '<button class="gem-recent' + active + '" data-id="' + escapeHtml(s.sessionId) + '">' +
        '<span class="gem-recent-dot ' + escapeHtml(st) + '"></span>' +
        escapeHtml(s.title || 'Untitled') + '</button>';
    }).join('');
    recentsEl.querySelectorAll('.gem-recent').forEach(function(el) {
      el.onclick = function() {
        var id = el.getAttribute('data-id');
        if (id === sessionId) { closeDrawer(); return; }
        location.href = '/code/session/' + id;
      };
    });
  }
  drawerSearch.addEventListener('input', renderRecents);
  // The nav is a persistent grid column on desktop, so it's never "opened" —
  // load recents once on init rather than only from openDrawer() (mobile-only).
  loadRecents();

  function newChat() {
    // Ask the server for the configured Codex default instead of duplicating
    // a model ID here. This keeps new sessions aligned with the picker and
    // CODEX_MODEL/CODEX_MODELS environment overrides.
    fetch('/api/code/providers').then(function(r) { return r.json(); }).then(function(providersData) {
      var model = providersData.codexDefaultModel || 'gpt-5.6-luna';
      return fetch('/api/code/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // Default to the development branch so new sessions start from the
        // team's main integration line; users can override from the branch
        // picker in the session detail view.
        body: JSON.stringify({
          baseBranch: 'development',
          provider: 'codex',
          model: model
        })
      });
    }).then(function(r) { return r.json(); }).then(function(data) {
      if (data.session) location.href = '/code/session/' + data.session.sessionId;
      else location.href = '/code';
    }).catch(function() { location.href = '/code'; });
  }
  document.getElementById('drawer-new').onclick = newChat;
  document.getElementById('btn-newchat').onclick = newChat;

  // ── User info ───────────────────────────────────────────
  fetch('/api/me').then(function(r) {
    if (!r.ok) { location.href = '/'; return null; }
    return r.json();
  }).then(function(d) {
    if (!d || d.role !== 'admin') { location.href = '/'; return; }
    var email = d.email || '';
    var name = deriveName(email);
    document.getElementById('user-name').textContent = name || email || 'Signed in';
    document.getElementById('user-initial').textContent = (name || email || '·').charAt(0).toUpperCase();
    window.__userName = name;
  });

  function deriveName(email) {
    if (!email) return '';
    var local = email.split('@')[0].replace(/[0-9]+/g, '');
    var parts = local.split(/[._-]+/).filter(Boolean);
    var token = parts.length ? parts[parts.length - 1] : local;
    if (!token || token.length > 14) return '';
    return token.charAt(0).toUpperCase() + token.slice(1);
  }

  // ── Load session ────────────────────────────────────────
  fetch('/api/code/sessions/' + sessionId).then(function(r) {
    if (!r.ok) { location.href = '/code'; return null; }
    return r.json();
  }).then(function(data) {
    if (!data || !data.session) { location.href = '/code'; return; }
    sessionData = data.session;
    renderWorkspace(data.workspace);
    renderDelivery(data.delivery);
    sessionTitle.textContent = sessionData.title || 'New chat';
    document.title = (sessionData.title || 'Session') + ' — Code Agent';
    mpLabel.textContent = sessionData.model || 'model';
    if (providersData.length) renderPicker(providersData, sessionData.provider, sessionData.model);
    if ((sessionData.provider || '').toLowerCase() === 'codex') {
      runtimeLabel.textContent = 'Codex';
      btnTerminal.style.display = '';
      appendTerminal('info', 'Codex session attached to ' + (sessionData.branchName || 'a pending worktree') + '.');
      var codexPermBtns = document.querySelectorAll('#perm-toggle .perm-btn');
      if (codexPermBtns[0]) {
        codexPermBtns[0].textContent = 'Worktree';
        codexPermBtns[0].title = 'Codex can read and write inside this isolated worktree';
      }
      if (codexPermBtns[1]) {
        codexPermBtns[1].textContent = 'Read only';
        codexPermBtns[1].title = 'Codex can inspect the worktree but cannot modify it';
      }
      if (codexPermBtns[2]) codexPermBtns[2].style.display = 'none';
    } else {
      runtimeLabel.textContent = 'Code Agent';
      btnTerminal.title = 'Live agent terminal';
    }

    if (sessionData.prUrl) {
      var state = (sessionData.prState || 'OPEN').toLowerCase().replace(/[^a-z-]/g, '');
      btnPR.textContent = 'PR #' + String(sessionData.prNumber || '') + ' ';
      var stateLabel = document.createElement('span');
      stateLabel.className = 'pr-state ' + state;
      stateLabel.textContent = sessionData.prState || 'OPEN';
      btnPR.appendChild(stateLabel);
      btnPR.classList.add('done');
      btnPR.style.display = '';
      btnPR.onclick = function() { if (safePrUrl(sessionData.prUrl)) window.open(safePrUrl(sessionData.prUrl), '_blank', 'noopener'); };
    } else {
      btnPR.style.display = '';
      btnPR.onclick = createPR;
    }
    if (btnShip) {
      btnShip.style.display = '';
      btnShip.onclick = openShipModal;
    }
    if (btnReview) btnReview.style.display = '';

    updateSessionBar();
    // Prefer the durable event log (full work survives reload); fall back to the
    // message transcript for sessions created before the event log existed.
    if (sessionData.events && sessionData.events.length) replayEvents(sessionData.events);
    else renderHistory(sessionData.messages || []);
    restorePermMode(sessionData.permissionMode);
    connect();
    // Seeded sessions (e.g. launched from a ticket/suggestion "Launch fix")
    // arrive with a prepared prompt and no history — pre-fill the composer so
    // the admin can review it and hit send to kick off the agent.
    if (sessionData.seedPrompt && !(sessionData.messages && sessionData.messages.length)) {
      input.value = sessionData.seedPrompt;
      try { autoResize(); } catch (e) {}
      setTimeout(function() { try { input.focus(); } catch (e) {} }, 50);
    }
  }).catch(function(err) {
    // Never leave the user on an endless spinner — show an inline retry.
    try {
      loadingEl.style.display = '';
      loadingEl.innerHTML = '<div style="padding:28px 18px;text-align:center;color:var(--g-text-3);font-size:.9rem">Couldn\\'t load this session.<br><span style="opacity:.7">' + escapeHtml(String(err && err.message || err || '')) + '</span><br><br><button onclick="location.reload()" style="padding:8px 16px;border-radius:8px;border:1px solid var(--g-line);background:var(--g-surface-2);color:var(--g-text-1);cursor:pointer">Retry</button></div>';
    } catch (e) {}
  });

  // ── Session bar ─────────────────────────────────────────
  function updateSessionBar() {
    sessionTitle.textContent = (sessionData && sessionData.title) || 'New chat';
  }

  // ── Replay the durable event log (cloud-style: full work survives reload) ──
  function replayEvents(events) {
    loadingEl.style.display = 'none';
    if (!events || !events.length) { showEmpty(); return; }
    // Suppress per-event scroll during replay to avoid up to 1000 forced
    // reflows; settle once at the end.
    _suppressScroll = true;
    for (var i = 0; i < events.length; i++) { try { handleMessage(events[i]); } catch (e) {} }
    _suppressScroll = false;
    // Settle any transient "running" state left by an interrupted last turn.
    try { hideThinking(); removeStreamingCursor(); setRunning(false); } catch (e) {}
    try {
      var running = document.querySelectorAll('.tool-status.running');
      for (var j = 0; j < running.length; j++) { running[j].classList.remove('running'); running[j].textContent = 'interrupted'; }
    } catch (e) {}
    try { messagesEl.scrollTop = messagesEl.scrollHeight; } catch (e) {}
  }

  // ── Render history ──────────────────────────────────────
  function parseMaybeJson(v) { if (v == null || typeof v !== 'string') return v; try { return JSON.parse(v); } catch (e) { return v; } }

  function renderHistory(messages) {
    loadingEl.style.display = 'none';
    if (!messages.length) { showEmpty(); return; }
    // Replay the FULL turn, including tool activity — persisted history carries
    // assistant tool_calls + role:"tool" results, so the agent's work is shown
    // on reload (not just the prompt + final text). Reuses the live renderers.
    var toolNames = {}, toolArgs = {};
    _suppressScroll = true;
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (m.role === 'user') {
        addUserMessage(m.content, false);
      } else if (m.role === 'assistant') {
        if (m.content) {
          var el = startAiMessage(false);
          el.innerHTML += renderMarkdown(m.content);
          renderMermaidIn(el);
          currentMsg = null;
        }
        if (Array.isArray(m.tool_calls)) {
          for (var t = 0; t < m.tool_calls.length; t++) {
            var tc = m.tool_calls[t], fn = tc.function || tc;
            var name = fn.name || tc.name || 'tool';
            var args = parseMaybeJson(fn.arguments != null ? fn.arguments : tc.args) || {};
            var tid = tc.id || ('hist_' + i + '_' + t);
            toolNames[tid] = name; toolArgs[tid] = args;
            if (tc.id) { toolNames[tc.id] = name; toolArgs[tc.id] = args; }
            try { showToolPanel(tid, name, args); } catch (e) {}
          }
        }
      } else if (m.role === 'tool') {
        var rid = m.tool_call_id || '', rname = toolNames[rid] || 'tool';
        var result = parseMaybeJson(m.content);
        try {
          updateToolResult(rid, rname, result);
          if (rname === 'write_file' || rname === 'patch') showDiffCard(rname, toolArgs[rid] || {}, result);
        } catch (e) {}
      }
    }
    endToolGroup();
    messageCount = messages.length;
    updateSessionBar();
    _suppressScroll = false;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Render a single message (used for incremental updates on reconnect)
  function renderSingleMessage(m, mid) {
    if (m.role === 'user') {
      hideEmpty();
      endToolGroup();
      var wrap = document.createElement('div');
      wrap.className = 'msg user';
      wrap.style.animation = 'none';
      wrap.setAttribute('data-msg-id', mid || ('user_' + Date.now()));
      var initial = (window.__userName || 'U').charAt(0).toUpperCase();
      wrap.innerHTML = '<div class="msg-avatar person">' + escapeHtml(initial) + '</div><div class="msg-body"><div class="msg-content">' + (m.content ? escapeHtml(m.content) : '') + '</div></div>';
      messagesEl.appendChild(wrap);
    } else if (m.role === 'assistant' && m.content) {
      hideEmpty();
      endToolGroup();
      var wrap = document.createElement('div');
      wrap.className = 'msg ai';
      wrap.style.animation = 'none';
      wrap.setAttribute('data-msg-id', mid || ('ai_' + Date.now()));
      wrap.innerHTML = '<div class="msg-avatar ai">' + sparkSVG(26, true) + '</div><div class="msg-body"><div class="msg-name">Code Agent</div><div class="msg-content">' + renderMarkdown(m.content) + '</div></div>';
      messagesEl.appendChild(wrap);
      var restoredContent = wrap.querySelector('.msg-content');
      renderMermaidIn(restoredContent);
      injectMCButtons(restoredContent);
    }
    messageCount++;
    updateSessionBar();
    scrollToBottom();
  }

  // ── Elapsed timer + agent status ────────────────────────
  var elapsedEl = document.getElementById('elapsed');
  var agentStatusEl = document.getElementById('agent-status');
  var agentStatusText = document.getElementById('agent-status-text');
  var stopFab = document.getElementById('stop-fab');
  var timerStart = null;
  var timerInterval = null;

  function startTimer() {
    timerStart = Date.now();
    elapsedEl.style.display = '';
    agentStatusEl.style.display = '';
    stopFab.classList.add('visible');
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateElapsed, 1000);
    updateElapsed();
  }
  function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    stopFab.classList.remove('visible');
    setTimeout(function() {
      elapsedEl.style.display = 'none';
      agentStatusEl.style.display = 'none';
    }, 5000);
  }
  function updateElapsed() {
    if (!timerStart) return;
    var s = Math.floor((Date.now() - timerStart) / 1000);
    var m = Math.floor(s / 60);
    var sec = s % 60;
    elapsedEl.textContent = m + ':' + (sec < 10 ? '0' : '') + sec;
  }
  function setAgentStatus(text) { agentStatusText.textContent = text; }

  function toolFriendlyName(tool) {
    var names = {
      read_file: 'reading file', read_files: 'reading files', write_file: 'writing file',
      patch: 'patching file', search_files: 'searching', find_files: 'finding files',
      terminal: 'running command', git_status: 'checking git status', git_diff: 'viewing diff',
      git_log: 'reading git log', git_commit: 'committing', list_directory: 'listing directory',
      tsc_check: 'type checking', git_branch: 'switching branch', web_fetch: 'fetching URL',
      vision_analyze: 'analyzing image', use_skill: 'loading skill',
    };
    return names[tool] || tool.replace(/_/g, ' ');
  }

  stopFab.onclick = function() {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'cancel' }));
  };
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      if (caRoot && caRoot.classList.contains('rail-open')) { closeDrawer(); return; }
      if (stopFab.classList.contains('visible')) stopFab.click();
    }
  });

  // ── Context bar ────────────────────────────────────────
  var ctxWrap = document.getElementById('ctx-bar-wrap');
  var ctxFill = document.getElementById('ctx-bar-fill');
  var ctxLabel = document.getElementById('ctx-label');
  var ctxPct = document.getElementById('ctx-pct');

  function updateContextBar(u) {
    var inputTokens = Number(u.inputTokens || u.input || 0);
    var outputTokens = Number(u.outputTokens || u.output || 0);
    var totalTokens = Number(u.totalTokens || 0) || inputTokens + outputTokens;
    if (!u.contextLength || u.contextLength <= 0 || !totalTokens) return;
    ctxWrap.style.display = 'flex';
    var pct = Math.min(100, Math.round((totalTokens / u.contextLength) * 100));
    ctxFill.style.width = pct + '%';
    ctxFill.className = 'ctx-bar-fill' + (pct > 85 ? ' crit' : pct > 60 ? ' warn' : '');
    ctxLabel.textContent = fmtTok(totalTokens) + ' / ' + fmtTok(u.contextLength);
    ctxPct.textContent = pct + '%';
    ctxWrap.title = 'Input ' + fmtTok(inputTokens) + ' · output ' + fmtTok(outputTokens) + ' · context ' + fmtTok(totalTokens) + ' / ' + fmtTok(u.contextLength);
  }
  function fmtTok(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return n;
  }

  // ── Model picker ──────────────────────────────────────
  var mpBtn = document.getElementById('mp-btn');
  var mpLabel = document.getElementById('mp-label');
  var mpDD = document.getElementById('mp-dd');
  var providersData = [];

  fetch('/api/code/providers').then(function(r) { return r.json(); }).then(function(data) {
    providersData = data.providers || [];
    mpLabel.textContent = data.currentModel || 'model';
    renderPicker(providersData, data.currentProvider, data.currentModel);
  }).catch(function() {});

  var PROVIDER_ICONS = { kimi: '${icon('comet', { size: 14 })}', anthropic: '${icon('bot', { size: 14 })}', openai: '${icon('cpu', { size: 14 })}', ollama: '${icon('cpu', { size: 14 })}', gemini: '${icon('cpu', { size: 14 })}', groq: '${icon('zap', { size: 14 })}', together: '${icon('cpu', { size: 14 })}', mistral: '${icon('cpu', { size: 14 })}', deepseek: '${icon('cpu', { size: 14 })}', local: '${icon('terminal', { size: 14 })}' };
  function providerIcon(name) { var n = (name||'').toLowerCase(); for (var k in PROVIDER_ICONS) { if (n.indexOf(k) >= 0) return PROVIDER_ICONS[k]; } return '${icon('cpu', { size: 14 })}'; }

  function renderPicker(providers, curProv, curModel) {
    var html = '';
    var hasProviders = providers && providers.length > 0;
    if (!hasProviders) { mpDD.innerHTML = '<div class="mp-item" style="color:var(--g-text-3)">No providers configured</div>'; return; }
    providers.forEach(function(p) {
      var icon = providerIcon(p.name);
      var defaultBadge = p.isDefault ? '<span style="font-size:.6rem;background:var(--accent-soft);color:var(--accent);padding:.1em .45em;border-radius:var(--r-full);margin-left:.35rem;font-weight:600;vertical-align:middle">active</span>' : '';
      html += '<div class="mp-section" style="display:flex;align-items:center;gap:.4rem"><span>' + icon + '</span><span>' + escapeHtml(p.name) + '</span>' + defaultBadge + '</div>';
      if (p.models && p.models.length) {
        p.models.forEach(function(m) {
          var modelId = typeof m === 'object' ? m.id : m;
          var supportsVision = typeof m === 'object' ? m.supportsVision : false;
          var active = (p.name === curProv && modelId === curModel) ? ' active' : '';
          var visionBadge = supportsVision ? '<span title="Vision: can analyze images" style="opacity:.7;margin-left:auto;flex-shrink:0;display:inline-flex">${icon('search', { size: 13 })}</span>' : '';
          html += '<div class="mp-item' + active + '" data-provider="' + escapeHtml(p.name) + '" data-model="' + escapeHtml(modelId) + '" data-base-url="' + escapeHtml(p.baseUrl || '') + '" data-api-key="' + escapeHtml(p.apiKey || '') + '" style="display:flex;align-items:center">' +
            '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(modelId) + '</span>' + visionBadge + '</div>';
        });
      } else {
        html += '<div class="mp-item" style="color:var(--g-text-3);cursor:default;font-size:.78rem">No models discovered</div>';
      }
    });
    mpDD.innerHTML = html;
    mpDD.querySelectorAll('.mp-item[data-model]').forEach(function(el) {
      el.onclick = function() {
        switchModel(el.getAttribute('data-provider'), el.getAttribute('data-model'), el.getAttribute('data-base-url'), el.getAttribute('data-api-key'));
        mpDD.classList.remove('open');
      };
    });
  }

  mpBtn.onclick = function(e) { e.stopPropagation(); mpDD.classList.toggle('open'); };
  document.addEventListener('click', function() { mpDD.classList.remove('open'); });

  function switchModel(provider, model, baseUrl, apiKey) {
    if (!ws || ws.readyState !== 1) return;
    var currentIsCodex = ((sessionData && sessionData.provider) || '').toLowerCase() === 'codex';
    var targetIsCodex = (provider || '').toLowerCase() === 'codex';
    if (currentIsCodex !== targetIsCodex) {
      if (!window.confirm('Changing agent runtimes starts a new isolated session. Continue?')) return;
      fetch('/api/code/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseBranch: (sessionData && sessionData.baseBranch) || 'development',
          provider: provider,
          model: model
        })
      }).then(function(r) { return r.json(); }).then(function(data) {
        if (data.session) location.href = '/code/session/' + data.session.sessionId;
      }).catch(function() { showError('Could not start the new runtime session.'); });
      return;
    }
    ws.send(JSON.stringify({ type: 'switch_model', provider: provider, model: model, baseUrl: baseUrl || '', apiKey: apiKey || '' }));
    mpLabel.textContent = model;
    mpDD.querySelectorAll('.mp-item').forEach(function(el) {
      el.classList.toggle('active', el.getAttribute('data-model') === model && el.getAttribute('data-provider') === provider);
    });
  }

  // ── Permission toggle ──────────────────────────────────────
  var permMode = 'auto'; // auto | safe | confirm
  var permToggle = document.getElementById('perm-toggle');
  var permBtns = permToggle.querySelectorAll('.perm-btn');
  var pendingApproval = null; // { id, resolve }

  function setPermMode(mode) {
    permMode = mode;
    permBtns.forEach(function(btn) {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });
    // Notify server
    fetch('/api/code/sessions/' + sessionId + '/permissions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: mode }),
    }).catch(function() {});
    // Notify bridge
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'set_permissions', mode: mode }));
    }
  }

  permBtns.forEach(function(btn) {
    btn.onclick = function() { setPermMode(btn.getAttribute('data-mode')); };
  });

  // Restore mode from session data
  function restorePermMode(mode) {
    if (mode && ['auto', 'safe', 'confirm'].indexOf(mode) !== -1) {
      permMode = mode;
      permBtns.forEach(function(btn) {
        btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
      });
    }
  }

  // ── Approval card ──────────────────────────────────────────
  function showApproval(id, tool, args) {
    var el = ensureAiMessage();
    var card = document.createElement('div');
    card.className = 'approval-card';
    card.id = 'approval-' + id;
    var argsStr = '';
    if (tool === 'terminal') argsStr = args.command || JSON.stringify(args);
    else if (tool === 'write_file' || tool === 'patch') argsStr = args.path || '';
    else if (tool === 'read_file') argsStr = args.path || '';
    else if (tool === 'search_files') argsStr = args.pattern || '';
    else argsStr = JSON.stringify(args, null, 2).slice(0, 200);

    card.innerHTML = '<div class="approval-header"><span class="approval-icon" style="display:inline-flex">${icon('alert-triangle', { size: 16 })}</span> Permission required</div>' +
      '<div class="approval-tool">' + escapeHtml(toolFriendlyName(tool)) + '</div>' +
      '<div class="approval-args">' + escapeHtml(argsStr) + '</div>' +
      '<div class="approval-actions">' +
        '<button class="approval-btn approve" data-id="' + escapeHtml(String(id)) + '">${icon('check', { size: 14 })} Approve</button>' +
        '<button class="approval-btn deny" data-id="' + escapeHtml(String(id)) + '">${icon('x', { size: 14 })} Deny</button>' +
      '</div>';
    el.appendChild(card);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    card.querySelector('.approve').onclick = function() {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'approval_response', id: id, approved: true }));
      }
      card.style.opacity = '0.5';
      card.querySelector('.approval-actions').innerHTML = '<span style="color:var(--green);font-size:.78rem;font-weight:600;display:inline-flex;align-items:center;gap:.3em">${icon('check', { size: 14 })} Approved</span>';
    };
    card.querySelector('.deny').onclick = function() {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'approval_response', id: id, approved: false }));
      }
      card.style.opacity = '0.5';
      card.querySelector('.approval-actions').innerHTML = '<span style="color:var(--red);font-size:.78rem;font-weight:600;display:inline-flex;align-items:center;gap:.3em">${icon('x', { size: 14 })} Denied</span>';
    };
  }

  // ── Diff review card ───────────────────────────────────────
  function showDiffCard(tool, args, result) {
    var filePath = args.path || '';
    if (!filePath) return;

    // Parse nested JSON from bridge output wrapper
    var parsed = result || {};
    if (parsed.output && typeof parsed.output === 'string' && !parsed.diff) {
      try { parsed = JSON.parse(parsed.output); } catch(e) {}
    }

    var content = '';
    var meta = '';
    if (tool === 'patch') {
      content = (parsed.diff || '').slice(0, 8000);
      if (parsed.files_modified && parsed.files_modified.length) {
        meta = parsed.files_modified.length + ' file' + (parsed.files_modified.length > 1 ? 's' : '') + ' modified';
      }
    } else if (tool === 'write_file') {
      // For write_file, show a summary instead of raw content
      var bytes = parsed.bytes_written || 0;
      meta = (bytes > 1024 ? (bytes / 1024).toFixed(1) + ' KB' : bytes + ' bytes') + ' written';
      if (parsed.dirs_created) meta += ' · dirs created';
      if (parsed.lint && parsed.lint.errors) meta += ' · ' + parsed.lint.errors + ' lint errors';
      if (parsed.lint && parsed.lint.warnings) meta += ' · ' + parsed.lint.warnings + ' warnings';
    }
    if (!content && !meta) return;

    var el = ensureAiMessage();
    var card = document.createElement('div');
    card.className = 'diff-card';
    var badge = tool === 'write_file' ? '<span class="diff-badge write">write</span>' : '<span class="diff-badge patch">patch</span>';
    var shortPath = filePath.split('/').slice(-2).join('/');

    var headerHtml = '<div class="diff-card-header"><span class="diff-file">' + escapeHtml(shortPath) + '</span>' + badge;
    if (meta) headerHtml += '<span style="font-weight:400;color:var(--g-text-3)">' + escapeHtml(meta) + '</span>';
    headerHtml += '<span class="diff-chevron">${icon('chevron-right', { size: 14 })}</span></div>';

    var bodyHtml = '';
    if (content) {
      bodyHtml = '<div class="diff-card-body">' + formatDiff(content) + '</div>';
    } else if (meta) {
      // No expandable content for write_file — just show meta in header
      bodyHtml = '';
    }

    card.innerHTML = headerHtml + bodyHtml;

    el.appendChild(card);
    if (bodyHtml) {
      var header = card.querySelector('.diff-card-header');
      var body = card.querySelector('.diff-card-body');
      header.onclick = function() {
        header.classList.toggle('open');
        body.classList.toggle('open');
      };
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ── Skill Banner ─────────────────────────────────────────────────
  function showSkillBanner(result) {
    var skillName = result.skill || '';
    var source = result.source || 'hermes';
    var label = source === 'ahd' ? 'AHD Skill' : 'Hermes Skill';
    var color = source === 'ahd' ? 'var(--accent)' : 'var(--amber)';
    var bg = source === 'ahd' ? 'var(--accent-soft)' : 'var(--amber-soft)';
    var el = ensureAiMessage();
    var banner = document.createElement('div');
    banner.className = 'skill-banner';
    banner.style.cssText = 'display:flex;align-items:center;gap:.5rem;padding:.35rem .65rem;margin:.35rem 0;border-radius:6px;border:1px solid ' + color + ';background:' + bg + ';font-size:.78rem;font-family:var(--mono);animation:rise .25s var(--ease) both';
    banner.innerHTML = '<span style="display:inline-flex">${icon('zap', { size: 16 })}</span>' +
      '<span style="color:' + color + ';font-weight:700;letter-spacing:.03em">' + escapeHtml(label) + '</span>' +
      '<span style="color:var(--g-text-2)">' + escapeHtml(skillName) + '</span>' +
      '<span style="color:var(--g-text-3);font-size:.7rem;margin-left:auto">loaded · ' + escapeHtml(source) + ' library</span>';
    el.appendChild(banner);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ── Multiple Choice Question Cards ───────────────────────────────
  // Detects <!--CLARIFY{...}--> in rendered HTML and replaces with interactive cards.
  // Also strips <!--SHIP--> and opens the ship chooser modal.
  function injectMCButtons(containerEl) {
    if (!containerEl) return;
    detectAndOpenShip(containerEl);
    var html = containerEl.innerHTML;
    var MCre = /&lt;!--CLARIFY([\s\S]*?)--&gt;|<!--CLARIFY([\s\S]*?)-->/g;
    var hadMatch = false;
    html = html.replace(MCre, function(_, j1, j2) {
      hadMatch = true;
      var jsonStr = (j1 || j2).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
      var data;
      try { data = JSON.parse(jsonStr); } catch(e) { return ''; }
      var q = data.q || data.question || '';
      var opts = Array.isArray(data.opts) ? data.opts : (Array.isArray(data.options) ? data.options : []);
      if (!opts.length) return '';
      var id = 'mc-' + Math.random().toString(36).slice(2, 8);
      var btns = opts.map(function(o, i) {
        return '<button class="mc-opt" data-mcid="' + id + '" data-val="' + escapeHtml(o) + '">' +
          '<span style="color:var(--accent);font-weight:600;margin-right:.5rem">'+(i+1)+'.</span>' + escapeHtml(o) + '</button>';
      }).join('');
      return '<div id="' + id + '" class="mc-card" style="border:1px solid var(--amber);background:var(--amber-soft);border-radius:8px;padding:.75rem 1rem;margin:.5rem 0;animation:rise .25s var(--ease) both">' +
        '<div style="font-weight:600;font-size:.85rem;margin-bottom:.4rem;color:var(--g-text);display:flex;align-items:center;gap:.4rem">${icon('message', { size: 16 })} ' + escapeHtml(q) + '</div>' +
        btns + '</div>';
    });
    if (hadMatch) {
      containerEl.innerHTML = html;
      containerEl.querySelectorAll('.mc-opt').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var val = btn.getAttribute('data-val');
          var card = document.getElementById(btn.getAttribute('data-mcid'));
          if (card) { card.style.opacity = '0.5'; card.style.pointerEvents = 'none'; }
          // Ship-labelled clarify opts → inject full shipping prompts
          if (val === LAND_ON_DEVELOPMENT_LABEL || /land on development/i.test(val)) {
            injectShipChoice('development');
            return;
          }
          if (val === FULL_PIPELINE_LABEL || /full pipeline/i.test(val)) {
            injectShipChoice('pipeline');
            return;
          }
          addUserMessage(val);
          if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'message', content: val }));
          setRunning(true);
        });
      });
    }
  }

  function showFileChanges(summary) {
    var lines = summary.split('\\n').filter(Boolean);
    if (!lines.length) return;
    // Parse git diff --stat output: "N files changed, N insertions(+), N deletions(-)"
    // and per-file lines like " path/to/file | 10 +++---"
    var card = document.createElement('div');
    card.className = 'diff-card';
    var headerHtml = '<div class="diff-card-header"><span class="diff-file">Files changed</span>' +
      '<span class="diff-badge patch">' + lines.length + ' file' + (lines.length > 1 ? 's' : '') + '</span>' +
      '<span class="diff-chevron">${icon('chevron-right', { size: 14 })}</span></div>';
    var bodyLines = '';
    for (var i = 0; i < lines.length; i++) {
      bodyLines += '<div>' + escapeHtml(lines[i]) + '</div>';
    }
    card.innerHTML = headerHtml + '<div class="diff-card-body">' + bodyLines + '</div>';
    var el = ensureAiMessage();
    el.appendChild(card);
    var header = card.querySelector('.diff-card-header');
    var body = card.querySelector('.diff-card-body');
    header.onclick = function() {
      header.classList.toggle('open');
      body.classList.toggle('open');
    };
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ── WebSocket ──────────────────────────────────────────
  function connect() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    wsDot.className = 'ws-dot connecting';
    statusText.textContent = 'Connecting…';
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/api/code/sessions/' + sessionId + '/ws');
    ws.onopen = function() {
      wsDot.className = 'ws-dot connected';
      statusText.textContent = 'Ready';
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    };
    ws.onclose = function() {
      wsDot.className = 'ws-dot disconnected';
      statusText.textContent = 'Disconnected — reconnecting…';
      reconnectTimer = setTimeout(connect, 3000);
    };
    ws.onerror = function() { ws.close(); };
    ws.onmessage = function(e) {
      var msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      handleMessage(msg);
    };
  }

  // Reconnect on tab visibility change (browsers throttle timers in background tabs)
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
      if (!ws || ws.readyState === 2 || ws.readyState === 3) {
        // WebSocket is closing or closed — force reconnect immediately
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        connect();
      }
    }
  });

  // ── Message handling ───────────────────────────────────
  function handleMessage(msg) {
    switch (msg.type) {
      case 'ready':
        statusText.textContent = 'Ready';
        if (msg.runtime === 'codex') {
          runtimeLabel.textContent = 'Codex';
          appendTerminal('info', 'Codex runtime ready.');
        }
        // On reconnect (not first load), reload messages from MongoDB
        // to catch answers that completed while tab was hidden
        if (window._reconnectReady) {
          fetch('/api/code/sessions/' + sessionId).then(function(r) { return r.json(); }).then(function(data) {
            if (data && data.session && data.session.messages) {
              var msgs = data.session.messages;
              // Only re-render if there are new messages we haven't displayed
              if (msgs.length > messageCount) {
                // Preserve existing DOM, only append new messages
                var existingIds = new Set();
                messagesEl.querySelectorAll('.msg[data-msg-id]').forEach(function(el) {
                  existingIds.add(el.getAttribute('data-msg-id'));
                });
                // Append only messages not already in DOM
                msgs.forEach(function(m) {
                  var mid = m._id || (m.role + '_' + (m.timestamp || m.createdAt || Date.now()));
                  if (!existingIds.has(mid)) {
                    renderSingleMessage(m, mid);
                  }
                });
                messageCount = msgs.length;
                updateCtxBar(msgs);
                scrollToBottom();
              }
            }
          }).catch(function() {});
        }
        window._reconnectReady = true;
        break;
      case 'user_message':
        addUserMessage(msg.content, false, false);
        appendTerminal('info', 'Prompt: ' + (msg.content || ''));
        break;
      case 'thinking':
        showThinking();
        if (msg.runtime === 'codex') appendTerminal('info', msg.content || 'Codex is thinking…');
        break;
      case 'token': appendStreamingToken(msg.content); break;
      case 'tool_start':
        removeStreamingCursor();
        showToolPanel(msg.id, msg.tool, msg.args);
        setAgentStatus(toolFriendlyName(msg.tool));
        if (msg.runtime === 'codex' && !terminalHasAutoOpened) {
          terminalHasAutoOpened = true;
          toggleTerminal(true);
        }
        appendTerminal(
          msg.tool === 'terminal' ? 'command' : 'info',
          msg.tool === 'terminal'
            ? ((msg.args && msg.args.command) || 'command')
            : (toolFriendlyName(msg.tool) + ' ' + terminalText(msg.args || {}))
        );
        // Store args for diff review on tool_result
        if (!window._toolArgs) window._toolArgs = {};
        window._toolArgs[msg.id] = msg.args;
        // Track files touched this turn for end-of-turn summary
        if (msg.tool === 'write_file' || msg.tool === 'patch') {
          if (msg.args && msg.args.path) currentTurnChanges.add(msg.args.path);
        } else if (msg.tool === 'git_commit' && msg.args && Array.isArray(msg.args.files)) {
          msg.args.files.forEach(function(f) { currentTurnChanges.add(f); });
        }
        break;
      case 'tool_result':
        updateToolResult(msg.id, msg.tool, msg.result);
        appendTerminal(
          msg.result && msg.result.error ? 'error' : 'result',
          msg.result && msg.result.error
            ? terminalText(msg.result.error)
            : terminalText((msg.result || {}).output || msg.result || 'completed')
        );
        // Count this tool call in the per-turn stats. A search/find counts
        // as a hit only if it returned at least one match; everything else
        // is just +1 to its category.
        (function() {
          var r = msg.result || {};
          var hit;
          if (msg.tool === 'search_files' || msg.tool === 'find_files') {
            var arr = r.matches || r.lines || r.files || [];
            hit = arr.length > 0;
          } else if (r && r.error) {
            hit = null;  // not a hit/miss — an error
            currentTurnStats.errors++;
          } else {
            hit = null;
          }
          bumpStat(msg.tool, hit);
        })();
        // Show diff review card for write_file/patch
        if (msg.tool === 'write_file' || msg.tool === 'patch') {
          showDiffCard(msg.tool, (window._toolArgs || {})[msg.id] || {}, msg.result);
          refreshWorkspace(350, true);
        } else if (msg.tool === 'git_commit' || msg.tool === 'terminal') {
          refreshWorkspace(500, true);
        }
        // Evict args for every tool once its result has arrived so
        // window._toolArgs can't grow unbounded across a long session.
        if (window._toolArgs) delete window._toolArgs[msg.id];
        // Show skill banner when use_skill completes
        if (msg.tool === 'use_skill' && msg.result && !msg.result.error) {
          showSkillBanner(msg.result);
        }
        break;
      case 'approval_needed':
        showApproval(msg.id, msg.tool, msg.args || {});
        break;
      case 'approval_cancelled':
        // Approval timed out or was cancelled
        var ac = document.getElementById('approval-' + msg.id);
        if (ac) { ac.style.opacity = '0.4'; ac.querySelector('.approval-actions').innerHTML = '<span style="color:var(--g-text-3);font-size:.78rem">Timed out</span>'; }
        break;
      case 'answer':
        hideThinking(); removeStreamingCursor(); showAnswer(msg.text); break;
      case 'file_changes':
        if (msg.summary) showFileChanges(msg.summary);
        refreshWorkspace(200, true);
        break;
      case 'error':
        hideThinking(); removeStreamingCursor(); showError(msg.error); setRunning(false);
        appendTerminal('error', msg.error || 'Agent error');
        break;
      case 'status':
        if (msg.status === 'stub') {
          loadingEl.style.display = 'none';
          showEmpty();
        } else if (msg.status === 'working') {
          loadingEl.style.display = 'none';
          setAgentStatus(msg.message || 'working');
        }
        break;
      case 'stage':
        // Granular "what is the agent doing right now" ticker. Update the
        // top-bar status pill (with a soft fade) and append a line to a
        // transient on-screen activity log so the user can see layer-by-layer
        // progress (Initializing agent → Planning → Reading X → Composing).
        if (msg.text) {
          setAgentStatus(msg.text);
          appendStageLine(msg.text);
        }
        break;
      case 'session_info':
        if (msg.title) {
          sessionTitle.textContent = msg.title;
          document.title = msg.title + ' \\u2014 Code Agent';
        }
        sessionData = sessionData || {};
        sessionData.title = msg.title || sessionData.title;
        sessionData.branchName = msg.branchName || sessionData.branchName;
        sessionData.worktreePath = msg.worktreePath || sessionData.worktreePath;
        updateSessionBar();
        refreshWorkspace(0, true);
        break;
      case 'cancelled':
        hideThinking(); removeStreamingCursor(); appendSystem('Cancelled.'); setRunning(false); break;
      case 'usage': updateContextBar(msg); break;
      case 'model_switched':
        mpLabel.textContent = msg.model || 'model';
        sessionData.model = msg.model;
        sessionData.provider = msg.provider;
        runtimeLabel.textContent = (msg.provider || '').toLowerCase() === 'codex' ? 'Codex' : 'Code Agent';
        appendTerminal('info', 'Model switched to ' + (msg.model || 'default') + '.');
        updateSessionBar();
        if (providersData.length) renderPicker(providersData, msg.provider, msg.model);
        break;
      case 'done':
        hideThinking(); removeStreamingCursor(); setRunning(false);
        appendTerminal('info', 'Turn complete.');
        refreshDelivery();
        messageCount++; updateSessionBar();
        break;
      case 'pr_created':
        sessionData.prUrl = msg.prUrl;
        sessionData.prNumber = msg.prNumber;
        btnPR.innerHTML = 'PR #' + escapeHtml(String(msg.prNumber || '')) + ' <span class="pr-state open">OPEN</span>';
        btnPR.classList.add('done');
        btnPR.onclick = function() { if (safePrUrl(msg.prUrl)) window.open(safePrUrl(msg.prUrl), '_blank', 'noopener'); };
        showPRCard(msg.prUrl, msg.prNumber);
        refreshWorkspace(0, true);
        break;
      case 'ping': /* server keepalive — ignore */ break;
      case 'info': /* bridge info — ignore */ break;
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ── PR link card ────────────────────────────────────────
  function showPRCard(prUrl, prNumber) {
    var linkUrl = safePrUrl(prUrl);
    if (!linkUrl) return;
    var card = document.createElement('div');
    card.className = 'pr-link-card';
    card.innerHTML = '<span class="pr-icon" style="display:inline-flex;color:var(--green)">${icon('git-pull-request', { size: 16 })}</span><span>PR created —</span>';
    var link = document.createElement('a');
    link.href = linkUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.style.cssText = 'display:inline-flex;align-items:center;gap:.3em';
    link.textContent = 'PR #' + String(prNumber || '');
    card.appendChild(link);
    messagesEl.appendChild(card);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ── Click-to-edit title ─────────────────────────────────
  sessionTitle.addEventListener('click', function() {
    if (sessionTitle.contentEditable === 'true') return;
    sessionTitle.contentEditable = 'true';
    sessionTitle.classList.add('editing');
    // Select all text
    var range = document.createRange();
    range.selectNodeContents(sessionTitle);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    sessionTitle.focus();
  });
  function commitTitle() {
    sessionTitle.contentEditable = 'false';
    sessionTitle.classList.remove('editing');
    var newTitle = sessionTitle.textContent.trim();
    if (!newTitle || newTitle === (sessionData && sessionData.title)) {
      sessionTitle.textContent = (sessionData && sessionData.title) || 'New chat';
      return;
    }
    fetch('/api/code/sessions/' + sessionId + '/title', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle }),
    }).then(function(r) { return r.json(); }).then(function(data) {
      if (data.ok) {
        sessionData.title = data.title;
        document.title = data.title + ' — Code Agent';
      }
    }).catch(function() {});
  }
  sessionTitle.addEventListener('blur', commitTitle);
  sessionTitle.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); sessionTitle.blur(); }
    if (e.key === 'Escape') {
      sessionTitle.textContent = (sessionData && sessionData.title) || 'New chat';
      sessionTitle.contentEditable = 'false';
      sessionTitle.classList.remove('editing');
    }
  });

  // ── Rendering ──────────────────────────────────────────
  function showEmpty() {
    if (document.getElementById('empty-state')) return;
    var g = 'What should we work on?';
    var wrap = document.createElement('div');
    wrap.className = 'empty-state';
    wrap.id = 'empty-state';
    wrap.innerHTML = '<div class="gem-greet-spark">' + sparkSVG(38, true) + '</div>' +
      '<h2>' + escapeHtml(g) + '</h2>' +
      '<p>Describe what to build or fix. The agent has full read/write access to the codebase via Hermes.</p>' +
      '<div class="suggestions">' +
        '<span class="suggestion" data-msg="Show me the current git status"><span class="s-ico">${icon('git-branch', { size: 15 })}</span> Git status</span>' +
        '<span class="suggestion" data-msg="Read src/lib/economy/ and explain the GDP calculation"><span class="s-ico">${icon('file-text', { size: 15 })}</span> Read economy</span>' +
        '<span class="suggestion" data-msg="Run TypeScript type check and show errors"><span class="s-ico">${icon('code', { size: 15 })}</span> Type check</span>' +
        '<span class="suggestion" data-msg="Find all TODO comments in the codebase"><span class="s-ico">${icon('search', { size: 15 })}</span> Find TODOs</span>' +
      '</div>';
    messagesEl.appendChild(wrap);
    wrap.querySelectorAll('.suggestion').forEach(function(el) {
      el.addEventListener('click', function() {
        input.value = this.getAttribute('data-msg');
        autoResize();
        input.focus();
      });
    });
  }
  function hideEmpty() { var el = document.getElementById('empty-state'); if (el) el.remove(); }

  function addUserMessage(text, images, animate) {
    // Support old call signature: addUserMessage(text, animate)
    if (typeof images === 'boolean' || images === undefined) { animate = images; images = []; }
    hideEmpty();
    endToolGroup();
    if (animate !== false) messageCount++;
    var wrap = document.createElement('div');
    wrap.className = 'msg user';
    if (animate === false) wrap.style.animation = 'none';
    var initial = (window.__userName || 'U').charAt(0).toUpperCase();
    wrap.innerHTML = '<div class="msg-avatar person">' + escapeHtml(initial) + '</div><div class="msg-body"><div class="msg-content"></div></div>';
    var content = wrap.querySelector('.msg-content');
    if (images && images.length) {
      var imageStrip = document.createElement('div');
      imageStrip.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px';
      images.forEach(function(image) {
        var preview = document.createElement('img');
        preview.src = String(image.data || '');
        preview.style.cssText = 'max-width:160px;max-height:120px;border-radius:6px;border:1px solid var(--g-line);object-fit:cover';
        preview.alt = 'attached image';
        imageStrip.appendChild(preview);
      });
      content.appendChild(imageStrip);
    }
    if (text) content.appendChild(document.createTextNode(text));
    wrap.setAttribute('data-msg-id', 'user_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
    messagesEl.appendChild(wrap);
  }

  function startAiMessage(animate) {
    hideEmpty();
    endToolGroup();
    var wrap = document.createElement('div');
    wrap.className = 'msg ai';
    if (animate === false) wrap.style.animation = 'none';
    wrap.innerHTML = '<div class="msg-avatar ai">' + sparkSVG(26, true) + '</div><div class="msg-body"><div class="msg-name">Code Agent</div><div class="msg-content" id="ai-content"></div></div>';
    wrap.setAttribute('data-msg-id', 'ai_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
    messagesEl.appendChild(wrap);
    currentMsg = wrap;
    currentActivity = null;
    return wrap.querySelector('#ai-content');
  }
  function ensureAiMessage() {
    if (!currentMsg) return startAiMessage();
    return currentMsg.querySelector('#ai-content');
  }

  function appendStreamingToken(text) {
    if (!text && text !== 0) return; // guard against null/undefined tokens
    endToolGroup(); // text after tools → next tool run starts a fresh group
    var el = ensureAiMessage();
    if (!streamingEl) {
      streamingEl = document.createElement('span');
      streamingEl.className = 'streaming-text';
      el.appendChild(streamingEl);
    }
    streamingEl.textContent += text;
    var cursor = el.querySelector('.streaming-cursor');
    if (!cursor) {
      cursor = document.createElement('span');
      cursor.className = 'streaming-cursor';
      el.appendChild(cursor);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function removeStreamingCursor() {
    var cursors = document.querySelectorAll('.streaming-cursor');
    cursors.forEach(function(c) { c.remove(); });
    if (streamingEl) {
      var text = streamingEl.textContent;
      var parent = streamingEl.parentNode;
      var temp = document.createElement('span');
      temp.innerHTML = renderMarkdown(text);
      parent.replaceChild(temp, streamingEl);
      renderMermaidIn(parent);
      injectMCButtons(temp);
      streamingEl = null;
    }
  }

  function showThinking() {
    hideThinking();
    var el = ensureAiMessage();
    var div = document.createElement('div');
    div.className = 'thinking';
    div.id = 'thinking-indicator';
    div.innerHTML = '<span>Thinking</span><span class="dots"><span>.</span><span>.</span><span>.</span></span>';
    el.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  function hideThinking() { var el = document.getElementById('thinking-indicator'); if (el) el.remove(); }

  // Consecutive tool calls are collected into one collapsible group so a long
  // run of reads/searches doesn't flood the transcript. A new group starts
  // whenever the agent emits non-tool content (text, answer, system note).
  function getToolGroupBody() {
    var el = ensureAiMessage();
    if (currentToolGroup && currentToolGroup.parentNode === el) {
      return currentToolGroup.querySelector('.tool-group-body');
    }
    var g = document.createElement('div');
    g.className = 'tool-group';
    g.innerHTML = '<div class="tool-group-head" onclick="toggleToolGroup(this)">' +
      '<span class="tg-chevron">${icon('chevron-down', { size: 14 })}</span>' +
      '<span class="tg-label">Tool calls</span>' +
      '<span class="tg-summary"></span>' +
      '</div>' +
      '<div class="tool-group-body"></div>';
    el.appendChild(g);
    currentToolGroup = g;
    return g.querySelector('.tool-group-body');
  }
  function endToolGroup() { currentToolGroup = null; }
  function updateToolGroupSummary(group) {
    if (!group) return;
    var panels = group.querySelectorAll('.tool-panel');
    var ok = 0, empty = 0, err = 0, running = 0;
    var targets = [], seen = {};
    panels.forEach(function(p) {
      if (p.classList.contains('is-err')) err++;
      else if (p.classList.contains('is-empty')) empty++;
      else if (p.querySelector('.tool-status.running')) running++;
      else ok++;
      var argsEl = p.querySelector('.tool-args');
      var raw = argsEl ? String(argsEl.textContent || '').replace(/\\s+/g, ' ').trim() : '';
      if (!raw || targets.length >= 3) return;
      var file = raw.match(/(?:^|[\\s\\/\`'"])((?:\\/[\\w.-]+)+\\.\\w{1,8}|[\\w.-]+\\.\\w{1,8})\\b/);
      var snippet = file ? file[1] : raw.split(/\\s+/).slice(0, 4).join(' ');
      var clipped = snippet.length > 36 ? snippet.slice(0, 35) + '…' : snippet;
      if (!clipped || seen[clipped]) return;
      seen[clipped] = 1;
      targets.push(clipped);
    });
    var sum = group.querySelector('.tg-summary');
    var label = group.querySelector('.tg-label');
    if (!sum) return;
    var detail = [];
    if (ok) detail.push('<span class="tg-ok">' + ok + ' ok</span>');
    if (empty) detail.push('<span class="tg-empty">' + empty + ' empty</span>');
    if (err) detail.push('<span class="tg-err">' + err + ' failed</span>');
    if (running) detail.push(running + ' running');
    if (label && targets.length && !group.getAttribute('data-intent')) {
      label.textContent = targets.join(' · ');
    }
    sum.innerHTML = panels.length + (panels.length === 1 ? ' call' : ' calls') +
      (detail.length ? ' \\u00b7 ' + detail.join(' \\u00b7 ') : '');
  }

  function showToolPanel(id, tool, args) {
    var groupBody = getToolGroupBody();
    var panel = document.createElement('div');
    panel.className = 'tool-panel';
    panel.id = 'tool-' + id;
    var icon = toolIcon(tool);
    var argStr = formatToolArgs(tool, args);
    panel.innerHTML = '<div class="tool-header" onclick="toggleToolPanel(this)">' +
      '<span class="tool-icon">' + icon + '</span>' +
      '<span class="tool-verb-main">' + escapeHtml(cap(toolFriendlyName(tool))) + '</span>' +
      (argStr ? '<span class="tool-args">' + escapeHtml(argStr) + '</span>' : '<span class="tool-args"></span>') +
      '<span class="tool-meta"></span>' +
      '<span class="tool-name">' + escapeHtml(tool) + '</span>' +
      '<span class="tool-status running">running</span>' +
      '<span class="tool-toggle">${icon('chevron-right', { size: 13 })}</span>' +
      '</div>' +
      '<div class="tool-body" id="tool-body-' + id + '"></div>';
    groupBody.appendChild(panel);
    currentToolPanels[id] = panel;
    updateToolGroupSummary(currentToolGroup);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function updateToolResult(id, tool, result) {
    var panel = currentToolPanels[id];
    if (!panel) { showToolPanel(id, tool, {}); panel = currentToolPanels[id]; }
    var statusEl = panel.querySelector('.tool-status');
    var bodyEl = panel.querySelector('.tool-body');
    var toggleEl = panel.querySelector('.tool-toggle');
    var metaEl = panel.querySelector('.tool-meta');
    panel.classList.remove('is-empty');
    if (result && result.error) {
      panel.classList.add('is-err');
      statusEl.className = 'tool-status err';
      statusEl.textContent = 'error';
      if (metaEl) metaEl.textContent = '';
      bodyEl.innerHTML = '<div class="tb-text" style="color:var(--red)">' + escapeHtml(String(result.error)) + '</div>';
      appendRawOutput(bodyEl, result, true);  // always show raw on errors
      bodyEl.classList.add('open');
      toggleEl.classList.add('open');
    } else {
      var empty = isEmptyResult(tool, result);
      if (empty) {
        panel.classList.add('is-empty');
        statusEl.className = 'tool-status empty';
        statusEl.textContent = 'empty';
      } else {
        statusEl.className = 'tool-status ok';
        statusEl.textContent = 'done';
      }
      if (metaEl) metaEl.innerHTML = toolResultMeta(tool, result);
      bodyEl.innerHTML = formatToolResult(tool, result);
      // Measure the rendered body BEFORE appending the (hidden) raw dump so the
      // auto-expand heuristic still reflects the human-readable content size.
      var textLen = bodyEl.textContent.length;
      // Only show "Show raw output" when the result has data the user might want
      // to inspect. Skip on empty results (that's the spam case) and on results
      // that were truncated for display.
      var truncated = result && result._truncated === true;
      var showRaw = !empty || truncated;
      appendRawOutput(bodyEl, result, showRaw);
      // Auto-expand short results (and anything empty, so the "why" is visible);
      // keep big dumps collapsed for a clean transcript.
      if (empty || (textLen > 0 && textLen < 1400)) {
        bodyEl.classList.add('open');
        toggleEl.classList.add('open');
      }
    }
    updateToolGroupSummary(panel.closest('.tool-group'));
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // A result is "empty" when the call succeeded but produced nothing useful —
  // worth flagging distinctly from a hard error so empty runs are easy to spot.
  function isEmptyResult(tool, result) {
    if (result == null) return true;
    if (typeof result !== 'object') return !String(result).trim();
    if (result.error) return false;
    if (tool === 'search_files') return !((result.matches || result.lines || []).length);
    if (tool === 'find_files') return !((result.files || []).length);
    if (tool === 'terminal' || tool === 'tsc_check') {
      var out = (result.stdout || '') + (result.stderr || '') + (typeof result.output === 'string' ? result.output : '');
      return !out.trim();
    }
    if (tool === 'git_status') return !String(result.status || resultText(result) || '').trim();
    if (tool === 'git_diff') { var d = String(result.diff || resultText(result) || '').trim(); return !d || d === '(no changes)'; }
    if (tool === 'git_log') { var l = String(result.log || resultText(result) || '').trim(); return !l || l === '(no commits)'; }
    return false;
  }

  // Attach a collapsed "raw output" dump (full JSON result) so successful calls
  // can be inspected verbatim — and empty/failed ones reveal the actual command
  // and any engine/stderr detail behind the empty result.
  // \`show\` defaults to true; callers pass false to suppress the button entirely
  // (e.g. for uninteresting empty results that would otherwise spam the chat).
  function appendRawOutput(bodyEl, result, show) {
    if (show === false) return;
    var raw;
    try { raw = JSON.stringify(result, null, 2); } catch (e) { raw = String(result); }
    if (!raw) return;
    var wrap = document.createElement('div');
    wrap.className = 'tool-raw';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tool-raw-btn';
    btn.textContent = 'Show raw output';
    btn.setAttribute('onclick', 'toggleRaw(this)');
    var pre = document.createElement('pre');
    pre.className = 'tool-raw-pre';
    pre.style.display = 'none';
    pre.textContent = raw;
    wrap.appendChild(btn);
    wrap.appendChild(pre);
    bodyEl.appendChild(wrap);
  }

  function showAnswer(text) {
    if (currentActivity) {
      var act = currentActivity;
      act.el.style.transition = 'opacity .4s ease';
      act.el.style.opacity = '0';
      setTimeout(function() { if (act.el.parentNode) act.el.remove(); }, 400);
      currentActivity = null;
    }
    var el = ensureAiMessage();
    el.removeAttribute('id');
    // Remove streaming tokens but keep tool panels, diff cards, and tool groups
    var toRemove = [];
    for (var i = 0; i < el.childNodes.length; i++) {
      var node = el.childNodes[i];
      if (node.nodeType === 3) toRemove.push(node); // text nodes (streaming tokens)
      else if (node.classList && !node.classList.contains('tool-panel') && !node.classList.contains('tool-group') && !node.classList.contains('diff-card') && !node.classList.contains('file-changes-card')) {
        toRemove.push(node); // non-tool content (streaming cursor, etc)
      }
    }
    for (var j = 0; j < toRemove.length; j++) { toRemove[j].remove(); }
    // Render file-changes summary card if any files were touched
    if (currentTurnChanges.size > 0) {
      showFileChangesCard(Array.from(currentTurnChanges));
      currentTurnChanges = new Set();
    }
    // Render per-turn activity-stats card (Read 4 files · Searched 3 (33% hit) …)
    if (currentTurnStats.total > 0) {
      showStatsCard(currentTurnStats);
    }
    currentTurnStats = emptyTurnStats();
    // Drop the activity ticker — its job is done once the final answer lands
    clearStageLog();
    // Append rendered answer after tool panels
    var ans = document.createElement('div');
    ans.className = 'answer-content';
    ans.innerHTML = renderMarkdown(text);
    el.appendChild(ans);
    renderMermaidIn(ans);
    injectMCButtons(ans);
    currentMsg = null; streamingEl = null;
    endToolGroup();
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showFileChangesCard(files) {
    var el = ensureAiMessage();
    var card = document.createElement('div');
    card.className = 'file-changes-card';
    var items = files.map(function(f) { return '<div class="fc-item"><span class="fc-icon" style="display:inline-flex">${icon('file-text', { size: 13 })}</span>' + escapeHtml(f) + '</div>'; }).join('');
    card.innerHTML = '<div class="fc-head" style="display:flex;align-items:center;gap:.4rem">${icon('file-text', { size: 14 })} ' + files.length + ' file' + (files.length === 1 ? '' : 's') + ' changed this turn</div>' +
      '<div class="fc-list">' + items + '</div>';
    el.appendChild(card);
  }

  // Per-turn activity summary: "Read 4 files · Searched 3 (33% hit) · Patched 2"
  // Shown right before the file-changes card so the user gets a single high-level
  // view of what the agent did this turn.
  function showStatsCard(s) {
    var el = ensureAiMessage();
    var parts = [];
    function add(label, n) { if (n > 0) parts.push(label + ' <strong>' + n + '</strong>' + (n === 1 ? '' : 's' === 's' ? '' : '')); }
    // Slightly more readable hand-rolled formatting
    function p(n, singular, plural) { if (n > 0) parts.push(singular.replace('{}', '<strong>' + n + '</strong>') + (n === 1 ? '' : 's')); }
    if (s.read) parts.push('Read <strong>' + s.read + '</strong> file' + (s.read === 1 ? '' : 's'));
    if (s.write) parts.push('Wrote <strong>' + s.write + '</strong> file' + (s.write === 1 ? '' : 's'));
    if (s.patch) parts.push('Patched <strong>' + s.patch + '</strong> file' + (s.patch === 1 ? '' : 's'));
    if (s.search) {
      var searchTotal = s.hits + s.miss;
      var hitRate = searchTotal > 0 ? Math.round((s.hits / searchTotal) * 100) : 0;
      parts.push('Searched <strong>' + s.search + '</strong> time' + (s.search === 1 ? '' : 's') + ' (<strong>' + hitRate + '%</strong> hit rate)');
    }
    if (s.find) parts.push('Found files <strong>' + s.find + '</strong> time' + (s.find === 1 ? '' : 's'));
    if (s.terminal) parts.push('Ran <strong>' + s.terminal + '</strong> command' + (s.terminal === 1 ? '' : 's'));
    if (s.tsc) parts.push('Type-checked <strong>' + s.tsc + '</strong> time' + (s.tsc === 1 ? '' : 's'));
    if (s.git) parts.push('Did <strong>' + s.git + '</strong> git op' + (s.git === 1 ? '' : 's'));
    if (s.skill) parts.push('Loaded <strong>' + s.skill + '</strong> skill' + (s.skill === 1 ? '' : 's'));
    if (s.errors) parts.push('<span class="stat-err" style="display:inline-flex;align-items:center;gap:.3em">${icon('alert-triangle', { size: 13 })} ' + s.errors + ' error' + (s.errors === 1 ? '' : 's') + '</span>');

    if (!parts.length) return;
    var card = document.createElement('div');
    card.className = 'stats-card';
    card.innerHTML = '<div class="stats-head" style="display:flex;align-items:center;gap:.4rem">${icon('activity', { size: 14 })} Activity</div>' +
      '<div class="stats-line">' + parts.join(' · ') + '</div>';
    el.appendChild(card);
  }

  function showError(error) {
    if (currentActivity) { currentActivity.el.remove(); currentActivity = null; }
    endToolGroup();
    var el = ensureAiMessage();
    el.removeAttribute('id');
    el.innerHTML += '<div style="color:var(--red);font-size:.85rem;margin-top:var(--s-2);display:flex;align-items:center;gap:.4em">${icon('alert-triangle', { size: 14 })} ' + escapeHtml(error) + '</div>';
    currentMsg = null; streamingEl = null;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendSystem(text) {
    hideEmpty();
    endToolGroup();
    var wrap = document.createElement('div');
    wrap.className = 'msg ai system';
    wrap.innerHTML = '<div class="msg-avatar ai">' + sparkSVG(26, true) + '</div><div class="msg-body"><div class="msg-content" style="color:var(--g-text-3);font-size:.84rem;font-style:italic">' + escapeHtml(text) + '</div></div>';
    messagesEl.appendChild(wrap);
    currentMsg = null; streamingEl = null;
  }

  // Stage log: a small fixed-height live ticker of what the agent is doing.
  // Lives at the top of the current AI message so it scrolls with the chat
  // and disappears the moment \`showAnswer\` replaces streaming content with
  // the final answer card.
  function ensureStageLog() {
    if (currentStageLog && currentStageLog.parentNode) return currentStageLog;
    var el = ensureAiMessage();
    var log = document.createElement('div');
    log.className = 'stage-log';
    log.innerHTML = '<div class="stage-log-head">Activity</div><div class="stage-log-body"></div>';
    el.insertBefore(log, el.firstChild);
    currentStageLog = log;
    return log;
  }
  function appendStageLine(text) {
    if (!text) return;
    stageLogLines.push(text);
    if (stageLogLines.length > 12) stageLogLines.shift();
    var log = ensureStageLog();
    var body = log.querySelector('.stage-log-body');
    var line = document.createElement('div');
    line.className = 'stage-line';
    line.textContent = text;
    body.appendChild(line);
    // Cap visible lines to keep the ticker compact
    while (body.childNodes.length > 8) body.removeChild(body.firstChild);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  function clearStageLog() {
    currentStageLog = null;
    stageLogLines = [];
  }

  // ── Input handling ─────────────────────────────────────
  var isRunning = false;
  var messageQueue = [];
  var _suppressScroll = false;

  document.getElementById('btn-plus').onclick = function() {
    if (!document.getElementById('empty-state') && messagesEl.querySelectorAll('.msg').length === 0) showEmpty();
    input.focus();
  };

  sendBtn.onclick = sendMessage;

  // ── Image attachment ────────────────────────────────────────────
  var pendingImages = [];  // { data: base64DataURL, mimeType, name }
  var imgFileInput = document.getElementById('img-file-input');
  var imgPreviewStrip = document.getElementById('img-preview-strip');
  var btnAttach = document.getElementById('btn-attach');

  function renderImagePreview() {
    if (!imgPreviewStrip) return;
    if (!pendingImages.length) { imgPreviewStrip.style.display = 'none'; if (btnAttach) btnAttach.classList.remove('has-images'); return; }
    imgPreviewStrip.style.display = 'flex';
    if (btnAttach) btnAttach.classList.add('has-images');
    imgPreviewStrip.innerHTML = pendingImages.map(function(img, i) {
      return '<div class="img-thumb"><img src="' + img.data + '" alt="' + escapeHtml(img.name || 'image') + '"><button class="img-rm" data-idx="' + i + '" title="Remove">${icon('x', { size: 12 })}</button></div>';
    }).join('');
    imgPreviewStrip.querySelectorAll('.img-rm').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        pendingImages.splice(idx, 1);
        renderImagePreview();
      });
    });
  }

  if (btnAttach) btnAttach.addEventListener('click', function() { if (imgFileInput) imgFileInput.click(); });
  if (imgFileInput) {
    imgFileInput.addEventListener('change', function() {
      var files = Array.from(imgFileInput.files || []).slice(0, 4 - pendingImages.length);
      var readers = files.map(function(file) {
        return new Promise(function(resolve) {
          var reader = new FileReader();
          reader.onload = function(e) { resolve({ data: e.target.result, mimeType: file.type || 'image/png', name: file.name }); };
          reader.readAsDataURL(file);
        });
      });
      Promise.all(readers).then(function(imgs) {
        pendingImages = pendingImages.concat(imgs).slice(0, 4);
        renderImagePreview();
      });
      imgFileInput.value = '';
    });
  }

  function addClipboardImages(fileList) {
    var room = Math.max(0, 4 - pendingImages.length);
    var files = Array.from(fileList || []).filter(function(file) {
      return file && /^image\\/(png|jpeg|jpg|webp|gif)$/i.test(file.type || '');
    }).slice(0, room);
    if (!files.length) return Promise.resolve(0);
    return Promise.all(files.map(function(file) {
      return new Promise(function(resolve, reject) {
        if (file.size > 8 * 1024 * 1024) return reject(new Error((file.name || 'image') + ' is over 8 MB'));
        var reader = new FileReader();
        reader.onload = function(e) {
          resolve({ data: e.target.result, mimeType: file.type || 'image/png', name: file.name || ('paste-' + Date.now() + '.png') });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    })).then(function(imgs) {
      pendingImages = pendingImages.concat(imgs).slice(0, 4);
      renderImagePreview();
      return imgs.length;
    });
  }

  if (input) {
    input.addEventListener('paste', function(e) {
      var items = e.clipboardData && e.clipboardData.items ? Array.from(e.clipboardData.items) : [];
      var files = items.filter(function(item) {
        return item.kind === 'file' && /^image\\//i.test(item.type || '');
      }).map(function(item) { return item.getAsFile(); }).filter(Boolean);
      if (!files.length && e.clipboardData && e.clipboardData.files) {
        files = Array.from(e.clipboardData.files).filter(function(file) {
          return /^image\\//i.test(file.type || '');
        });
      }
      if (!files.length) return;
      e.preventDefault();
      addClipboardImages(files).catch(function() {});
    });
  }

  function sendMessage() {
    var text = input.value.trim();
    var images = pendingImages.slice();
    if (!text && !images.length) return;
    if (!ws || ws.readyState !== 1) { appendSystem('Not connected. Reconnecting…'); connect(); return; }
    input.value = '';
    pendingImages = [];
    renderImagePreview();
    autoResize();
    if (isRunning) {
      addUserMessage(text || (images.length + ' image' + (images.length > 1 ? 's' : '') + ' attached'));
      messageQueue.push({ text: text, images: images });
      appendSystem('Queued — will send after agent finishes.');
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return;
    }
    addUserMessage(text || (images.length + ' image' + (images.length > 1 ? 's' : '') + ' attached'), images);
    setRunning(true);
    currentMsg = null; streamingEl = null;
    currentTurnChanges = new Set();
    currentTurnStats = emptyTurnStats();
    clearStageLog();
    var msgPayload = { type: 'message', content: text || 'Please analyze the attached image(s).' };
    if (images.length) {
      msgPayload.images = images.map(function(img) {
        return { data: img.data, mimeType: img.mimeType };
      });
    }
    ws.send(JSON.stringify(msgPayload));
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function flushQueue() {
    if (messageQueue.length === 0) return;
    var next = messageQueue.shift();
    setRunning(true);
    currentMsg = null; streamingEl = null;
    var payload = typeof next === 'object' && next.text !== undefined
      ? { type: 'message', content: next.text || 'Please analyze the attached image(s).' }
      : { type: 'message', content: next };
    if (typeof next === 'object' && next.images && next.images.length) {
      payload.images = next.images.map(function(img) { return { data: img.data, mimeType: img.mimeType }; });
    }
    ws.send(JSON.stringify(payload));
    messagesEl.querySelectorAll('.msg.system').forEach(function(el) {
      if (el.textContent.indexOf('Queued') !== -1) el.remove();
    });
    if (messageQueue.length > 0) {
      appendSystem(messageQueue.length + ' message' + (messageQueue.length > 1 ? 's' : '') + ' still queued.');
    }
  }

  function setRunning(running) {
    isRunning = running;
    sendBtn.disabled = false;
    if (running) {
      sendBtn.className = 'send-btn cancel';
      sendBtn.innerHTML = STOP_ICON;
      sendBtn.title = 'Cancel';
      sendBtn.onclick = function() {
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'cancel' }));
        messageQueue = [];
        messagesEl.querySelectorAll('.msg.system').forEach(function(el) {
          if (el.textContent.indexOf('Queued') !== -1 || el.textContent.indexOf('still queued') !== -1) el.remove();
        });
      };
      startTimer();
      setAgentStatus('thinking');
    } else {
      sendBtn.className = 'send-btn';
      sendBtn.innerHTML = SEND_ICON;
      sendBtn.title = 'Send (Enter)';
      sendBtn.onclick = sendMessage;
      stopTimer();
      setTimeout(flushQueue, 300);
    }
  }

  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  function autoResize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 170) + 'px';
  }
  input.addEventListener('input', autoResize);

  // ── PR creation ─────────────────────────────────────────
  function createPR(skipConfirm) {
    if (!skipConfirm && !confirm('Push this branch and create a pull request?')) return;
    btnPR.disabled = true;
    btnPR.textContent = 'Creating…';
    if (workspacePR) { workspacePR.disabled = true; workspacePR.textContent = 'Creating…'; }
    fetch('/api/code/sessions/' + sessionId + '/pr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })
      .then(function(r) {
        return r.json().then(function(data) {
          if (!r.ok) throw new Error(data.error || 'Pull request creation failed');
          return data;
        });
      })
      .then(function(data) {
        btnPR.disabled = false;
        sessionData.prUrl = data.prUrl;
        sessionData.prNumber = data.prNumber;
        if (data.workspace) renderWorkspace(data.workspace);
        btnPR.innerHTML = 'PR #' + escapeHtml(String(data.prNumber || '')) + ' <span class="pr-state open">OPEN</span>';
        btnPR.classList.add('done');
        btnPR.onclick = function() { if (safePrUrl(data.prUrl)) window.open(safePrUrl(data.prUrl), '_blank', 'noopener'); };
        showPRCard(data.prUrl, data.prNumber);
      })
      .catch(function(e) {
        btnPR.disabled = false;
        btnPR.textContent = 'Create PR';
        if (workspacePR) { workspacePR.disabled = false; workspacePR.innerHTML = 'Create <span class="wide">PR</span>'; }
        appendSystem('PR not created: ' + e.message);
      });
  }

  // ── Feature 2: Reviewer Agent ────────────────────────────────────
  var reviewerEs = null;
  function requestReview() {
    if (reviewerEs) { reviewerEs.close(); reviewerEs = null; }
    if (btnReview) { btnReview.classList.add('working'); btnReview.innerHTML = '${icon('search', { size: 15 })} Reviewing…'; }
    var reviewDiv = document.createElement('div');
    reviewDiv.className = 'msg-reviewer';
    reviewDiv.innerHTML = '<div class="reviewer-header"><span style="display:inline-flex;align-items:center;gap:.4em">${icon('search', { size: 16 })} Code Reviewer</span></div><div class="reviewer-body" style="font-size:.85rem;line-height:1.65;color:var(--g-text)"></div>';
    messagesEl.appendChild(reviewDiv);
    var body = reviewDiv.querySelector('.reviewer-body');
    body.innerHTML = '<div class="loading" style="padding:.5rem 0"><div class="spinner"></div></div>';
    messagesEl.scrollTop = messagesEl.scrollHeight;

    var reviewText = '';
    reviewerEs = new EventSource('/api/code/sessions/' + sessionId + '/review', { withCredentials: true });
    reviewerEs.addEventListener('token', function(e) {
      var d = JSON.parse(e.data);
      reviewText += d.text || '';
      body.innerHTML = renderMarkdownReviewer(reviewText) + '<span class="stream-cursor" style="display:inline-block;width:6px;height:1em;border-radius:2px;background:var(--amber);margin-left:2px;vertical-align:text-bottom;animation:cursorBlink 1s steps(2,start) infinite"></span>';
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
    reviewerEs.addEventListener('done', function(e) {
      var d = JSON.parse(e.data);
      if (d.text) reviewText = d.text;
      body.innerHTML = renderMarkdownReviewer(reviewText || 'Review complete.');
      var meta = document.createElement('div');
      meta.style.cssText = 'font-size:.68rem;color:var(--g-text-3);margin-top:.5rem;font-family:var(--mono)';
      if (d.diffLines) meta.textContent = d.diffLines + ' diff lines reviewed';
      body.appendChild(meta);
      if (btnReview) { btnReview.classList.remove('working'); btnReview.innerHTML = '${icon('search', { size: 15 })} Review'; }
      reviewerEs.close(); reviewerEs = null;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
    reviewerEs.addEventListener('error', function(e) {
      try { var d = JSON.parse(e.data); body.innerHTML = '<span style="color:var(--red)">' + escapeHtml(d.error || 'Review failed') + '</span>'; } catch { body.innerHTML = '<span style="color:var(--red)">Review failed. Try again.</span>'; }
      if (btnReview) { btnReview.classList.remove('working'); btnReview.innerHTML = '${icon('search', { size: 15 })} Review'; }
      reviewerEs.close(); reviewerEs = null;
    });
    reviewerEs.onerror = function() {
      body.innerHTML = reviewText ? renderMarkdownReviewer(reviewText) : '<span style="color:var(--red)">Connection lost during review.</span>';
      if (btnReview) { btnReview.classList.remove('working'); btnReview.innerHTML = '${icon('search', { size: 15 })} Review'; }
      if (reviewerEs) { reviewerEs.close(); reviewerEs = null; }
    };
  }
  if (btnReview) {
    btnReview.addEventListener('click', function() {
      if (!btnReview.classList.contains('working')) requestReview();
    });
  }
  // Simple markdown renderer for reviewer output (reuses renderMarkdown pattern)
  function renderMarkdownReviewer(text) {
    if (!text) return '';
    var BT = String.fromCharCode(96);
    var lines = text.split('\\n');
    var out = []; var i = 0;
    while (i < lines.length) {
      var line = lines[i]; var trimmed = line.trim();
      if (trimmed.indexOf(BT+BT+BT) === 0) {
        var lang = trimmed.slice(3).trim(); var code = []; i++;
        while (i < lines.length && lines[i].trim().indexOf(BT+BT+BT) !== 0) { code.push(lines[i]); i++; }
        if (i < lines.length) i++;
        out.push('<div style="margin:.4rem 0;background:var(--g-surface-3);border:1px solid var(--g-line);border-radius:6px;overflow:hidden"><div style="font-size:.62rem;padding:.25rem .5rem;background:var(--g-surface-2);color:var(--g-text-3);font-family:var(--mono);text-transform:uppercase">'+(lang||'code')+'</div><pre style="margin:0;padding:.5rem .75rem;font-family:var(--mono);font-size:.75rem;overflow-x:auto"><code>'+escapeHtml(code.join('\\n'))+'</code></pre></div>');
        continue;
      }
      if (trimmed === '') { i++; continue; }
      var h = 0; while (h < line.length && line.charAt(h) === '#') h++;
      if (h > 0 && h <= 4 && line.charAt(h) === ' ') {
        var lvl = Math.min(h + 2, 6);
        out.push('<h'+lvl+' style="margin:.5rem 0 .25rem;font-size:'+(h===1?'1rem':'.9rem')+'">'+mdInline(line.slice(h+1))+'</h'+lvl+'>');
        i++; continue;
      }
      if (trimmed.indexOf('- ') === 0 || trimmed.indexOf('* ') === 0) {
        var items = [];
        while (i < lines.length && (lines[i].trim().indexOf('- ') === 0 || lines[i].trim().indexOf('* ') === 0)) {
          items.push('<li>'+mdInline(lines[i].trim().slice(2))+'</li>'); i++;
        }
        out.push('<ul style="padding-left:1.2rem;margin:.3rem 0">'+items.join('')+'</ul>'); continue;
      }
      var para = [];
      while (i < lines.length) {
        var pl = lines[i]; var pt = pl.trim();
        if (pt === '' || pt.indexOf(BT+BT+BT) === 0) break;
        var ph = 0; while (ph < pl.length && pl.charAt(ph) === '#') ph++;
        if (ph > 0 && ph <= 4 && pl.charAt(ph) === ' ') break;
        if (pt.indexOf('- ') === 0 || pt.indexOf('* ') === 0) break;
        para.push(mdInline(pl)); i++;
      }
      if (para.length) out.push('<p style="margin:.3rem 0">'+para.join('<br>')+'</p>');
    }
    return out.join('');
  }

  // ── Feature 1: Agent Memory Panel ───────────────────────────────
  var memPanel = document.getElementById('mem-panel');
  var memOverlay = document.getElementById('mem-overlay');
  var memBody = document.getElementById('mem-body');
  var memAddArea = document.getElementById('mem-add-area');
  var memSaveBtn = document.getElementById('mem-save-btn');
  var memClose = document.getElementById('mem-close');
  var memoriesCache = [];

  function openMemPanel() {
    if (memPanel) { memPanel.classList.add('open'); }
    if (memOverlay) { memOverlay.classList.add('show'); }
    loadMemories();
  }
  function closeMemPanel() {
    if (memPanel) memPanel.classList.remove('open');
    if (memOverlay) memOverlay.classList.remove('show');
  }
  if (btnMemory) btnMemory.addEventListener('click', openMemPanel);
  if (memClose) memClose.addEventListener('click', closeMemPanel);
  if (memOverlay) memOverlay.addEventListener('click', closeMemPanel);

  function loadMemories() {
    if (!memBody) return;
    fetch('/api/code/memory', { credentials: 'same-origin' })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(d) {
        memoriesCache = d ? (d.memories || []) : [];
        renderMemories();
      }).catch(function() { if (memBody) memBody.innerHTML = '<div class="mem-empty">Failed to load memories.</div>'; });
  }

  function renderMemories() {
    if (!memBody) return;
    if (!memoriesCache.length) { memBody.innerHTML = '<div class="mem-empty">No memories yet.<br><br>Save facts about the codebase that the agent should always know — conventions, gotchas, architectural patterns.</div>'; return; }
    var html = '';
    memoriesCache.forEach(function(m) {
      var ts = m.createdAt ? new Date(m.createdAt).toLocaleDateString() : '';
      html += '<div class="mem-item"><button class="mem-del" data-id="'+escapeHtml(m.id)+'">${icon('x', { size: 14 })}</button>' +
        '<div class="mem-content">'+escapeHtml(m.content)+'</div>' +
        '<div class="mem-meta">'+(ts?ts+' · ':'')+escapeHtml(m.sessionId||'')+'</div></div>';
    });
    memBody.innerHTML = html;
    memBody.querySelectorAll('.mem-del').forEach(function(btn) {
      btn.addEventListener('click', function() { deleteMemory(btn.getAttribute('data-id')); });
    });
  }

  function saveMemory(content, sourceSessionId) {
    if (!content || content.trim().length < 5) return;
    fetch('/api/code/memory', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.trim(), sessionId: sourceSessionId || sessionId }),
    }).then(function(r) { return r.ok ? r.json() : null; })
      .then(function() { loadMemories(); })
      .catch(function(e) { console.error('Memory save failed', e); });
  }

  function deleteMemory(id) {
    fetch('/api/code/memory/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'same-origin' })
      .then(function() { memoriesCache = memoriesCache.filter(function(m) { return m.id !== id; }); renderMemories(); })
      .catch(function() {});
  }

  if (memSaveBtn) {
    memSaveBtn.addEventListener('click', function() {
      var content = memAddArea ? memAddArea.value.trim() : '';
      if (!content) return;
      saveMemory(content, sessionId);
      if (memAddArea) memAddArea.value = '';
    });
  }
  if (memAddArea) {
    memAddArea.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { if (memSaveBtn) memSaveBtn.click(); }
    });
  }

  // ── Page Visibility API ─────────────────────────────────
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      // Tab hidden: mark that we may have missed messages
      window._wasHidden = true;
    } else {
      // Tab visible again: check for new messages
      if (window._wasHidden && ws && ws.readyState === WebSocket.OPEN) {
        fetch('/api/code/sessions/' + sessionId).then(function(r) { return r.json(); }).then(function(data) {
          if (data && data.session && data.session.messages) {
            var msgs = data.session.messages;
            if (msgs.length > messageCount) {
              var existingIds = new Set();
              messagesEl.querySelectorAll('.msg[data-msg-id]').forEach(function(el) {
                existingIds.add(el.getAttribute('data-msg-id'));
              });
              msgs.forEach(function(m) {
                var mid = m._id || (m.role + '_' + (m.timestamp || m.createdAt || Date.now()));
                if (!existingIds.has(mid)) {
                  renderSingleMessage(m, mid);
                }
              });
              messageCount = msgs.length;
              updateCtxBar(msgs);
              scrollToBottom();
            }
          }
        }).catch(function() {});
      }
      window._wasHidden = false;
    }
  });

  // ── Questions sidebar ───────────────────────────────────
  var qsSidebar = document.getElementById('qs-sidebar');
  var qsBody = document.getElementById('qs-body');
  var qsSearch = document.getElementById('qs-search');
  var qsCount = document.getElementById('qs-count');
  var qsClose = document.getElementById('qs-close');
  var codeContainer = document.getElementById('code-container');
  var questionsCache = [];

  function openQsSidebar() {
    if (qsSidebar) { qsSidebar.classList.add('open'); }
    if (codeContainer) { codeContainer.classList.add('qs-open'); }
    loadQuestions();
  }
  function closeQsSidebar() {
    if (qsSidebar) qsSidebar.classList.remove('open');
    if (codeContainer) codeContainer.classList.remove('qs-open');
  }
  if (btnHistory) btnHistory.addEventListener('click', function() {
    if (qsSidebar && qsSidebar.classList.contains('open')) {
      closeQsSidebar();
    } else {
      openQsSidebar();
    }
  });
  if (qsClose) qsClose.addEventListener('click', closeQsSidebar);

  function loadQuestions() {
    if (!qsBody) return;
    qsBody.innerHTML = '<div class="qs-empty">Loading questions…</div>';
    fetch('/api/code/questions').then(function(r) { return r.json(); }).then(function(data) {
      questionsCache = data.questions || [];
      renderQuestions();
    }).catch(function() {
      if (qsBody) qsBody.innerHTML = '<div class="qs-empty">Failed to load questions.</div>';
    });
  }

  function renderQuestions(filter) {
    if (!qsBody) return;
    var q = (filter || '').toLowerCase().trim();
    var items = questionsCache;
    if (q) {
      items = items.filter(function(item) {
        return (item.content || '').toLowerCase().indexOf(q) !== -1 ||
               (item.sessionTitle || '').toLowerCase().indexOf(q) !== -1;
      });
    }
    if (!items.length) {
      qsBody.innerHTML = '<div class="qs-empty">' + (q ? 'No matching questions.' : 'No questions yet.') + '</div>';
      if (qsCount) qsCount.textContent = '';
      return;
    }
    var html = '';
    items.forEach(function(item) {
      var ts = item.timestamp ? new Date(item.timestamp).toLocaleDateString() : '';
      var timeStr = item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
      var text = (item.content || '').slice(0, 120);
      if ((item.content || '').length > 120) text += '…';
      html += '<button class="qs-item" data-sid="' + escapeHtml(item.sessionId) + '" title="' + escapeHtml(item.content || '') + '">';
      html += escapeHtml(text);
      html += '<div class="qs-session">' + escapeHtml(item.sessionTitle || 'Untitled') + ' <span class="qs-time">' + escapeHtml(ts + ' ' + timeStr) + '</span></div>';
      html += '</button>';
    });
    qsBody.innerHTML = html;
    if (qsCount) qsCount.textContent = items.length + ' question' + (items.length !== 1 ? 's' : '');
    // Wire up click handlers
    qsBody.querySelectorAll('.qs-item').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var sid = btn.getAttribute('data-sid');
        if (sid) location.href = '/code/session/' + sid;
      });
    });
  }

  if (qsSearch) {
    qsSearch.addEventListener('input', function() {
      renderQuestions(qsSearch.value);
    });
  }

  function scrollToBottom(){if(_suppressScroll)return;messagesEl.scrollTop=messagesEl.scrollHeight;}
  function updateCtxBar(msgs){/* context bar updated via usage events */}
  // ── Helpers ─────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function safePrUrl(value) {
    try {
      var url = new URL(String(value), window.location.origin);
      return url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === window.location.origin) ? url.href : null;
    } catch (_) { return null; }
  }

  function formatToolArgs(tool, args) {
    if (!args) return '';
    if (tool === 'read_file' || tool === 'write_file' || tool === 'patch') return args.path || '';
    if (tool === 'read_files') return (args.paths || []).join(', ');
    if (tool === 'search_files' || tool === 'find_files') return args.pattern || args.glob || '';
    if (tool === 'terminal') return args.command || '';
    if (tool === 'git_commit') return (args.files || []).join(', ') + ' — ' + (args.message || '');
    if (tool === 'web_fetch') return args.url || '';
    return JSON.stringify(args).slice(0, 100);
  }

  // -- result rendering helpers --
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function toolIcon(tool) {
    var icons = {
      read_file: '${icon('file-text', { size: 15 })}', read_files: '${icon('file-text', { size: 15 })}', write_file: '${icon('file-text', { size: 15 })}', patch: '${icon('git-pull-request', { size: 15 })}',
      search_files: '${icon('search', { size: 15 })}', find_files: '${icon('folder', { size: 15 })}', terminal: '${icon('terminal', { size: 15 })}',
      git_status: '${icon('git-branch', { size: 15 })}', git_diff: '${icon('git-pull-request', { size: 15 })}', git_log: '${icon('clock', { size: 15 })}', git_commit: '${icon('check-circle', { size: 15 })}',
      list_directory: '${icon('folder', { size: 15 })}', tsc_check: '${icon('code', { size: 15 })}', git_branch: '${icon('git-branch', { size: 15 })}',
      web_fetch: '${icon('globe', { size: 15 })}', vision_analyze: '${icon('search', { size: 15 })}', use_skill: '${icon('zap', { size: 15 })}',
    };
    return icons[tool] || '${icon('settings', { size: 15 })}';
  }
  function resultText(result) {
    if (result == null) return '';
    if (typeof result === 'string') return result;
    if (typeof result.output === 'string') return result.output;
    if (typeof result.content === 'string') return result.content;
    if (typeof result.text === 'string') return result.text;
    if (typeof result.result === 'string') return result.result;
    return '';
  }
  function looksLikeDiff(s) {
    if (!s || typeof s !== 'string') return false;
    return /(^|\\n)diff --git /.test(s) || /(^|\\n)@@ .* @@/.test(s) || /(^|\\n)\\+\\+\\+ /.test(s);
  }
  function wrapText(s) { return '<div class="tb-text">' + escapeHtml(s) + '</div>'; }
  function padText(s) { return '<div class="tb-pad">' + escapeHtml(s) + '</div>'; }
  function renderListing(content, startLine) {
    var lines = String(content).split('\\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    var prenum = lines.length && /^\\d+\\|/.test(lines[0]);
    var rows = lines.map(function(l, i) {
      var num, code;
      var m = prenum ? l.match(/^(\\d+)\\|([\\s\\S]*)$/) : null;
      if (m) { num = m[1]; code = m[2]; }
      else { num = (startLine || 1) + i; code = l; }
      return '<div class="cl-row"><span class="cl-gutter">' + num + '</span><span class="cl-code">' + escapeHtml(code) + '</span></div>';
    }).join('');
    return '<div class="code-listing">' + rows + '</div>';
  }

  function toolResultMeta(tool, result) {
    if (!result || typeof result !== 'object') return '';
    if (typeof result.totalLines === 'number') return result.totalLines + ' lines';
    if (result.files && result.files.length) return result.files.length + ' file' + (result.files.length === 1 ? '' : 's');
    if (tool === 'search_files') { var n = (result.matches || result.lines || []).length; return n + ' match' + (n === 1 ? '' : 'es'); }
    if (tool === 'find_files') { var n2 = (result.files || []).length; return n2 + ' result' + (n2 === 1 ? '' : 's'); }
    if (tool === 'terminal' || tool === 'tsc_check') return result.exit_code !== undefined ? 'exit ' + result.exit_code : '';
    var d = result.diff || (looksLikeDiff(resultText(result)) ? resultText(result) : '');
    if (d) {
      var adds = (d.match(/^\\+(?!\\+\\+)/gm) || []).length;
      var dels = (d.match(/^-(?!--)/gm) || []).length;
      if (adds || dels) return '<span class="m-add">+' + adds + '</span> <span class="m-del">\\u2212' + dels + '</span>';
    }
    if (typeof result.bytes === 'number') return result.bytes + ' B';
    return '';
  }

  function formatToolResult(tool, result) {
    if (!result) return '';
    if (typeof result === 'string') return looksLikeDiff(result) ? formatDiff(result) : wrapText(result);
    if (result.error) return '<div class="tb-text" style="color:var(--red)">' + escapeHtml(String(result.error)) + '</div>';

    // Multi-file reads
    if (result.files && result.files.length && result.files[0] && (result.files[0].content !== undefined || result.files[0].error !== undefined)) {
      return result.files.map(function(f) {
        var head = '<div class="diff-file">${icon('file-text', { size: 13 })} ' + escapeHtml(f.path || '') + (f.size ? ' \\u00b7 ' + f.size + ' bytes' : '') + '</div>';
        if (f.error) return head + '<div class="tb-text" style="color:var(--red)">' + escapeHtml(f.error) + '</div>';
        return head + renderListing((f.content || '').slice(0, 6000), 1);
      }).join('');
    }
    // Single file content
    if ((tool === 'read_file' || tool === 'read_files') && typeof result.content === 'string') {
      return renderListing(result.content.slice(0, 12000), 1);
    }
    // File edits — prefer a diff, fall back to a confirmation line
    if (tool === 'write_file' || tool === 'patch') {
      var ed = result.diff || (looksLikeDiff(resultText(result)) ? resultText(result) : '');
      if (ed) return formatDiff(ed);
      if (result.ok) return '<div class="tb-text" style="color:var(--green)">${icon('check', { size: 13 })} ' + escapeHtml(result.path || 'file') + ' updated' + (result.bytes ? ' (' + result.bytes + ' bytes)' : '') + '</div>';
      return wrapText(resultText(result) || 'OK');
    }
    if (tool === 'search_files') return wrapText((result.matches || result.lines || []).join('\\n') || '(no matches)');
    if (tool === 'find_files') return wrapText((result.files || []).join('\\n') || '(no files)');
    if (tool === 'terminal' || tool === 'tsc_check') {
      var out = '';
      if (result.stdout) out += result.stdout;
      if (result.stderr) out += (out ? '\\n' : '') + result.stderr;
      if (!out && typeof result.output === 'string') out = result.output;
      var body = padText(out.slice(0, 8000) || '(no output)');
      if (result.exit_code !== undefined) {
        body += '<div class="tb-text" style="color:' + (result.exit_code === 0 ? 'var(--green)' : 'var(--red)') + '">exit code: ' + result.exit_code + '</div>';
      }
      return body;
    }
    if (tool === 'git_status') return wrapText(result.status || resultText(result) || '(clean)');
    if (tool === 'git_diff') return formatDiff(result.diff || resultText(result) || '');
    if (tool === 'git_log') return wrapText(result.log || resultText(result) || '');
    if (tool === 'git_commit') return wrapText(result.commit || resultText(result) || '');
    if (tool === 'web_fetch') return wrapText((result.content || result.text || '').slice(0, 6000));

    // Generic Hermes-wrapped output ({output:"..."} etc.)
    var txt = resultText(result);
    if (txt) return looksLikeDiff(txt) ? formatDiff(txt) : wrapText(txt.slice(0, 8000));

    // Last resort: pretty JSON without internal noise fields
    var clean = {};
    Object.keys(result).forEach(function(k) { if (k.charAt(0) !== '_') clean[k] = result[k]; });
    return padText(JSON.stringify(clean, null, 2).slice(0, 4000));
  }

  function formatDiff(diff) {
    if (!diff) return '';
    if (typeof diff !== 'string') diff = String(diff);
    var lines = diff.split('\\n');
    var rows = '';
    var oldLn = 0, newLn = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf('diff --git') === 0 || line.indexOf('index ') === 0 ||
          line.indexOf('new file') === 0 || line.indexOf('deleted file') === 0 ||
          line.indexOf('similarity ') === 0 || line.indexOf('rename ') === 0 ||
          line.indexOf('+++') === 0 || line.indexOf('---') === 0) {
        rows += '<div class="dl meta"><span class="dl-num"></span><span class="dl-mark"></span><span class="dl-text">' + escapeHtml(line) + '</span></div>';
        continue;
      }
      var hunk = line.match(/^@@ -(\\d+)(?:,\\d+)? \\+(\\d+)(?:,\\d+)? @@/);
      if (hunk) {
        oldLn = parseInt(hunk[1], 10);
        newLn = parseInt(hunk[2], 10);
        rows += '<div class="dl hunk"><span class="dl-num">\\u2026</span><span class="dl-mark"></span><span class="dl-text">' + escapeHtml(line) + '</span></div>';
        continue;
      }
      var c = line.charAt(0);
      if (c === '+') {
        rows += '<div class="dl add"><span class="dl-num">' + newLn + '</span><span class="dl-mark">+</span><span class="dl-text">' + escapeHtml(line.slice(1)) + '</span></div>';
        newLn++;
      } else if (c === '-') {
        rows += '<div class="dl del"><span class="dl-num">' + oldLn + '</span><span class="dl-mark">\\u2212</span><span class="dl-text">' + escapeHtml(line.slice(1)) + '</span></div>';
        oldLn++;
      } else {
        var t = c === ' ' ? line.slice(1) : line;
        rows += '<div class="dl ctx"><span class="dl-num">' + (newLn || '') + '</span><span class="dl-mark"></span><span class="dl-text">' + escapeHtml(t) + '</span></div>';
        if (oldLn) oldLn++;
        if (newLn) newLn++;
      }
    }
    return '<div class="diff-view">' + rows + '</div>';
  }

  // -- Mermaid label sanitizer --
  // The model frequently emits flowchart labels containing characters the parser
  // chokes on ({ } / | < > etc), e.g. B[POST /api/funds/{id}/subscribe]. Wrapping
  // such labels in double quotes is the canonical, always-safe fix, so we apply it
  // automatically instead of surfacing a parse error to the user.
  function mmWordChar(ch){return (ch>='a'&&ch<='z')||(ch>='A'&&ch<='Z')||(ch>='0'&&ch<='9')||ch==='_';}
  function mmQuoteLabel(inner){
    if(inner==null)return inner;
    var t=inner.trim();
    if(t.length>=2&&t.charAt(0)==='"'&&t.charAt(t.length-1)==='"')return inner;
    var special='{}()[]|<>/&#"';
    var bad=false;
    for(var c=0;c<inner.length;c++){if(special.indexOf(inner.charAt(c))!==-1){bad=true;break;}}
    if(!bad)return inner;
    return '"'+inner.replace(/"/g,'#quot;')+'"';
  }
  function mmSanitizeLine(line){
    var shapes=[['([','])'],['[[',']]'],['[(',')]'],['{{','}}'],['((','))'],['[',']'],['{','}'],['(',')']];
    var out='';var i=0;var n=line.length;
    while(i<n){
      var ch=line.charAt(i);
      if(ch==='|'){var cp=line.indexOf('|',i+1);if(cp>i){out+='|'+mmQuoteLabel(line.slice(i+1,cp))+'|';i=cp+1;continue;}}
      var handled=false;
      for(var s=0;s<shapes.length;s++){
        var op=shapes[s][0],cl=shapes[s][1];
        if(line.substr(i,op.length)===op){
          var prev=out.length?out.charAt(out.length-1):'';
          if(!mmWordChar(prev))continue;
          var close=line.indexOf(cl,i+op.length);
          if(close<0)continue;
          out+=op+mmQuoteLabel(line.slice(i+op.length,close))+cl;
          i=close+cl.length;handled=true;break;
        }
      }
      if(handled)continue;
      out+=ch;i++;
    }
    return out;
  }
  function sanitizeMermaid(src){
    if(!src)return src;
    var LF=String.fromCharCode(10);
    var lines=src.split(LF);
    var header='';
    for(var k=0;k<lines.length;k++){var ht=lines[k].trim();if(!ht||ht.indexOf('%%')===0)continue;header=ht.toLowerCase();break;}
    if(header.indexOf('graph')!==0&&header.indexOf('flowchart')!==0)return src;
    for(var li=0;li<lines.length;li++){
      var lt=lines[li].trim();
      if(!lt)continue;
      var low=lt.toLowerCase();
      if(low.indexOf('%%')===0||low.indexOf('style ')===0||low.indexOf('classdef')===0||low.indexOf('class ')===0||low.indexOf('click ')===0||low.indexOf('linkstyle')===0||low.indexOf('direction ')===0)continue;
      lines[li]=mmSanitizeLine(lines[li]);
    }
    return lines.join(LF);
  }

  // -- Mermaid render helper --
  window.renderMermaidIn = function(container) {
    var blocks = container.querySelectorAll('.mermaid');
    if (!blocks.length) return;
    if (typeof mermaid === 'undefined') { ensureMermaid(function() { renderMermaidIn(container); }); return; }
    blocks.forEach(function(block, i) {
      var code = block.getAttribute('data-mermaid-src');
      if (!code) return;
      code = sanitizeMermaid(code);
      var wrap = document.createElement('div');
      wrap.className = 'mermaid-wrap';
      wrap.setAttribute('data-src', code);
      block.parentNode.replaceChild(wrap, block);
      var mid = 'mmd-' + Date.now() + '-' + i;
      try {
        mermaid.render(mid, code).then(function(res) {
          wrap.innerHTML = res.svg;
        }).catch(function(err) {
          wrap.innerHTML = '<pre class="mermaid-err">Diagram render error: ' + escapeHtml(String(err)) + '\\n\\nSource:\\n' + escapeHtml(code) + '</pre>';
        });
      } catch(e) {
        wrap.innerHTML = '<pre class="mermaid-err">Diagram error: ' + escapeHtml(String(e)) + '\\n\\nSource:\\n' + escapeHtml(code) + '</pre>';
      }
    });
  };

  function renderMarkdown(text) {
    if (!text) return '';
    var BT = String.fromCharCode(96);
    var LF = String.fromCharCode(10);
    var FENCE = BT + BT + BT;
    var lines = text.split(LF);
    var out = [];
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      var trimmed = line.trim();
      if (trimmed.indexOf(FENCE) === 0 && (trimmed.slice(3).trim() === 'mermaid' || trimmed.slice(3).trim() === 'mmd')) {
        var code = []; i++;
        while (i < lines.length && lines[i].trim().indexOf(FENCE) !== 0) { code.push(lines[i]); i++; }
        if (i < lines.length) i++;
        out.push('<div class="mermaid" data-mermaid-src="' + escapeHtml(code.join(LF)).replace(/"/g, '&quot;') + '"></div>');
        continue;
      }
      if (trimmed.indexOf(FENCE) === 0) {
        var lang = trimmed.slice(3).trim();
        var code = []; i++;
        while (i < lines.length && lines[i].trim().indexOf(FENCE) !== 0) { code.push(lines[i]); i++; }
        if (i < lines.length) i++;
        out.push('<pre><code>' + escapeHtml(code.join(LF)) + '</code></pre>');
        continue;
      }
      if (trimmed === '') { i++; continue; }
      if (/^(graph|flowchart)\\s+(?:TD|LR|RL|TB|BT|TD|LBR|TBR)\\b/i.test(trimmed) ||
          /^(sequenceDiagram|classDiagram|stateDiagram|gantt|pie|erDiagram|mindmap|timeline|block-beta|gitgraph)\\b/i.test(trimmed)) {
        var mcode = [lines[i]]; i++;
        while (i < lines.length) {
          var ml = lines[i]; var mt = ml.trim();
          if (mt === '') { mcode.push(ml); i++; continue; }
          if (mt.indexOf(FENCE) === 0) break;
          if (/^[|]/.test(mt)) break;
          if (/^#{1,6}\\s/.test(mt)) break;
          if (/^\\s/.test(ml) || /[{}()\\[\\]|]|-->|---|\\.\\.|:::|style\\s|class\\s|link\\s|click\\s|subgraph|end\\s*$|note\\s|participant|actor|activate|deactivate|loop|alt|else|opt|rect|par|break|critical|assert|rel\\b/i.test(mt)) {
            mcode.push(ml); i++;
          } else if (/^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|gantt|pie|erDiagram|mindmap|timeline|block-beta|gitgraph)\\b/i.test(mt)) {
            break;
          } else {
            if (/[A-Za-z_]\\s*[\\[\\({<|]/.test(mt) || /-->|---|\\.\\.|==/.test(mt)) { mcode.push(ml); i++; }
            else break;
          }
        }
        while (mcode.length > 0 && mcode[mcode.length - 1].trim() === '') mcode.pop();
        if (mcode.length >= 2) {
          out.push('<div class="mermaid" data-mermaid-src="' + escapeHtml(mcode.join(LF)).replace(/"/g, '&quot;') + '"></div>');
          continue;
        }
        i = i - mcode.length;
      }
      if (trimmed.charAt(0) === '|' && trimmed.indexOf('|', 1) > 0) {
        var trows = [];
        while (i < lines.length) {
          var tr = lines[i].trim();
          if (tr.charAt(0) !== '|') break;
          if (/^[|\\s:\\-]+$/.test(tr) && tr.indexOf('-') >= 0) { i++; continue; }
          var cells = tr.split('|').slice(1, -1);
          trows.push(cells); i++;
        }
        if (trows.length > 0) {
          var thtml = '<table><thead><tr>' + trows[0].map(function(c) { return '<th>' + inlineMd(c.trim()) + '</th>'; }).join('') + '</tr></thead>';
          if (trows.length > 1) {
            thtml += '<tbody>';
            for (var ri = 1; ri < trows.length; ri++) {
              thtml += '<tr>' + trows[ri].map(function(c) { return '<td>' + inlineMd(c.trim()) + '</td>'; }).join('') + '</tr>';
            }
            thtml += '</tbody>';
          }
          thtml += '</table>';
          out.push(thtml);
        }
        continue;
      }
      var h = 0; while (h < line.length && line.charAt(h) === '#') h++;
      if (h > 0 && h <= 6 && line.charAt(h) === ' ') {
        out.push('<h3>' + inlineMd(line.slice(h + 1)) + '</h3>'); i++; continue;
      }
      if (trimmed.indexOf('- ') === 0 || trimmed.indexOf('* ') === 0) {
        var items = [];
        while (i < lines.length) {
          var lt = lines[i].trim();
          if (lt.indexOf('- ') !== 0 && lt.indexOf('* ') !== 0) break;
          items.push('<li>' + inlineMd(lt.slice(2)) + '</li>'); i++;
        }
        out.push('<ul>' + items.join('') + '</ul>'); continue;
      }
      if (/^\d+[.)]\s+/.test(trimmed)) {
        var ordered = [];
        while (i < lines.length) {
          var ol = lines[i].trim();
          var om = ol.match(/^\d+[.)]\s+(.*)$/);
          if (!om) break;
          ordered.push('<li>' + inlineMd(om[1]) + '</li>'); i++;
        }
        out.push('<ol>' + ordered.join('') + '</ol>'); continue;
      }
      var para = [];
      while (i < lines.length) {
        var pl = lines[i]; var pt = pl.trim();
        if (pt === '' || pt.indexOf(FENCE) === 0 || pt.charAt(0) === '|') break;
        var ph = 0; while (ph < pl.length && pl.charAt(ph) === '#') ph++;
        if (ph > 0 && ph <= 6 && pl.charAt(ph) === ' ') break;
        if (pt.indexOf('- ') === 0 || pt.indexOf('* ') === 0 || /^\d+[.)]\s+/.test(pt)) break;
        para.push(inlineMd(pl)); i++;
      }
      if (para.length) out.push('<p>' + para.join('<br>') + '</p>');
    }
    return out.join('');
  }

  function inlineMd(text) {
    if (!text) return '';
    var s = escapeHtml(text);
    s = s.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    var BT = String.fromCharCode(96);
    s = s.replace(new RegExp(BT + '([^' + BT + ']+)' + BT, 'g'), '<code>$1</code>');
    return s;
  }

  window.toggleToolPanel = function(header) {
    var body = header.nextElementSibling;
    var toggle = header.querySelector('.tool-toggle');
    if (body) body.classList.toggle('open');
    if (toggle) toggle.classList.toggle('open');
  };

  window.toggleToolGroup = function(head) {
    var body = head.nextElementSibling;
    var chev = head.querySelector('.tg-chevron');
    if (body) body.classList.toggle('open');
    if (chev) chev.classList.toggle('open');
  };

  window.toggleRaw = function(btn) {
    var pre = btn.nextElementSibling;
    if (!pre) return;
    var hidden = pre.style.display === 'none';
    pre.style.display = hidden ? 'block' : 'none';
    btn.textContent = hidden ? 'Hide raw output' : 'Show raw output';
  };

  setInterval(function() { if (!document.hidden) refreshDelivery(); }, 5000);
})();
</script>
${THEME_TOGGLE_JS}
</body>
</html>`;
};
