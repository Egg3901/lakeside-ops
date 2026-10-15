// ASK_PAGE — Codebase Q&A. Two-column AHD dark-glass design.
// Left nav (new question, suggested, recent, scope) + main panel whose thread
// renders structured Q&A turns: Q badge → Answer card (confidence) →
// Relevant-files source cards → follow-ups. Full SSE streaming retained.

const { icon, faviconFor, THEME_HEAD, themeToggle, THEME_TOGGLE_JS } = require('./ui-kit');

module.exports = function makeAskPage(FONT_LINKS, BASE_CSS, MODEL_NAME) {
  var model = MODEL_NAME || "kimi-for-coding";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>Codebase Q&A — Lakeside Ops</title>
${THEME_HEAD}
<link rel="icon" href="${faviconFor('message')}">
${FONT_LINKS}
<meta name="color-scheme" content="light dark">
<style>${BASE_CSS}
[data-theme="light"] body::before{background:radial-gradient(55rem 55rem at 8% -10%,rgba(91,108,240,.08),transparent 60%),radial-gradient(48rem 48rem at 100% -5%,rgba(139,92,246,.06),transparent 55%),radial-gradient(60rem 45rem at 50% 118%,rgba(8,145,178,.04),transparent 60%)}
.theme-switching,.theme-switching *,.theme-switching *::before,.theme-switching *::after{transition:none!important}

/* ── Layout ── */
html,body{height:100%;overflow:hidden}
body{position:fixed;inset:0;background:var(--bg-0);color:var(--text)}
*{-webkit-tap-highlight-color:transparent}
.ask-root{position:fixed;inset:0;display:grid;grid-template-columns:288px 1fr;grid-template-rows:100%;background:var(--bg-0);color:var(--text);overflow:hidden}
.ask-nav{grid-column:1;grid-row:1;border-right:1px solid var(--border);background:var(--surface)}
.ask-main{grid-column:2;grid-row:1}
.ask-panel{min-width:0;min-height:0;display:flex;flex-direction:column}

/* ── Left nav ── */
.ask-nav-head{display:flex;align-items:center;gap:10px;padding:var(--s-4) var(--s-4) var(--s-3);flex-shrink:0}
.ask-back{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:var(--r-sm);border:1px solid var(--border);background:var(--glass-2);color:var(--text-2);transition:all var(--t);flex-shrink:0}
.ask-back:hover{color:var(--text);border-color:var(--border-2);background:var(--glass-3)}
.ask-brand{display:flex;align-items:center;gap:10px}
.ask-brand .mark{width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:1.1rem;border-radius:var(--r-sm);background:linear-gradient(180deg,var(--glass-3),var(--glass-1));border:1px solid var(--border)}
.ask-brand .nm{font-weight:700;font-size:1.05rem;letter-spacing:-.02em}
.ask-brand .sub{font-size:.6875rem;color:var(--text-3)}
.ask-newq{margin:var(--s-1) var(--s-4) var(--s-2);display:flex;align-items:center;justify-content:center;gap:8px;padding:.6rem;border-radius:var(--r-md);border:1px solid transparent;background:var(--accent);color:var(--on-accent);font-weight:600;font-size:var(--fs-sm);cursor:pointer;box-shadow:var(--e1);transition:background var(--t),transform var(--t);font-family:var(--font)}
.ask-newq:hover{background:var(--accent-hover);transform:translateY(-1px)}
.ask-navscroll{flex:1;overflow-y:auto;scrollbar-width:thin;padding-bottom:12px}
.ask-seclabel{font-size:.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-3);padding:16px 16px 8px;display:flex;align-items:center;gap:7px}
.ask-seclabel svg{width:13px;height:13px}
.ask-conv{display:block;width:calc(100% - 16px);margin:1px 8px;padding:8px 10px;border:1px solid transparent;border-radius:var(--r-sm);background:transparent;cursor:pointer;text-align:left;transition:background var(--t),border-color var(--t);font-family:var(--font)}
.ask-conv:hover{background:var(--glass-2)}
.ask-conv.active{background:var(--glass-2);border-color:color-mix(in srgb,var(--accent) 30%,var(--border))}
.ask-conv .q{font-size:.8125rem;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ask-conv .m{font-size:.6875rem;color:var(--text-3);font-family:var(--mono);margin-top:3px;display:flex;gap:7px}
.ask-sugg{display:flex;align-items:flex-start;gap:9px;width:calc(100% - 16px);margin:3px 8px;padding:9px 11px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--glass-1);color:var(--text-2);font-size:.8125rem;cursor:pointer;text-align:left;transition:all var(--t);line-height:1.4;font-family:var(--font)}
.ask-sugg:hover{background:var(--glass-2);border-color:var(--border-2);color:var(--text)}
.ask-sugg svg{width:14px;height:14px;color:var(--accent);flex-shrink:0;margin-top:1px}
.ask-recent{display:flex;align-items:center;gap:9px;width:calc(100% - 16px);margin:0 8px;padding:6px 10px;border-radius:var(--r-sm);color:var(--text-3);font-size:.8125rem;cursor:pointer;transition:all var(--t);font-family:var(--font);background:transparent;border:none;text-align:left}
.ask-recent:hover{background:var(--glass-2);color:var(--text-2)}
.ask-recent svg{width:13px;height:13px;flex-shrink:0}
.ask-recent .t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ask-scope{border-top:1px solid var(--border);padding:12px 16px;flex-shrink:0}
.ask-scope-row{display:flex;align-items:center;gap:9px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--glass-1);font-size:.8125rem}
.ask-scope-row svg{width:15px;height:15px;color:var(--text-3);flex-shrink:0}
.ask-scope-row .col{display:flex;flex-direction:column;min-width:0}
.ask-scope-row .k{font-size:.6875rem;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em}
.ask-scope-row .v{font-size:.8125rem;color:var(--text);font-family:var(--mono)}
.ask-scope-note{font-size:.6875rem;color:var(--text-3);margin-top:8px;display:flex;align-items:center;gap:6px;line-height:1.5}
.ask-scope-note svg{width:12px;height:12px;flex-shrink:0;color:var(--green)}

/* ── Header ── */
.ask-top{display:flex;align-items:center;gap:12px;padding:13px 22px;border-bottom:1px solid var(--border);flex-shrink:0}
.ask-top .mob{display:inline-flex}
/* Recents rail collapsed by default — the persistent ops sidebar is primary
   nav; the rail opens as a secondary panel via the header menu button. */
@media(min-width:901px){.ask-root.nav-collapsed{grid-template-columns:0 1fr}.ask-root.nav-collapsed .ask-nav{display:none}}
.ask-top h1{font-size:1.05rem;font-weight:600;letter-spacing:-.01em;display:flex;align-items:center;gap:10px}
.ask-ro{display:inline-flex;align-items:center;gap:5px;font-size:.6875rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--green);background:var(--green-soft);border:1px solid color-mix(in srgb,var(--green) 28%,transparent);padding:.2em .55em;border-radius:var(--r-full)}
.ask-ro svg{width:11px;height:11px}
.ask-top-actions{margin-left:auto;display:flex;align-items:center;gap:8px}
.ask-modeltag{font-family:var(--mono);font-size:.7rem;color:var(--text-3)}
.ask-depth{display:inline-flex;align-items:center;gap:2px;background:var(--glass-2);border:1px solid var(--border);border-radius:var(--r-sm);padding:2px}
.ask-depth button{font-size:.6875rem;font-family:var(--font);background:transparent;border:none;color:var(--text-3);padding:.3em .65em;border-radius:var(--r-xs);cursor:pointer;transition:all var(--t);display:inline-flex;align-items:center;gap:4px}
.ask-depth button svg{width:12px;height:12px}
.ask-depth button.active{background:var(--accent);color:#fff;font-weight:600}
.askico{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border:1px solid transparent;border-radius:var(--r-sm);background:transparent;color:var(--text-2);cursor:pointer;transition:all var(--t)}
.askico:hover{background:var(--glass-2);color:var(--text)}
.askico svg{width:17px;height:17px}

/* ── Thread / turns ── */
.ask-thread{flex:1;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;-webkit-overflow-scrolling:touch}
.ask-col{max-width:740px;margin:0 auto;padding:26px 24px 40px;display:flex;flex-direction:column;gap:30px}
.ask-turn{display:flex;flex-direction:column;gap:16px;animation:rise .34s var(--ease) both}
.ask-q{display:flex;gap:12px;align-items:flex-start}
.ask-q .qmark{width:26px;height:26px;border-radius:var(--r-sm);background:var(--glass-3);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--text-2);font-weight:700;font-size:.8125rem}
.ask-q .qt{font-size:1.15rem;font-weight:600;letter-spacing:-.015em;line-height:1.4;color:var(--text);word-break:break-word}

/* answer card */
.ask-answer{border:none;border-radius:0;background:transparent;overflow:visible}
.ask-ans-head{display:flex;align-items:center;gap:9px;padding:0 0 10px;border-bottom:none}
.ask-ans-head .av{width:22px;height:22px;border-radius:var(--r-xs);background:linear-gradient(135deg,var(--accent),var(--accent-2));display:flex;align-items:center;justify-content:center;flex-shrink:0}
.ask-ans-head .av svg{width:13px;height:13px;color:#fff}
.ask-ans-head .lbl{font-size:.8125rem;font-weight:600;color:var(--text-2)}
.ask-conf{margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-size:.6875rem;font-weight:600;padding:.25em .6em;border-radius:var(--r-full)}
.ask-conf svg{width:12px;height:12px}
.ask-conf.high{color:var(--green);background:var(--green-soft);border:1px solid color-mix(in srgb,var(--green) 26%,transparent)}
.ask-conf.med{color:var(--amber);background:var(--amber-soft);border:1px solid color-mix(in srgb,var(--amber) 26%,transparent)}
.ask-conf.low{color:var(--text-3);background:var(--glass-2);border:1px solid var(--border)}
.ask-ans-body{padding:0}
.ask-direct{font-size:1.02rem;line-height:1.7;color:var(--text)}
.ask-direct strong{font-weight:700}
.ask-direct p{margin:.4rem 0}
.ask-direct p:first-child{margin-top:0}
.ask-direct p:last-child{margin-bottom:0}
.ask-direct h3{font-size:1rem;font-weight:700;margin:.7rem 0 .3rem;letter-spacing:-.01em}
.ask-direct h3:first-child{margin-top:0}
.ask-direct h4,.ask-direct h5{font-size:.9rem;font-weight:600;margin:.5rem 0 .25rem}
.ask-direct ul,.ask-direct ol{padding-left:1.4rem;margin:.4rem 0}
.ask-direct li{margin:.2rem 0}
.ask-direct code{background:var(--glass-2);padding:.14em .4em;border-radius:5px;font-family:var(--mono);font-size:.84em}
.ask-direct blockquote{border-left:2px solid var(--accent);padding:.25rem .7rem;margin:.45rem 0;color:var(--text-2);background:var(--accent-soft);border-radius:0 var(--r-xs) var(--r-xs) 0}
.ask-direct hr{border:none;border-top:1px solid var(--border);margin:.65rem 0}
.ask-direct a{color:var(--accent);text-decoration:underline;text-underline-offset:2px}
.ask-direct .codeblock{margin:.6rem 0;border:1px solid var(--border);border-radius:var(--r-sm);overflow:hidden;background:var(--bg-1)}
.cb-head{display:flex;align-items:center;justify-content:space-between;padding:.32rem .6rem;background:var(--glass-2);border-bottom:1px solid var(--border)}
.cb-lang{font-family:var(--mono);font-size:.64rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3)}
.cb-copy{display:inline-flex;align-items:center;gap:.35em;background:transparent;border:none;color:var(--text-3);font-size:.66rem;cursor:pointer;font-family:var(--font);transition:color var(--t);padding:.12em .35em;border-radius:var(--r-xs)}
.cb-copy:hover{color:var(--text)}
.cb-copy.copied{color:var(--green)}
.ask-direct .codeblock pre{margin:0;border:none;border-radius:0;background:none;padding:.7rem;overflow-x:auto;font-size:.82rem;line-height:1.55}
.ask-direct .codeblock pre code{background:none;padding:0}
.ask-direct table{border-collapse:collapse;width:100%;margin:.5rem 0;font-size:.82rem}
.ask-direct th{background:var(--glass-2);color:var(--text-2);font-weight:600;text-align:left;padding:.4rem .6rem;border:1px solid var(--border);font-family:var(--mono);font-size:.72rem;text-transform:uppercase;letter-spacing:.04em}
.ask-direct td{padding:.35rem .6rem;border:1px solid var(--border)}

/* inline citation */
.cite{display:inline-flex;align-items:center;gap:3px;font-family:var(--mono);font-size:.82em;color:var(--accent);background:var(--accent-soft);border:1px solid color-mix(in srgb,var(--accent) 22%,transparent);padding:0 .35em;border-radius:5px;cursor:pointer;white-space:nowrap;transition:background var(--t)}
.cite:hover{background:color-mix(in srgb,var(--accent) 20%,transparent)}
.cite svg{width:10px;height:10px}

/* section (relevant files) */
.ask-section{margin-top:18px;border-top:1px solid var(--border);padding-top:14px}
.ask-sec-h{display:flex;align-items:center;gap:8px;font-size:.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3);margin-bottom:10px;cursor:pointer;user-select:none}
.ask-sec-h svg.lead{width:13px;height:13px;color:var(--text-3)}
.ask-sec-h .chev{margin-left:auto;width:14px;height:14px;transition:transform var(--t)}
.ask-section.collapsed .chev{transform:rotate(-90deg)}
.ask-section.collapsed .ask-sec-body{display:none}
.ask-sources{display:flex;flex-direction:column;gap:9px}
.ask-src{border:1px solid var(--border);border-radius:var(--r-md);background:var(--glass-1);overflow:hidden;transition:border-color var(--t)}
.ask-src:hover{border-color:var(--border-2)}
.ask-src-head{display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer}
.ask-src-ic{width:26px;height:26px;border-radius:var(--r-xs);background:var(--glass-2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--text-2)}
.ask-src-ic svg{width:14px;height:14px}
.ask-src-meta{flex:1;min-width:0}
.ask-src-path{font-family:var(--mono);font-size:.8125rem;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ask-src-path b{color:var(--text);font-weight:600}
.ask-src-rel{display:inline-flex;align-items:flex-end;gap:2px;height:12px;flex-shrink:0}
.ask-src-rel i{width:3px;background:var(--accent);border-radius:1px;display:block}
.ask-src-chev{width:15px;height:15px;color:var(--text-3);transition:transform var(--t);flex-shrink:0}
.ask-src.open .ask-src-chev{transform:rotate(180deg)}
.ask-src-code{border-top:1px solid var(--border);background:var(--bg-1);max-height:280px;overflow:auto}
.ask-src:not(.open) .ask-src-code{display:none}
.ask-codeline{display:flex;font-family:var(--mono);font-size:.76rem;line-height:1.6}
.ask-codeline .n{min-width:3.2em;padding:0 .7em 0 .5em;text-align:right;color:var(--text-3);border-right:1px solid var(--border);user-select:none;flex-shrink:0}
.ask-codeline .c{padding:0 .9em;white-space:pre;color:var(--text-2)}
.ask-codeline.hl{background:color-mix(in srgb,var(--accent) 11%,transparent)}
.ask-codeline.hl .n{color:var(--accent);font-weight:700}
.ask-src-open{padding:8px 12px;border-top:1px solid var(--border)}
.ask-src-open button{display:inline-flex;align-items:center;gap:6px;background:transparent;border:none;color:var(--accent);font-size:.6875rem;cursor:pointer;font-family:var(--font);padding:5px 8px;border-radius:var(--r-xs)}
.ask-src-open button:hover{background:var(--glass-2)}

/* follow-ups */
.ask-follow{display:flex;flex-wrap:wrap;gap:8px}
.ask-follow .fchip{display:inline-flex;align-items:center;gap:7px;padding:.45rem .8rem;border-radius:var(--r-full);border:1px solid color-mix(in srgb,var(--accent) 24%,transparent);background:var(--accent-soft);color:var(--accent);font-size:.8125rem;cursor:pointer;transition:all var(--t);font-family:var(--font)}
.ask-follow .fchip:hover{background:color-mix(in srgb,var(--accent) 18%,transparent);transform:translateY(-1px)}
.ask-follow .fchip svg{width:13px;height:13px}

/* caveat */
.ask-caveat{display:flex;align-items:flex-start;gap:10px;margin-top:16px;padding:11px 13px;border-radius:var(--r-md);border:1px solid color-mix(in srgb,var(--amber) 24%,var(--border));background:var(--amber-soft);font-size:.8125rem;line-height:1.55;color:var(--text-2)}
.ask-caveat svg{width:15px;height:15px;color:var(--amber);flex-shrink:0;margin-top:1px}
.ask-err{color:var(--red)}

/* thinking */
.ask-thinking{display:flex;align-items:center;gap:11px;color:var(--text-3);font-size:.8125rem}
.ask-dots{display:inline-flex;gap:5px}
.ask-dots span{width:7px;height:7px;border-radius:50%;background:linear-gradient(180deg,var(--accent),var(--accent-2));animation:askbounce 1.3s var(--ease) infinite}
.ask-dots span:nth-child(2){animation-delay:.16s}.ask-dots span:nth-child(3){animation-delay:.32s}
@keyframes askbounce{0%,65%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-6px);opacity:1}}
.stream-cursor{display:inline-block;width:7px;height:1.05em;border-radius:2px;background:linear-gradient(180deg,var(--accent),var(--accent-2));margin-left:3px;vertical-align:text-bottom;animation:cursorBlink 1s steps(2,start) infinite}
@keyframes cursorBlink{0%{opacity:1}50%{opacity:.25}}
.reading-line{font-family:var(--mono);font-size:.72rem;color:var(--text-3);margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* usage + feedback */
.ask-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding-top:4px}
.usage-info{display:flex;align-items:center;gap:.5em;font-size:.66rem;color:var(--text-3);font-family:var(--mono)}
.usage-info .u-q{text-transform:uppercase;letter-spacing:.05em;background:var(--glass-2);border:1px solid var(--border);border-radius:var(--r-full);padding:.08em .55em}
.usage-info .u-sem{color:var(--amber);background:var(--amber-soft);border:1px solid color-mix(in srgb,var(--amber) 25%,transparent);border-radius:var(--r-full);padding:.08em .55em}
.fb-bar{display:flex;align-items:center;gap:6px;margin-left:auto}
.fb-q{font-size:.7rem;color:var(--text-3)}
.fb-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:24px;background:var(--glass-2);border:1px solid var(--border);border-radius:var(--r-xs);color:var(--text-3);cursor:pointer;transition:all var(--t)}
.fb-btn:hover{color:var(--text);border-color:var(--border-2)}
.fb-btn.fb-up.chosen{color:var(--green);border-color:color-mix(in srgb,var(--green) 45%,transparent)}
.fb-btn.fb-down.chosen{color:var(--red);border-color:color-mix(in srgb,var(--red) 45%,transparent)}
.fb-btn.fb-share.chosen{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 45%,transparent)}
.fb-btn svg{width:14px;height:14px}

/* welcome */
.ask-welcome{max-width:640px;margin:0 auto;padding:8vh 24px 40px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:14px}
.ask-welcome .wic{width:56px;height:56px;border-radius:var(--r-lg);background:linear-gradient(135deg,var(--accent-soft),transparent);border:1px solid color-mix(in srgb,var(--accent) 24%,var(--border));display:flex;align-items:center;justify-content:center;color:var(--accent)}
.ask-welcome .wic svg{width:26px;height:26px}
.ask-welcome h2{font-size:1.5rem;font-weight:700;letter-spacing:-.02em}
.ask-welcome p{font-size:.9375rem;color:var(--text-3);line-height:1.6;max-width:460px}
.ask-welcome .wgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;width:100%;margin-top:10px}
.ask-wcard{display:flex;align-items:flex-start;gap:10px;padding:13px 14px;border:1px solid var(--border);border-radius:var(--r-md);background:var(--glass-1);cursor:pointer;text-align:left;transition:all var(--t);font-family:var(--font)}
.ask-wcard:hover{background:var(--glass-2);border-color:var(--border-2);transform:translateY(-2px);box-shadow:var(--shadow-sm)}
.ask-wcard svg{width:16px;height:16px;color:var(--accent);flex-shrink:0;margin-top:1px}
.ask-wcard .wt{font-size:.8125rem;color:var(--text);line-height:1.45}

/* composer */
.ask-composer{flex-shrink:0;padding:12px 24px 18px;padding-bottom:max(18px,env(safe-area-inset-bottom));border-top:1px solid var(--border)}
.ask-comp-inner{max-width:740px;margin:0 auto}
.pin-bar{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.pin-bar-label{font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text-3)}
.pin-chip{display:inline-flex;align-items:center;gap:.3em;font-size:.72rem;font-family:var(--mono);background:var(--accent-soft);border:1px solid color-mix(in srgb,var(--accent) 28%,transparent);color:var(--accent);padding:.2em .2em .2em .55em;border-radius:var(--r-full)}
.pin-x{background:transparent;border:none;color:var(--accent);cursor:pointer;font-size:1rem;line-height:1;padding:0 .25em}
.ask-comp-box{display:flex;align-items:flex-end;gap:8px;padding:6px 6px 6px 16px;border:1px solid var(--border);border-radius:var(--r-xl);background:color-mix(in srgb,var(--bg-0) 55%,transparent);transition:border-color var(--t),box-shadow var(--t)}
.ask-comp-box:focus-within{border-color:color-mix(in srgb,var(--accent) 50%,transparent);box-shadow:0 2px 16px -5px color-mix(in srgb,var(--accent) 38%,transparent)}
.ask-comp-box textarea{flex:1;padding:9px 0;background:transparent;border:none;color:var(--text);font-family:var(--font);font-size:16px;resize:none;outline:none;min-height:24px;max-height:160px;line-height:1.5}
.ask-comp-box textarea::placeholder{color:var(--text-3)}
.ask-send{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;border:none;background:var(--accent);color:var(--on-accent);cursor:pointer;box-shadow:var(--e1);transition:filter var(--t),transform var(--t);flex-shrink:0}
.ask-send:hover{filter:brightness(1.08);transform:scale(1.05)}
.ask-send:disabled{opacity:.4;cursor:not-allowed;box-shadow:none;filter:none;transform:none}
.ask-send svg{width:19px;height:19px}
.ask-send.is-stop{background:var(--red);box-shadow:none}
.stop-ico{width:12px;height:12px;border-radius:3px;background:currentColor;animation:cursorBlink 1.4s var(--ease) infinite}
.ask-comp-hint{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:9px;font-size:.6875rem;color:var(--text-3)}
.ask-comp-hint svg{width:12px;height:12px}
.ask-comp-hint kbd{background:var(--glass-2);border:1px solid var(--border);border-radius:4px;padding:.1em .4em;font-family:var(--mono);font-size:.62rem}
#error-area{color:var(--red);font-size:.8rem;margin-top:.3rem;text-align:center}

/* file peek */
.ask-peek{position:fixed;right:0;top:0;bottom:0;width:min(560px,92vw);background:var(--bg-1);border-left:1px solid var(--border);z-index:60;display:flex;flex-direction:column;transform:translateX(102%);transition:transform .26s var(--ease);box-shadow:var(--shadow-lg)}
.ask-peek.open{transform:none}
.ask-peek-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border);flex-shrink:0}
.ask-peek-head .p{flex:1;min-width:0;font-family:var(--mono);font-size:.8125rem;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ask-peek-body{flex:1;overflow:auto;scrollbar-width:thin}
.ask-scrim{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:55;opacity:0;pointer-events:none;transition:opacity .26s var(--ease)}
.ask-scrim.show{opacity:1;pointer-events:auto}

/* mermaid */
.mermaid-wrap{margin:.8rem 0;padding:1rem;background:var(--glass-2);border:1px solid var(--border);border-radius:var(--r-md);overflow-x:auto;text-align:center}
.mermaid-wrap svg{max-width:100%;height:auto}
.mermaid-err{color:var(--red);font-size:.75rem;font-family:var(--mono);padding:.5rem;text-align:left;white-space:pre-wrap}

/* responsive */
.ask-nav-backdrop{display:none}
@media(max-width:900px){
  .ask-root{grid-template-columns:0 1fr}
  .ask-nav{position:fixed;left:0;top:0;bottom:0;width:288px;z-index:50;box-shadow:var(--shadow-lg);display:none}
  .ask-root.nav-open .ask-nav{display:flex;flex-direction:column}
  .ask-root.nav-open .ask-nav-backdrop{display:block;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:45}
  .ask-top .mob{display:inline-flex}
  .ask-welcome .wgrid{grid-template-columns:1fr}
  .ask-col{padding:18px 16px 32px;gap:24px}
  .ask-top{padding:11px 14px}
  .ask-composer{padding:10px 14px;padding-bottom:max(12px,env(safe-area-inset-bottom))}
  .ask-q .qt{font-size:1.05rem}
  .ask-comp-hint{display:none}
  .askico{width:44px;height:44px}
}
@media(max-width:600px){.ask-peek{width:100vw}}
</style>
<script>
window.askMermaidCfg=function(){var l=document.documentElement.getAttribute('data-theme')==='light';return{startOnLoad:false,securityLevel:'loose',theme:l?'default':'dark',themeVariables:{fontFamily:"'Inter',system-ui,sans-serif",fontSize:'14px',primaryColor:l?'rgba(91,108,240,.08)':'rgba(124,140,255,.14)',primaryBorderColor:l?'#5b6cf0':'#7c8cff',primaryTextColor:l?'#14162b':'#f3f4f8',lineColor:l?'rgba(20,22,43,.46)':'rgba(243,244,248,.42)',textColor:l?'#14162b':'#f3f4f8',mainBkg:l?'rgba(91,108,240,.08)':'rgba(124,140,255,.12)',nodeBorder:l?'#5b6cf0':'#7c8cff',edgeLabelBackground:l?'#f7f8fb':'#0c0c13'}};};
window.initAskMermaid=function(){try{if(typeof mermaid!=='undefined')mermaid.initialize(window.askMermaidCfg());}catch(e){}};
/* Lazy-load the multi-MB mermaid bundle only when an answer actually has a diagram. */
window._askMermaidLoading=false;window._askMermaidCbs=[];
window.ensureAskMermaid=function(cb){if(typeof mermaid!=='undefined'){if(cb)cb();return;}if(cb)window._askMermaidCbs.push(cb);if(window._askMermaidLoading)return;window._askMermaidLoading=true;var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';s.onload=function(){window.initAskMermaid();var cbs=window._askMermaidCbs;window._askMermaidCbs=[];cbs.forEach(function(f){try{f();}catch(e){}});};s.onerror=function(){window._askMermaidLoading=false;};document.head.appendChild(s);};
</script>
</head>
<body>
${themeToggle('fixed')}
<div class="ask-root nav-collapsed" id="ask-root">
  <div class="ask-nav-backdrop" id="nav-backdrop"></div>
  <!-- Left nav -->
  <nav class="ask-panel ask-nav">
    <div class="ask-nav-head">
      <a class="ask-back" href="/" title="Back to Ops" aria-label="Back to Ops">${icon('arrow-left', { size: 16 })}</a>
      <a class="ask-back" href="/status" title="System status" aria-label="System status">${icon('activity', { size: 16 })}</a>
      <div class="ask-brand"><span class="mark">${icon('landmark', { size: 18 })}</span><div><div class="nm">Codebase Q&amp;A</div><div class="sub">A House Divided</div></div></div>
    </div>
    <button class="ask-newq" id="btn-new-q" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M12 5v14"/><path d="M5 12h14"/></svg> New question</button>
    <div class="ask-navscroll">
      <div class="ask-seclabel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> Suggested</div>
      <div id="nav-suggested"></div>
      <div class="ask-seclabel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg> Recent searches</div>
      <div id="nav-recents"><div style="padding:6px 16px;font-size:.75rem;color:var(--text-3)">Loading…</div></div>
    </div>
    <div class="ask-scope">
      <div class="ask-scope-row">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
        <div class="col"><span class="k">Codebase scope</span><span class="v">ahd game source</span></div>
      </div>
      <div class="ask-scope-note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Read-only — reads source but cannot modify anything.</div>
    </div>
  </nav>

  <!-- Main -->
  <main class="ask-panel ask-main">
    <div class="ask-top">
      <button class="askico mob" id="btn-mob-nav" title="Menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>
      <h1>Codebase Q&amp;A <span class="ask-ro"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Read-only</span></h1>
      <div class="ask-top-actions">
        <span class="ask-modeltag">${model}</span>
        <div class="ask-depth" id="quality-toggle" title="Answer depth">
          <button data-q="auto" class="active" title="Size the answer to the question">Auto</button>
          <button data-q="fast"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Fast</button>
          <button data-q="standard">Standard</button>
          <button data-q="reasoning"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 1 7 7c0 2.4-1.2 4.5-3 5.7V17a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-2.3C6.2 13.5 5 11.4 5 9a7 7 0 0 1 7-7z"/><path d="M9 21h6"/></svg> Deep</button>
        </div>
      </div>
    </div>

    <div class="ask-thread" id="thread">
      <div class="ask-col" id="col">
        <div class="ask-welcome" id="welcome">
          <span class="wic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></span>
          <h2>Ask about the AHD codebase</h2>
          <p>Query an assistant with read-only access to the game source. It explains formulas, traces logic, and cites the exact files behind every answer.</p>
          <div class="wgrid" id="welcome-grid"></div>
        </div>
      </div>
    </div>

    <div class="ask-composer">
      <div class="ask-comp-inner">
        <div class="pin-bar" id="pin-bar" style="display:none"></div>
        <div class="ask-comp-box">
          <textarea id="question" placeholder="Ask about the codebase…  (e.g. how is the GDP growth rate calculated?)" rows="1" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();if(!isSubmitting)submitQuestion();}"></textarea>
          <button class="ask-send" id="submit-btn" onclick="handleAction()" aria-label="Ask"><svg id="send-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg></button>
        </div>
        <div id="error-area"></div>
        <div class="ask-comp-hint"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Read-only · answers cite files · <kbd>Enter</kbd> to send</div>
      </div>
    </div>
  </main>
</div>

<!-- File peek -->
<div class="ask-scrim" id="peek-scrim"></div>
<div class="ask-peek" id="peek" role="dialog" aria-modal="true">
  <div class="ask-peek-head">
    <span class="ask-src-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg></span>
    <span class="p" id="peek-path"></span>
    <button class="askico" id="peek-close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
  </div>
  <div class="ask-peek-body" id="peek-body"></div>
</div>

<script>
var threadEl=document.getElementById('thread');
var colEl=document.getElementById('col');
var questionEl=document.getElementById('question');
var submitBtn=document.getElementById('submit-btn');
var errorArea=document.getElementById('error-area');
var welcomeEl=document.getElementById('welcome');
var currentQuality='auto';

// icons
var IC_SPARK='<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.5c.3 4.7 4.3 8.7 9 9c-4.7.3-8.7 4.3-9 9c-.3-4.7-4.3-8.7-9-9c4.7-.3 8.7-4.3 9-9z"/></svg>';
var IC_FILE='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
var IC_CHEV='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
var IC_ARROW='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 10l-4 4-2-2"/><path d="M9 18l6-6-6-6"/></svg>';
var IC_EYE='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
var IC_UP='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>';
var IC_DOWN='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>';
var IC_SHARE='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98"/><path d="m15.41 6.51-6.82 3.98"/></svg>';
var IC_CHECKS='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/></svg>';
var IC_INFO='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';

// ── Theme ── (toggle handled by shared ui-kit; re-theme mermaid on change)
(function(){new MutationObserver(function(){if(typeof applyMermaidTheme==='function')applyMermaidTheme();}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});})();

// ── Quality ──
document.querySelectorAll('#quality-toggle button').forEach(function(b){b.addEventListener('click',function(){document.querySelectorAll('#quality-toggle button').forEach(function(x){x.classList.remove('active');});b.classList.add('active');currentQuality=b.getAttribute('data-q');});});

// ── Mobile nav ──
(function(){var root=document.getElementById('ask-root'),bd=document.getElementById('nav-backdrop'),mb=document.getElementById('btn-mob-nav');
  if(mb)mb.addEventListener('click',function(){if(window.innerWidth>900){root.classList.toggle('nav-collapsed');}else{root.classList.add('nav-open');}});
  if(bd)bd.addEventListener('click',function(){root.classList.remove('nav-open');});
})();

// ── New question ──
document.getElementById('btn-new-q').addEventListener('click',function(){
  colEl.innerHTML='';colEl.appendChild(welcomeEl);welcomeEl.style.display='flex';
  conversation=[];questionEl.value='';questionEl.style.height='auto';questionEl.focus();
  document.getElementById('ask-root').classList.remove('nav-open');
});

questionEl.addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,160)+'px';});
fetch('/api/me').then(function(r){if(!r.ok)location.href='/';}).catch(function(){});

function escapeHtml(t){var d=document.createElement('div');d.textContent=t;return d.innerHTML;}
function scrollDown(){threadEl.scrollTop=threadEl.scrollHeight;}

// ── Conversation context ──
var conversation=[];
function historyParam(){if(!conversation.length)return'';return '&history='+encodeURIComponent(JSON.stringify(conversation.slice(-3)));}
var pinnedFiles=[];
function pinsParam(){if(!pinnedFiles.length)return'';return '&pins='+encodeURIComponent(JSON.stringify(pinnedFiles.slice(0,5)));}

// ── Follow-up marker parsing ──
// The answer ends with a hidden marker: <!--FU:["q1","q2","q3"]-->
// Extract the questions and strip the marker (and any partial during streaming).
function extractFollowups(text){
  if(!text)return{text:text,fu:[]};
  var m=text.match(/<!--\\s*FU:\\s*(\\[[\\s\\S]*?\\])\\s*-->/);
  var fu=[];
  if(m){try{var arr=JSON.parse(m[1]);if(Array.isArray(arr))fu=arr.filter(function(x){return typeof x==='string'&&x.trim();}).slice(0,3);}catch(e){}text=text.replace(m[0],'');}
  return{text:text,fu:fu};
}
// Hide a partial/complete marker while streaming so it never flashes on screen.
function stripPartialMarker(text){if(!text)return text;var i=text.indexOf('<!--');if(i>=0&&/^<!--\\s*F?U?:?/.test(text.slice(i)))return text.slice(0,i);return text.replace(/<!--\\s*FU:[\\s\\S]*?(-->|$)/,'');}

// ── Markdown ──
function mdInline(s){s=escapeHtml(s);var BT=String.fromCharCode(96),BS=String.fromCharCode(92),STAR=BS+'*';
  s=s.replace(new RegExp(BT+'([^'+BT+']+)'+BT,'g'),'<code>$1</code>');
  s=s.replace(new RegExp(STAR+STAR+'([^*]+)'+STAR+STAR,'g'),'<strong>$1</strong>');
  s=s.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;}
function orderedRest(s){var j=0;while(j<s.length&&s.charAt(j)>='0'&&s.charAt(j)<='9')j++;if(j>0&&s.charAt(j)==='.'&&s.charAt(j+1)===' ')return s.slice(j+2);return null;}
function codeBlockHtml(lang,code){var label=lang?escapeHtml(lang):'code';if(lang==='mermaid'||lang==='mmd'){return '<div class="mermaid" data-mermaid-src="'+escapeHtml(code).replace(/"/g,'&quot;')+'"></div>';}return '<div class="codeblock"><div class="cb-head"><span class="cb-lang">'+label+'</span><button type="button" class="cb-copy" onclick="copyCode(this)">Copy</button></div><pre><code>'+escapeHtml(code)+'</code></pre></div>';}
function renderMarkdown(text){text=text||'';var LF=String.fromCharCode(10),BT=String.fromCharCode(96),FENCE=BT+BT+BT,lines=text.split(LF),out=[],i=0;
  while(i<lines.length){var line=lines[i],t=line.trim();
    if(t.indexOf(FENCE)===0){var lang=t.slice(3).trim(),code=[];i++;while(i<lines.length&&lines[i].trim().indexOf(FENCE)!==0){code.push(lines[i]);i++;}if(i<lines.length)i++;out.push(codeBlockHtml(lang,code.join(LF)));continue;}
    if(t===''){i++;continue;}
    if(t==='---'||t==='***'){out.push('<hr>');i++;continue;}
    var h=0;while(h<line.length&&line.charAt(h)==='#')h++;if(h>0&&h<=6&&line.charAt(h)===' '){var lvl=Math.min(h+2,6);out.push('<h'+lvl+'>'+mdInline(line.slice(h+1))+'</h'+lvl+'>');i++;continue;}
    if(t.charAt(0)==='>'){var q=[];while(i<lines.length&&lines[i].trim().charAt(0)==='>'){q.push(mdInline(lines[i].trim().slice(1).replace(/^ /,'')));i++;}out.push('<blockquote>'+q.join('<br>')+'</blockquote>');continue;}
    if(t.indexOf('- ')===0||t.indexOf('* ')===0){var it=[];while(i<lines.length){var x=lines[i].trim();if(x.indexOf('- ')!==0&&x.indexOf('* ')!==0)break;it.push('<li>'+mdInline(x.slice(2))+'</li>');i++;}out.push('<ul>'+it.join('')+'</ul>');continue;}
    if(orderedRest(t)!==null){var oi=[];while(i<lines.length){var r=orderedRest(lines[i].trim());if(r===null)break;oi.push('<li>'+mdInline(r)+'</li>');i++;}out.push('<ol>'+oi.join('')+'</ol>');continue;}
    if(t.charAt(0)==='|'&&t.indexOf('|',1)>0){var rows=[],sep=function(s){return /^[|\\s:\\-]+$/.test(s)&&s.indexOf('-')>=0;};while(i<lines.length){var tr=lines[i].trim();if(tr.charAt(0)!=='|')break;if(sep(tr)){i++;continue;}rows.push(tr.split('|').slice(1,-1));i++;}if(rows.length){var th='<table><thead><tr>'+rows[0].map(function(c){return '<th>'+mdInline(c.trim())+'</th>';}).join('')+'</tr></thead>';if(rows.length>1){th+='<tbody>';for(var ri=1;ri<rows.length;ri++)th+='<tr>'+rows[ri].map(function(c){return '<td>'+mdInline(c.trim())+'</td>';}).join('')+'</tr>';th+='</tbody>';}th+='</table>';out.push(th);}continue;}
    var p=[];while(i<lines.length){var pl=lines[i],pt=pl.trim();if(pt===''||pt.indexOf(FENCE)===0||pt==='---'||pt==='***'||pt.charAt(0)==='>'||pt.charAt(0)==='|')break;var ph=0;while(ph<pl.length&&pl.charAt(ph)==='#')ph++;if(ph>0&&ph<=6&&pl.charAt(ph)===' ')break;if(pt.indexOf('- ')===0||pt.indexOf('* ')===0||orderedRest(pt)!==null)break;p.push(mdInline(pl));i++;}if(p.length)out.push('<p>'+p.join('<br>')+'</p>');}
  return out.join('');}
function copyCode(btn){var cb=btn.closest('.codeblock'),code=cb?cb.querySelector('code'):null;if(!code)return;navigator.clipboard.writeText(code.innerText||'').then(function(){btn.classList.add('copied');btn.textContent='Copied';setTimeout(function(){btn.classList.remove('copied');btn.textContent='Copy';},1500);});}

// ── Mermaid ──
function renderMermaidIn(el){if(!el)return;var b=el.querySelectorAll('.mermaid[data-mermaid-src]');if(!b.length)return;if(typeof mermaid==='undefined'){window.ensureAskMermaid(function(){renderMermaidIn(el);});return;}b.forEach(function(bl,i){var code=bl.getAttribute('data-mermaid-src');if(!code)return;var w=document.createElement('div');w.className='mermaid-wrap';w.setAttribute('data-src',code);bl.parentNode.replaceChild(w,bl);try{mermaid.render('mmd-'+Date.now()+'-'+i,code).then(function(res){w.innerHTML=res.svg;}).catch(function(e){w.innerHTML='<pre class="mermaid-err">'+escapeHtml(String(e))+'</pre>';});}catch(e){w.innerHTML='<pre class="mermaid-err">'+escapeHtml(String(e))+'</pre>';}});}
function applyMermaidTheme(){if(typeof mermaid==='undefined')return;window.initAskMermaid();document.querySelectorAll('.mermaid-wrap[data-src]').forEach(function(w,i){var code=w.getAttribute('data-src');if(!code)return;try{mermaid.render('mmd-re-'+Date.now()+'-'+i,code).then(function(res){w.innerHTML=res.svg;}).catch(function(){});}catch(e){}});}

// ── Citations ──
function processCodeCitations(el){if(!el)return;var RE=/\\b((?:src|ahd-sandbox)\\/[a-zA-Z0-9\\/_.-]+\\.(?:ts|tsx|js|jsx))(?::(\\d+)(?:-(\\d+))?)?/g;
  var walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT,{acceptNode:function(n){var p=n.parentNode;while(p&&p!==el){if(p.tagName==='CODE'||p.tagName==='PRE'||p.tagName==='A')return NodeFilter.FILTER_REJECT;p=p.parentNode;}return NodeFilter.FILTER_ACCEPT;}});
  var nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
  nodes.forEach(function(node){var text=node.nodeValue;RE.lastIndex=0;if(!RE.test(text))return;RE.lastIndex=0;var frag=document.createDocumentFragment(),last=0,m;
    while((m=RE.exec(text))!==null){if(m.index>last)frag.appendChild(document.createTextNode(text.slice(last,m.index)));
      var span=document.createElement('span');span.className='cite';var lr=m[2]?(m[3]?m[2]+'-'+m[3]:m[2]):'';span.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>'+escapeHtml(m[0]);
      span.addEventListener('click',(function(fp,fl){return function(){openPeek(fp,fl);};})(m[1],lr));frag.appendChild(span);last=m.index+m[0].length;}
    if(last<text.length)frag.appendChild(document.createTextNode(text.slice(last)));node.parentNode.replaceChild(frag,node);});}

// ── File peek ──
function openPeek(path,lines){var peek=document.getElementById('peek'),scrim=document.getElementById('peek-scrim'),body=document.getElementById('peek-body');
  document.getElementById('peek-path').textContent=path+(lines?':'+lines:'');
  body.innerHTML='<div style="padding:20px;color:var(--text-3);font-size:.8rem">Loading…</div>';
  peek.classList.add('open');scrim.classList.add('show');
  fetch('/api/ask/file?path='+encodeURIComponent(path),{credentials:'same-origin'}).then(function(r){return r.ok?r.json():null;}).then(function(d){
    if(!d||!d.content){body.innerHTML='<div style="padding:20px;color:var(--text-3)">File not found</div>';return;}
    var fl=d.content.split('\\n'),hl={};if(lines){var p=lines.split('-'),s=parseInt(p[0],10),e=p[1]?parseInt(p[1],10):s;for(var k=s;k<=e;k++)hl[k]=true;}
    var html='';fl.forEach(function(l,idx){var n=idx+1;html+='<div class="ask-codeline'+(hl[n]?' hl':'')+'"><span class="n">'+n+'</span><span class="c">'+escapeHtml(l)+'</span></div>';});
    body.innerHTML=html;var f=body.querySelector('.ask-codeline.hl');if(f)setTimeout(function(){f.scrollIntoView({block:'center'});},50);
  }).catch(function(){body.innerHTML='<div style="padding:20px;color:var(--red)">Failed to load.</div>';});}
function closePeek(){document.getElementById('peek').classList.remove('open');document.getElementById('peek-scrim').classList.remove('show');}
document.getElementById('peek-close').addEventListener('click',closePeek);
document.getElementById('peek-scrim').addEventListener('click',closePeek);
document.addEventListener('keydown',function(e){if(e.key==='Escape')closePeek();});

// ── Turn rendering ──
function newTurn(question){
  if(welcomeEl)welcomeEl.style.display='none';
  var turn=document.createElement('div');turn.className='ask-turn';
  turn.innerHTML='<div class="ask-q"><span class="qmark">Q</span><span class="qt">'+escapeHtml(question)+'</span></div>'+
    '<div class="ask-answer"><div class="ask-ans-head"><span class="av">'+IC_SPARK+'</span><span class="lbl">Answer</span></div>'+
    '<div class="ask-ans-body"><div class="ask-direct"><div class="ask-thinking"><span class="ask-dots"><span></span><span></span><span></span></span><span>Reading the source…</span></div></div></div></div>';
  colEl.appendChild(turn);scrollDown();
  return {turn:turn,head:turn.querySelector('.ask-ans-head'),body:turn.querySelector('.ask-ans-body'),direct:turn.querySelector('.ask-direct'),files:[],reading:null};
}
function setReading(t,path){if(!t.reading){t.reading=document.createElement('div');t.reading.className='reading-line';t.body.appendChild(t.reading);}t.reading.textContent='› reading '+path;}
function clearReading(t){if(t.reading){t.reading.remove();t.reading=null;}}

function relBars(n){var hs=[5,8,12];return '<span class="ask-src-rel">'+hs.map(function(h,i){return '<i style="height:'+h+'px;opacity:'+(i<n?1:0.25)+'"></i>';}).join('')+'</span>';}
function srcCard(path,rel){
  var i=path.lastIndexOf('/'),dir=i<0?'':path.slice(0,i+1),file=i<0?path:path.slice(i+1);
  var card=document.createElement('div');card.className='ask-src';
  card.innerHTML='<div class="ask-src-head"><span class="ask-src-ic">'+IC_FILE+'</span>'+
    '<div class="ask-src-meta"><div class="ask-src-path">'+escapeHtml(dir)+'<b>'+escapeHtml(file)+'</b></div></div>'+
    relBars(rel)+'<span class="ask-src-chev">'+IC_CHEV+'</span></div>'+
    '<div class="ask-src-code"></div>';
  var head=card.querySelector('.ask-src-head'),codeBox=card.querySelector('.ask-src-code'),loaded=false;
  head.addEventListener('click',function(){card.classList.toggle('open');
    if(card.classList.contains('open')&&!loaded){loaded=true;codeBox.innerHTML='<div style="padding:12px;color:var(--text-3);font-size:.75rem">Loading…</div>';
      fetch('/api/ask/file?path='+encodeURIComponent(path),{credentials:'same-origin'}).then(function(r){return r.ok?r.json():null;}).then(function(d){
        if(!d||!d.content){codeBox.innerHTML='<div style="padding:12px;color:var(--text-3);font-size:.75rem">Unavailable</div>';return;}
        var fl=d.content.split('\\n').slice(0,200),html='';fl.forEach(function(l,idx){html+='<div class="ask-codeline"><span class="n">'+(idx+1)+'</span><span class="c">'+escapeHtml(l)+'</span></div>';});
        html+='<div class="ask-src-open"><button type="button">'+IC_EYE+' Open full file</button></div>';codeBox.innerHTML=html;
        codeBox.querySelector('.ask-src-open button').addEventListener('click',function(ev){ev.stopPropagation();openPeek(path,'');});
      }).catch(function(){codeBox.innerHTML='<div style="padding:12px;color:var(--red);font-size:.75rem">Failed.</div>';});}});
  return card;
}

function addSection(t,title,count,childrenNode){
  var sec=document.createElement('div');sec.className='ask-section';
  sec.innerHTML='<div class="ask-sec-h">'+IC_FILE.replace('<svg','<svg class="lead"')+title+(typeof count==='number'?' · '+count:'')+'<span class="chev">'+IC_CHEV+'</span></div><div class="ask-sec-body"></div>';
  sec.querySelector('.ask-sec-h').addEventListener('click',function(){sec.classList.toggle('collapsed');});
  sec.querySelector('.ask-sec-body').appendChild(childrenNode);
  t.body.appendChild(sec);
}
function setConfidence(t,level){var lbl={high:'High confidence',med:'Medium confidence',low:'Low confidence'}[level];var ic={high:IC_CHECKS,med:IC_INFO,low:IC_INFO}[level];var c=document.createElement('span');c.className='ask-conf '+level;c.innerHTML=ic+' '+lbl;t.head.appendChild(c);}

// ── Submit / stream ──
var isSubmitting=false,currentEvtSource=null;
function setBusy(b){if(b){submitBtn.classList.add('is-stop');submitBtn.innerHTML='<span class="stop-ico"></span>';}else{submitBtn.classList.remove('is-stop');submitBtn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:19px;height:19px"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>';}}
function handleAction(){if(isSubmitting){if(currentEvtSource){currentEvtSource.close();currentEvtSource=null;}isSubmitting=false;setBusy(false);return;}submitQuestion();}

function submitQuestion(){
  var question=questionEl.value.trim();if(!question||isSubmitting)return;
  errorArea.textContent='';questionEl.value='';questionEl.style.height='auto';isSubmitting=true;setBusy(true);
  document.getElementById('ask-root').classList.remove('nav-open');
  var t=newTurn(question);var streamingText='',fullText='',started=false,renderPending=false;
  var es=new EventSource('/api/ask?question='+encodeURIComponent(question)+'&mode=technical&quality='+currentQuality+historyParam()+pinsParam(),{withCredentials:true});
  currentEvtSource=es;
  es.addEventListener('reading',function(e){try{var d=JSON.parse(e.data);if(d.path){if(t.files.indexOf(d.path)<0)t.files.push(d.path);setReading(t,d.path);}}catch(x){}});
  es.addEventListener('file_read',function(e){try{var d=JSON.parse(e.data);if(d.path&&t.files.indexOf(d.path)<0)t.files.push(d.path);}catch(x){}});
  es.addEventListener('token',function(e){try{var d=JSON.parse(e.data);streamingText+=d.text||'';if(!started){started=true;clearReading(t);}if(!renderPending){renderPending=true;setTimeout(function(){t.direct.innerHTML=renderMarkdown(stripPartialMarker(streamingText))+'<span class="stream-cursor"></span>';renderPending=false;scrollDown();},55);}}catch(x){}});
  es.addEventListener('answer',function(e){try{var d=JSON.parse(e.data);fullText=streamingText||d.text||'';var ex=extractFollowups(fullText);t.followupQs=ex.fu;clearReading(t);t.direct.innerHTML=renderMarkdown(ex.text);renderMermaidIn(t.direct);processCodeCitations(t.direct);scrollDown();}catch(x){}});
  es.addEventListener('done',function(e){
    var d={};try{d=JSON.parse(e.data);}catch(x){}
    es.close();currentEvtSource=null;isSubmitting=false;setBusy(false);clearReading(t);
    var ex=extractFollowups(fullText||streamingText||'');
    var answer=ex.text;if(ex.fu&&ex.fu.length)t.followupQs=ex.fu;
    // ensure marker is stripped from the rendered answer even if only 'done' fired
    if(answer&&t.direct&&t.direct.innerHTML.indexOf('FU:')<0&&!started){t.direct.innerHTML=renderMarkdown(answer);renderMermaidIn(t.direct);processCodeCitations(t.direct);}
    if(!answer){t.direct.innerHTML='<span class="ask-err">No answer was returned. Try rephrasing.</span>';}
    if(answer){conversation.push({q:question,a:answer});if(conversation.length>6)conversation.shift();}
    var files=(d.files||t.files||[]).filter(function(f){return f&&/\\.(ts|tsx|js|jsx)$/.test(f);});
    // dedupe + shorten paths relative to project
    var seen={},clean=[];files.forEach(function(f){var s=f.replace(/^.*ahd-sandbox\\//,'').replace(/^.*\\/src\\//,'src/');if(!seen[s]){seen[s]=true;clean.push(s);}});
    setConfidence(t,clean.length>=2?'high':clean.length===1?'med':'low');
    if(clean.length){var wrap=document.createElement('div');wrap.className='ask-sources';clean.slice(0,8).forEach(function(f,idx){wrap.appendChild(srcCard(f,idx===0?3:idx<3?2:1));});addSection(t,'Relevant files',clean.length,wrap);}
    // footer: usage + feedback
    var foot=document.createElement('div');foot.className='ask-foot';
    var u='';if(d.usage&&(d.usage.input!=null||d.usage.output!=null)){u='<div class="usage-info">'+(d.quality?'<span class="u-q">'+escapeHtml(d.quality)+'</span>':'')+(d.semantic?'<span class="u-sem">semantic</span>':'')+'<span>'+(d.usage.input||0)+' in / '+(d.usage.output||0)+' out</span></div>';}
    foot.innerHTML=u+'<div class="fb-bar"><span class="fb-q">Helpful?</span><button class="fb-btn fb-up" title="Yes">'+IC_UP+'</button><button class="fb-btn fb-down" title="No">'+IC_DOWN+'</button><button class="fb-btn fb-share" title="Copy link">'+IC_SHARE+'</button></div>';
    t.turn.appendChild(foot);
    if(d.id){wireFeedback(foot,d.id);}
    // follow-ups: contextual questions emitted by the model in the answer marker,
    // falling back to related suggestions if none were parsed.
    var fu=(t.followupQs&&t.followupQs.length)?t.followupQs.slice(0,3):pickFollowups(question);
    if(fu.length){var fb=document.createElement('div');fb.className='ask-follow';fu.forEach(function(q){var c=document.createElement('button');c.className='fchip';c.innerHTML=IC_ARROW+' '+escapeHtml(q);c.addEventListener('click',function(){askQuestion(q);});fb.appendChild(c);});t.turn.appendChild(fb);}
    scrollDown();questionEl.focus();loadRecents();
  });
  es.onerror=function(){es.close();currentEvtSource=null;clearReading(t);if(streamingText){t.direct.innerHTML=renderMarkdown(extractFollowups(streamingText).text);processCodeCitations(t.direct);}else if(isSubmitting){t.direct.innerHTML='<span class="ask-err">Connection interrupted. Please try again.</span>';}isSubmitting=false;setBusy(false);};
}
function wireFeedback(foot,id){var up=foot.querySelector('.fb-up'),dn=foot.querySelector('.fb-down'),sh=foot.querySelector('.fb-share'),q=foot.querySelector('.fb-q');
  function send(rating){fetch('/api/ask/feedback',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({id:id,rating:rating})}).catch(function(){});}
  up.addEventListener('click',function(){up.classList.add('chosen');dn.classList.remove('chosen');q.textContent='Thanks';send('up');});
  dn.addEventListener('click',function(){dn.classList.add('chosen');up.classList.remove('chosen');q.textContent='Thanks';send('down');});
  sh.addEventListener('click',function(){navigator.clipboard.writeText(location.origin+'/ask?qa='+encodeURIComponent(id)).then(function(){sh.classList.add('chosen');q.textContent='Link copied';setTimeout(function(){sh.classList.remove('chosen');},1800);}).catch(function(){});});}

function pickFollowups(q){var pool=SAMPLE_QUESTIONS.filter(function(s){return s.toLowerCase()!==q.toLowerCase();});var out=[];var start=Math.floor(Math.random()*pool.length);for(var i=0;i<3&&i<pool.length;i++)out.push(pool[(start+i)%pool.length]);return out;}
function askQuestion(q){questionEl.value=q;submitQuestion();}

// ── Sample questions ──
var SAMPLE_QUESTIONS=['How is the GDP growth rate calculated?','What triggers a sovereign default crisis?','How does inflation recalculation work each turn?','How does the election vote tally work?','What is the corporate credit scoring formula?','How does the forex exchange rate system work?','What is the campaign spending formula?','How does party influence change each turn?','How are commodity prices determined?','What does the IMF bailout turn logic do?'];

// suggested in nav
(function(){var navS=document.getElementById('nav-suggested');var start=Math.floor(Math.random()*SAMPLE_QUESTIONS.length);for(var i=0;i<5;i++){var q=SAMPLE_QUESTIONS[(start+i)%SAMPLE_QUESTIONS.length];var b=document.createElement('button');b.className='ask-sugg';b.type='button';b.innerHTML=IC_INFO+' '+escapeHtml(q);b.addEventListener('click',(function(qq){return function(){askQuestion(qq);document.getElementById('ask-root').classList.remove('nav-open');};})(q));navS.appendChild(b);}})();
// welcome grid
(function(){var g=document.getElementById('welcome-grid');var start=Math.floor(Math.random()*SAMPLE_QUESTIONS.length);for(var i=0;i<4;i++){var q=SAMPLE_QUESTIONS[(start+i)%SAMPLE_QUESTIONS.length];var b=document.createElement('button');b.className='ask-wcard';b.type='button';b.innerHTML=IC_INFO.replace('<svg','<svg width="16" height="16"')+'<span class="wt">'+escapeHtml(q)+'</span>';b.addEventListener('click',(function(qq){return function(){askQuestion(qq);};})(q));g.appendChild(b);}})();

// ── Recents ──
function loadRecents(){var el=document.getElementById('nav-recents');if(!el)return;
  fetch('/api/ask/log',{credentials:'same-origin'}).then(function(r){return r.ok?r.json():null;}).then(function(data){
    if(!data||!data.entries||!data.entries.length){el.innerHTML='<div style="padding:6px 16px;font-size:.75rem;color:var(--text-3)">No searches yet</div>';return;}
    el.innerHTML='';data.entries.slice(0,8).forEach(function(item){var b=document.createElement('button');b.className='ask-recent';b.type='button';b.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg><span class="t">'+escapeHtml((item.question||'').slice(0,50))+'</span>';b.addEventListener('click',(function(qq){return function(){askQuestion(qq);document.getElementById('ask-root').classList.remove('nav-open');};})(item.question||''));el.appendChild(b);});
  }).catch(function(){el.innerHTML='<div style="padding:6px 16px;font-size:.75rem;color:var(--text-3)">Could not load</div>';});}
loadRecents();

// ── Permalink ──
(function(){var m=location.search.match(/[?&]qa=([^&]+)/);if(!m)return;var id=decodeURIComponent(m[1]);
  fetch('/api/ask/log?id='+encodeURIComponent(id),{credentials:'same-origin'}).then(function(r){return r.ok?r.json():null;}).then(function(d){
    if(!d||!d.answer)return;if(welcomeEl)welcomeEl.style.display='none';
    var ex=extractFollowups(d.answer);var t=newTurn(d.question||'');clearReading(t);t.direct.innerHTML=renderMarkdown(ex.text);renderMermaidIn(t.direct);processCodeCitations(t.direct);setConfidence(t,'med');
    if(ex.fu&&ex.fu.length){var fb=document.createElement('div');fb.className='ask-follow';ex.fu.forEach(function(q){var c=document.createElement('button');c.className='fchip';c.innerHTML=IC_ARROW+' '+escapeHtml(q);c.addEventListener('click',function(){askQuestion(q);});fb.appendChild(c);});t.turn.appendChild(fb);}
    scrollDown();
  }).catch(function(){});})();

questionEl.focus();
</script>
${THEME_TOGGLE_JS}
</body>
</html>`;
};
