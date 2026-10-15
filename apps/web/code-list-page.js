// code-list-page.js — Session manager UI for browser-based agentic coding
// Exported as a function that receives FONT_LINKS and BASE_CSS template strings.
//
// AHD design-system home for the code agent: live agents (tmux/process) with
// working/ready status, model and usage; optional named groups + renames;
// "Chats" section for persisted sessions. Features retained: stats, create
// modal with base-branch picker, PR creation, delete, auto-refresh.

const { icon, faviconFor, THEME_HEAD } = require('./ui-kit');

module.exports = function makeCodeListPage(FONT_LINKS, BASE_CSS) {
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
html,body{height:100%;overflow:auto;overscroll-behavior:contain}
body{background:var(--bg-0);color:var(--text)}

.list-container{max-width:860px;margin:0 auto;padding:0 var(--s-5) var(--s-6);min-height:100dvh;display:flex;flex-direction:column}

/* Header — flush to top of page; safe-area lives on the bar itself */
.page-top{display:flex;align-items:flex-start;gap:var(--s-3);margin:0 calc(-1 * var(--s-5)) var(--s-5);padding:max(var(--s-4),env(safe-area-inset-top)) var(--s-5) var(--s-4);border-bottom:1px solid var(--border);background:color-mix(in srgb,var(--bg-0) 92%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
.icon-btn{display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:var(--r-md);border:1px solid transparent;background:transparent;color:var(--text-2);cursor:pointer;transition:background var(--t),color var(--t),border-color var(--t);flex-shrink:0;text-decoration:none;margin-top:0}
.icon-btn:hover{background:var(--glass-2);border-color:var(--border);color:var(--text)}
.page-nav-toggle{display:none;margin-top:0}
.page-head{flex:1;min-width:0}
.page-title{font-size:clamp(1.35rem,3vw,1.65rem);font-weight:700;letter-spacing:-.03em;display:flex;align-items:center;gap:.65rem;color:var(--text);line-height:1.15}
.page-title .brand-mark{width:34px;height:34px;border-radius:var(--r-sm);background:linear-gradient(135deg,var(--accent),var(--accent-2));display:flex;align-items:center;justify-content:center;color:var(--on-accent);flex-shrink:0;box-shadow:var(--e1),0 0 0 1px color-mix(in srgb,var(--accent) 35%,transparent)}
.page-title .brand-mark svg{display:block}
.page-sub{margin:.35rem 0 0;font-size:.82rem;color:var(--text-3);line-height:1.45;max-width:36rem}
.page-actions{display:flex;align-items:center;gap:var(--s-2);flex-shrink:0;padding-top:0}
.btn-new{display:inline-flex;align-items:center;gap:var(--s-2);padding:.58rem 1.05rem;border-radius:var(--r-md);background:var(--accent);border:none;color:var(--on-accent);font-size:.84rem;font-weight:600;cursor:pointer;transition:all var(--t);font-family:var(--font);box-shadow:var(--e1)}
.btn-new:hover{filter:brightness(1.08);transform:translateY(-1px)}
.btn-new:active{transform:none}
.btn-spawn{display:inline-flex;align-items:center;gap:var(--s-2);padding:.58rem 1.05rem;border-radius:var(--r-md);background:transparent;border:1px solid color-mix(in srgb,var(--green) 40%,var(--border));color:var(--green);font-size:.84rem;font-weight:600;cursor:pointer;transition:all var(--t);font-family:var(--font)}
.btn-spawn:hover{background:var(--green-soft);transform:translateY(-1px)}
.btn-spawn:active{transform:none}

/* Compact summary line */
.summary{display:flex;align-items:center;gap:.55em;font-size:.78rem;color:var(--text-3);margin:0 0 var(--s-5);flex-wrap:wrap;padding:.55rem .85rem;border-radius:var(--r-md);background:var(--glass-1);border:1px solid var(--border)}
.summary:empty{display:none}
.summary b{font-weight:600;color:var(--text-2)}
.summary .w b{color:var(--green)}
.summary .sep{opacity:.4}
.cost-strip{display:flex;align-items:center;gap:.65em;flex-wrap:wrap;margin:0 0 var(--s-5);padding:.7rem .9rem;border-radius:var(--r-md);border:1px solid color-mix(in srgb,var(--accent) 22%,var(--border));background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 8%,var(--surface)),var(--surface));font-size:.78rem;color:var(--text-3)}
.cost-strip .cost-main{font-weight:700;color:var(--text);font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.cost-strip .cost-sub{font-variant-numeric:tabular-nums}
.cost-strip .cost-src{margin-left:auto;font-size:.62rem;opacity:.7}
.cost-chip{font-family:var(--mono);font-size:.66rem;color:var(--green);font-variant-numeric:tabular-nums}

/* Section labels */
.section-label{display:flex;align-items:center;gap:.5em;font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3);margin:0 0 var(--s-2) 2px}
.section-label + .session-grid{margin-bottom:var(--s-6)}
.live-pulse{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 8px color-mix(in srgb,var(--green) 60%,transparent);animation:live-pulse 2s ease-in-out infinite}
@keyframes live-pulse{0%,100%{opacity:1}50%{opacity:.45}}

/* Live band — mission-control strip */
.live-band{margin-bottom:var(--s-6);border:1px solid color-mix(in srgb,var(--green) 22%,var(--border));border-radius:var(--r-lg);background:linear-gradient(180deg,color-mix(in srgb,var(--green) 7%,var(--surface)),var(--surface));box-shadow:var(--hi);overflow:hidden;position:relative}
.live-band::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(180deg,var(--green),var(--accent-2))}
.live-band-head{display:flex;align-items:center;justify-content:space-between;gap:var(--s-2);margin:var(--s-3) var(--s-4) var(--s-2);padding-left:4px}
.live-band-head .section-label{margin:0}
.btn-group{display:inline-flex;align-items:center;gap:.35rem;padding:.28rem .55rem;border:1px solid var(--border);border-radius:var(--r-sm);background:transparent;color:var(--text-3);font:650 .68rem var(--font);cursor:pointer;transition:all var(--t)}
.btn-group:hover{background:var(--glass-2);color:var(--text);border-color:color-mix(in srgb,var(--accent) 30%,var(--border))}
.agent-group{border-top:1px solid color-mix(in srgb,var(--green) 12%,var(--border))}
.agent-group:first-child{border-top:none}
.agent-group-head{display:flex;align-items:center;gap:var(--s-2);padding:.55rem .85rem .35rem;color:var(--text-2)}
.agent-group-name{font-size:.72rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.agent-group-count{font-size:.62rem;color:var(--text-3);font-variant-numeric:tabular-nums}
.agent-group-head .card-menu>summary{width:28px;height:28px;font-size:1rem}
.agent-group-empty{margin:0 .85rem .65rem;padding:.55rem .7rem;border:1px dashed color-mix(in srgb,var(--border) 80%,transparent);border-radius:var(--r-sm);color:var(--text-3);font-size:.72rem;line-height:1.4}
.live-band .section-label{margin:var(--s-3) var(--s-4) var(--s-2);padding-left:4px}
.live-band .session-grid{margin:0;padding:0 6px 6px;border:none;background:transparent;border-radius:0;box-shadow:none}
.live-band .session-grid:empty{display:none}
.live-band .session-card{border-bottom-color:color-mix(in srgb,var(--green) 12%,var(--border));border-radius:var(--r-sm);margin:1px 0}
.live-band .session-card:last-child{border-bottom:none}
.live-band .session-card:hover{background:color-mix(in srgb,var(--green) 6%,var(--glass-1))}

/* Chats grid */
.session-grid{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:var(--r-lg);background:color-mix(in srgb,var(--surface) 70%,transparent);overflow:hidden;box-shadow:var(--hi)}
.session-grid:empty{display:none}
.session-card{position:relative;display:flex;align-items:center;gap:var(--s-3);padding:var(--s-3) var(--s-3);border-bottom:1px solid var(--border);cursor:pointer;transition:background var(--t)}
.session-card:last-child{border-bottom:none}
.session-card:hover{background:var(--glass-2)}

/* Agent mark tile */
.agent-mark{position:relative;width:36px;height:36px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--text-3);background:var(--glass-2);border:1px solid var(--border)}
.agent-mark svg{width:18px;height:18px}
.agent-mark.kind-claude{color:var(--accent);background:var(--accent-soft);border-color:color-mix(in srgb,var(--accent) 28%,var(--border))}
.agent-mark.kind-codex{color:var(--accent-2);background:color-mix(in srgb,var(--accent-2) 12%,transparent);border-color:color-mix(in srgb,var(--accent-2) 28%,var(--border))}
.agent-mark.kind-kimi{color:var(--pink);background:color-mix(in srgb,var(--pink) 12%,transparent);border-color:color-mix(in srgb,var(--pink) 28%,var(--border))}
.agent-mark.kind-cursor{color:var(--gold);background:var(--gold-soft);border-color:color-mix(in srgb,var(--gold) 28%,var(--border))}
.agent-mark.kind-gemini{color:var(--cyan);background:color-mix(in srgb,var(--cyan) 12%,transparent);border-color:color-mix(in srgb,var(--cyan) 28%,var(--border))}
.presence{position:absolute;right:-3px;bottom:-3px;width:10px;height:10px;border-radius:50%;border:2px solid var(--surface);background:var(--green);animation:live-pulse 1.6s ease-in-out infinite}

.session-card-info{flex:1;min-width:0}
.card-top{display:flex;align-items:center;gap:var(--s-2);min-width:0}
.session-card-title{font-size:.92rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;letter-spacing:-.01em}
.session-card-meta{display:flex;align-items:center;gap:var(--s-2);font-size:.74rem;color:var(--text-3);flex-wrap:wrap;margin-top:.25rem}
.session-card-meta code{font-family:var(--mono);font-size:.72rem;color:var(--text-2);background:var(--glass-2);padding:.08em .4em;border-radius:5px}
.session-card-meta .sep{opacity:.4}

/* Status chips */
.chip{display:inline-flex;align-items:center;gap:.35em;font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:.22em .65em;border-radius:var(--r-full);flex-shrink:0;background:var(--glass-2);color:var(--text-3)}
.chip:before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor}
.chip.working{background:var(--green-soft);color:var(--green)}
.chip.working:before{animation:live-pulse 1.2s ease-in-out infinite}
.chip.wrapping{background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent)}
.chip.ready-close{background:var(--green-soft);color:var(--green)}
.chip.idle{color:var(--text-3)}
.chip.active{background:var(--green-soft);color:var(--green)}
.chip.completed{background:var(--accent-soft);color:var(--accent)}
.chip.error{background:var(--red-soft);color:var(--red)}
.chip.stub{background:var(--accent-soft);color:var(--accent)}
.chip.detached{background:var(--amber-soft);color:var(--amber)}
.chip.attention{background:var(--amber-soft);color:var(--amber)}
.card-hint{font-size:.66rem;color:var(--text-3);white-space:nowrap}

.model-chip{font-family:var(--mono);font-size:.68rem;color:var(--accent)}
.usage-mini{display:flex;align-items:center;gap:var(--s-2);margin-top:.4rem;max-width:260px}
.usage-mini .track{flex:1;height:4px;border-radius:99px;background:var(--glass-2);overflow:hidden}
.usage-mini .track i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--accent),var(--accent-2));transition:width .4s}
.usage-mini.remaining .track i{background:linear-gradient(90deg,var(--green),var(--accent-2))}
.usage-mini .lbl{font-size:.62rem;color:var(--text-3);white-space:nowrap}

.session-card-actions{display:flex;gap:var(--s-1);flex-shrink:0;opacity:0;transition:opacity var(--t)}
.session-card:hover .session-card-actions{opacity:1}
.btn-sm{font-size:.74rem;padding:.4rem .7rem;border-radius:var(--r-md);border:1px solid var(--border);background:transparent;color:var(--text-2);cursor:pointer;transition:all var(--t);font-family:var(--font)}
.btn-sm:hover{background:var(--glass-hover);color:var(--text)}
.btn-sm.danger:hover{border-color:var(--red);color:var(--red);background:var(--red-soft)}
.btn-sm.pr{border-color:color-mix(in srgb,var(--green) 45%,transparent);color:var(--green)}
.btn-sm.pr:hover{background:var(--green-soft)}
.btn-sm.approve{border-color:color-mix(in srgb,var(--amber) 50%,transparent);color:var(--amber);background:var(--amber-soft);font-weight:700}
.btn-sm.approve:hover{filter:brightness(1.08)}
.session-card.needs-input{border-color:color-mix(in srgb,var(--amber) 28%,var(--border));background:color-mix(in srgb,var(--amber) 5%,transparent)}
.session-card.needs-input .session-card-actions{opacity:1}
.attention-excerpt{font-size:.68rem;color:var(--amber);margin-top:.3rem;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.live-status,.task-excerpt{font-size:.68rem;color:var(--text-3);margin-top:.3rem;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.live-status{color:var(--text-2)}
.task-excerpt b{font-weight:650;color:var(--text-3);margin-right:.3em}
.pr-link{color:var(--green);text-decoration:none;font-size:.74rem;display:inline-flex;align-items:center;gap:.3em;padding:.4rem .6rem}
.pr-link:hover{text-decoration:underline}
.pr-status{display:inline-flex;align-items:center;gap:.25em;font-size:.64rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:.15em .45em;border-radius:var(--r-full);margin-left:.25rem}
.pr-status.open{background:var(--green-soft);color:var(--green)}
.pr-status.merged{background:color-mix(in srgb,var(--accent-2) 14%,transparent);color:var(--accent-2)}
.pr-status.closed{background:var(--red-soft);color:var(--red)}
@media(hover:none){.session-card-actions{opacity:1}}

/* Empty state */
.empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:var(--s-12) var(--s-5);gap:var(--s-3);color:var(--text-3);text-align:center;border:1px dashed var(--border);border-radius:var(--r-lg);background:var(--glass-1);margin-top:var(--s-2)}
.empty-state .ico{width:56px;height:56px;border-radius:var(--r-md);display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--accent),var(--accent-2));color:var(--on-accent);box-shadow:var(--e1);margin-bottom:var(--s-2)}
.empty-state .ico svg{display:block}
.empty-state h2{font-size:1.15rem;font-weight:700;color:var(--text);letter-spacing:-.02em}
.empty-state p{font-size:.875rem;max-width:400px;line-height:1.55;color:var(--text-3)}
.empty-state .btn-new{margin-top:var(--s-2)}

/* Create modal */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center;z-index:100;padding:var(--s-4)}
.modal-overlay.active{display:flex}
.modal-card{width:100%;max-width:440px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-xl);padding:var(--s-6);box-shadow:var(--e3),var(--hi);animation:rise .25s var(--ease)}
#spawn-modal .modal-card{max-width:560px;max-height:min(92vh,780px);overflow:auto}
.spawn-steps{display:flex;gap:6px;margin:0 0 var(--s-4);flex-wrap:wrap}
.spawn-step-pill{display:inline-flex;align-items:center;gap:6px;padding:.28rem .55rem;border:1px solid var(--border);border-radius:var(--r-full);background:var(--glass-1);color:var(--text-3);font-size:.64rem;font-weight:650;letter-spacing:.02em}
.spawn-step-pill.active{border-color:color-mix(in srgb,var(--accent) 40%,var(--border));background:var(--accent-soft);color:var(--accent)}
.spawn-step-pill.done{color:var(--text-2)}
.spawn-step-num{display:inline-grid;place-items:center;width:1.1rem;height:1.1rem;border-radius:50%;background:var(--glass-2);font-variant-numeric:tabular-nums}
.spawn-step-pill.active .spawn-step-num{background:var(--accent);color:var(--on-accent)}
.spawn-panel[hidden]{display:none!important}
.when-grid{display:grid;grid-template-columns:1fr 1fr;gap:var(--s-2)}
.when-card{min-height:64px;padding:.75rem .8rem;border:1px solid var(--border);border-radius:var(--r-md);background:var(--glass-1);color:var(--text);text-align:left;cursor:pointer;font-family:var(--font)}
.when-card b{display:block;font-size:.82rem}.when-card small{display:block;margin-top:.2rem;font-size:.64rem;color:var(--text-3);line-height:1.35}
.when-card.selected{border-color:var(--accent);background:var(--accent-soft)}
.form-textarea{width:100%;min-height:140px;padding:.7rem .85rem;background:var(--field-bg);border:1px solid var(--border);border-radius:var(--r-md);color:var(--text);font-size:.875rem;font-family:var(--font);line-height:1.45;outline:none;resize:vertical;transition:border-color var(--t),box-shadow var(--t)}
.form-textarea:focus{border-color:var(--accent);box-shadow:var(--ring)}
.schedule-band{margin-bottom:var(--s-7);border:1px solid color-mix(in srgb,var(--accent) 22%,var(--border));border-radius:var(--r-lg);background:color-mix(in srgb,var(--surface) 76%,transparent);box-shadow:var(--hi);overflow:hidden}
.schedule-band-head{display:flex;align-items:center;justify-content:space-between;gap:var(--s-3);margin:var(--s-3) var(--s-4) var(--s-2)}
.schedule-band .section-count{border-color:color-mix(in srgb,var(--accent) 24%,var(--border));background:var(--accent-soft);color:var(--accent)}
.schedule-list{display:flex;flex-direction:column;border-top:1px solid var(--border)}
.schedule-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:.75rem;align-items:start;padding:.75rem .9rem;border-bottom:1px solid var(--border)}
.schedule-row:last-child{border-bottom:0}
.schedule-row-title{font-size:.84rem;font-weight:650;color:var(--text)}
.schedule-row-meta{margin-top:.2rem;font-size:.68rem;color:var(--text-3);font-variant-numeric:tabular-nums}
.schedule-row-prompt{margin-top:.35rem;font-size:.72rem;color:var(--text-2);line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
@media(max-width:600px){
  .when-grid{grid-template-columns:1fr}
  .schedule-row{grid-template-columns:auto minmax(0,1fr);grid-template-rows:auto auto}
  .schedule-row .btn-sm{grid-column:2;justify-self:start}
}
.modal-title{font-size:1.1rem;font-weight:700;letter-spacing:-.02em;margin-bottom:var(--s-5);display:flex;align-items:center;gap:var(--s-2)}
.modal-title .icon{color:var(--accent)}
.form-group{margin-bottom:var(--s-4)}
.form-label{display:block;font-size:.78rem;font-weight:600;color:var(--text-2);margin-bottom:var(--s-2)}
.form-select{width:100%;padding:.65rem .85rem;background:var(--field-bg);border:1px solid var(--border);border-radius:var(--r-md);color:var(--text);font-size:.875rem;font-family:var(--font);outline:none;appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239aa0a6' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right .85rem center;transition:border-color var(--t),box-shadow var(--t)}
.form-select:focus{border-color:var(--accent);box-shadow:var(--ring)}
.form-hint{margin:0 0 var(--s-4);color:var(--text-3);font-size:.78rem;line-height:1.45}
.modal-actions{display:flex;gap:var(--s-3);justify-content:flex-end;margin-top:var(--s-5)}
.btn-cancel{background:transparent;border:1px solid var(--border);color:var(--text);padding:.55rem 1.1rem;border-radius:var(--r-md);font-size:.875rem;font-weight:600;cursor:pointer;transition:all var(--t);font-family:var(--font)}
.btn-cancel:hover{background:var(--glass-hover)}
.btn-create{background:var(--accent);color:var(--on-accent);padding:.55rem 1.3rem;border-radius:var(--r-md);font-size:.875rem;font-weight:600;border:none;cursor:pointer;transition:all var(--t);font-family:var(--font);box-shadow:var(--e1)}
.btn-create:hover{filter:brightness(1.08)}
.btn-create:disabled{opacity:.5;cursor:not-allowed}

/* Provider picker (spawn modal) */
.provider-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s-2);margin-bottom:var(--s-4)}
.provider-card{display:flex;align-items:center;gap:var(--s-3);padding:var(--s-3);border:1px solid var(--border);border-radius:var(--r-md);background:var(--glass-1);cursor:pointer;transition:all var(--t);text-align:left;font-family:var(--font);color:var(--text)}
.provider-card:hover{border-color:color-mix(in srgb,var(--accent) 35%,transparent);background:var(--glass-2)}
.provider-card.selected{border-color:var(--accent);background:var(--accent-soft);box-shadow:0 0 0 1px var(--accent)}
.provider-card .agent-tile{width:34px;height:34px}
.provider-card b{display:block;font-size:.86rem;font-weight:600}
.provider-card small{display:block;font-size:.68rem;color:var(--text-3);margin-top:.1rem;font-family:var(--mono)}
.agent-tile{display:flex;align-items:center;justify-content:center;border-radius:var(--r-md);background:var(--glass-2);border:1px solid var(--border);color:var(--text-2);flex-shrink:0}
.agent-tile.kind-claude{color:var(--accent)}
.agent-tile.kind-codex{color:var(--accent-2)}
.agent-tile.kind-kimi{color:var(--pink)}
.agent-tile.kind-cursor{color:var(--gold)}
.agent-tile.kind-opencode{color:var(--accent)}
.agent-tile.kind-ollama{color:var(--amber)}
.agent-tile.kind-gemini{color:var(--cyan)}
.form-input{width:100%;padding:.65rem .85rem;background:var(--field-bg);border:1px solid var(--border);border-radius:var(--r-md);color:var(--text);font-size:.875rem;font-family:var(--mono);outline:none;transition:border-color var(--t),box-shadow var(--t)}
.form-input:focus{border-color:var(--accent);box-shadow:var(--ring)}
.spawn-error{display:none;font-size:.76rem;color:var(--red);margin:0 0 var(--s-3)}
.spawn-error.show{display:block}
.perm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(0,1fr));gap:var(--s-2);margin-bottom:var(--s-4)}
.perm-card{min-height:52px;padding:.7rem .75rem;border:1px solid var(--border);border-radius:var(--r-md);background:var(--glass-1);color:var(--text);text-align:left;cursor:pointer;font-family:var(--font)}
.perm-card b{display:block;font-size:.8rem}.perm-card small{display:block;margin-top:.15rem;font-size:.64rem;color:var(--text-3);line-height:1.3}
.perm-card.selected{border-color:var(--accent);background:var(--accent-soft)}
@media(max-width:600px){
  .provider-grid{grid-template-columns:1fr}
  .perm-grid{grid-template-columns:1fr}
  .perm-card{min-height:48px}
}

/* 2026 workspace refresh — one clear action, compact telemetry, quiet cards */
.list-container{max-width:1040px;padding:0 clamp(16px,4vw,40px) 48px}
.page-top{align-items:center;margin:0 calc(-1 * clamp(16px,4vw,40px)) var(--s-6);padding:max(clamp(14px,2.5vw,22px),env(safe-area-inset-top)) clamp(16px,4vw,40px) var(--s-5);border-bottom:1px solid var(--border)}
.page-title{font-size:clamp(1.4rem,3vw,1.8rem)}
.page-title .brand-mark{width:32px;height:32px;background:var(--glass-2);color:var(--accent);border:1px solid var(--border);box-shadow:none}
.page-sub{max-width:42rem}
.page-actions{position:relative}
.page-menu{position:relative}
.page-menu>summary{list-style:none}
.page-menu>summary::-webkit-details-marker{display:none}
.page-menu-trigger{margin-top:0}
.page-menu[open] .page-menu-popover{display:flex}
.page-menu-popover{position:absolute;top:calc(100% + 8px);right:0;z-index:40;display:none;flex-direction:column;gap:3px;width:220px;padding:6px;border:1px solid var(--border);border-radius:var(--r-lg);background:var(--surface);box-shadow:var(--e3),var(--hi)}
.page-menu-popover .btn-spawn,.page-menu-popover .menu-action{display:flex;width:100%;height:auto;min-height:40px;justify-content:flex-start;gap:10px;margin:0;padding:.58rem .7rem;border:0;border-radius:var(--r-sm);background:transparent;color:var(--text-2);box-shadow:none;font:600 .8rem var(--font);cursor:pointer}
.page-menu-popover .btn-spawn:hover,.page-menu-popover .menu-action:hover{background:var(--glass-hover);color:var(--text);transform:none}
.overview-bar{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:var(--s-4);min-height:54px;margin-bottom:var(--s-7);padding:.7rem .85rem;border:1px solid var(--border);border-radius:var(--r-lg);background:color-mix(in srgb,var(--surface) 78%,transparent);box-shadow:var(--hi)}
.overview-bar .summary,.overview-bar .cost-strip{margin:0;padding:0;border:0;border-radius:0;background:transparent}
.overview-bar .summary{min-width:0}
.overview-bar .cost-strip{justify-content:flex-end;white-space:nowrap}
.cost-strip .cost-src{margin-left:.15rem}
.cost-breakdown-link{color:var(--accent);font-size:.68rem;font-weight:650;text-decoration:none}
.cost-breakdown-link:hover{text-decoration:underline}
.cost-breakdown{position:relative}
.cost-breakdown>summary{list-style:none;cursor:pointer;color:var(--accent);font-size:.68rem;font-weight:650}
.cost-breakdown>summary::-webkit-details-marker{display:none}
.cost-breakdown[open] .cost-breakdown-popover{display:block}
.cost-breakdown-popover{position:absolute;right:0;top:calc(100% + 8px);z-index:30;display:none;width:max-content;max-width:min(320px,80vw);padding:.65rem .75rem;border:1px solid var(--border);border-radius:var(--r-md);background:var(--surface);box-shadow:var(--e2);color:var(--text-2);font:500 .7rem/1.5 var(--font);white-space:normal}
.content-section{margin-bottom:var(--s-7)}
.list-state{display:flex;align-items:center;gap:.7rem;margin:0 0 var(--s-5);padding:.75rem .85rem;border:1px solid var(--border);border-radius:var(--r-md);background:var(--glass-1);color:var(--text-2);font-size:.78rem}
.list-state[hidden]{display:none}
.list-state.warning{border-color:color-mix(in srgb,var(--amber) 35%,var(--border));background:var(--amber-soft);color:var(--amber)}
.list-state.error{border-color:color-mix(in srgb,var(--red) 35%,var(--border));background:var(--red-soft);color:var(--red)}
.list-state-copy{flex:1;min-width:0}.list-state-copy b{display:block;color:currentColor}.list-state-copy span{display:block;margin-top:.12rem;opacity:.8}
.list-state button{min-height:34px;padding:.35rem .65rem;border:1px solid currentColor;border-radius:var(--r-sm);background:transparent;color:inherit;font:650 .72rem var(--font);cursor:pointer}
.loading-dot{width:9px;height:9px;flex:0 0 auto;border-radius:50%;background:var(--accent);box-shadow:0 0 0 4px var(--accent-soft);animation:live-pulse 1.4s ease-in-out infinite}
.content-section>.section-label{margin:0 0 var(--s-3);font-size:.68rem}
.live-band{margin-bottom:var(--s-7);border-color:var(--border);background:color-mix(in srgb,var(--surface) 76%,transparent);box-shadow:var(--hi)}
.live-band::before{width:2px}
.live-band-head{margin:var(--s-3) var(--s-4) var(--s-2)}
.agent-group-head{padding:.6rem .85rem .3rem}
.session-grid{border-color:var(--border);background:color-mix(in srgb,var(--surface) 72%,transparent)}
.session-card{min-height:70px;padding:.8rem .9rem;gap:.8rem}
.session-card:hover{background:color-mix(in srgb,var(--accent) 5%,var(--glass-1))}
.session-card:focus-within{background:var(--glass-1)}
.session-card:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.session-card-meta{gap:.42rem}
.session-card-meta code{max-width:min(420px,42vw);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.session-card-actions{opacity:1;align-items:center}
.open-hint{display:inline-flex;align-items:center;gap:.25rem;color:var(--text-3);font-size:.68rem}
.card-menu{position:relative}
.card-menu>summary{display:grid;place-items:center;width:34px;height:34px;border:1px solid transparent;border-radius:var(--r-sm);list-style:none;color:var(--text-3);font-size:1.15rem;cursor:pointer}
.card-menu>summary::-webkit-details-marker{display:none}
.card-menu>summary:hover,.card-menu[open]>summary{border-color:var(--border);background:var(--glass-2);color:var(--text)}
.card-menu[open] .card-menu-popover{display:flex}
.card-menu-popover{position:absolute;right:0;top:calc(100% + 5px);z-index:25;display:none;flex-direction:column;gap:2px;min-width:168px;padding:5px;border:1px solid var(--border);border-radius:var(--r-md);background:var(--surface);box-shadow:var(--e2)}
.card-menu-popover .btn-sm,.card-menu-popover .pr-link{display:flex;width:100%;min-height:36px;align-items:center;justify-content:flex-start;padding:.45rem .6rem;border:0;border-radius:var(--r-sm);background:transparent;color:var(--text-2);font-size:.74rem;text-decoration:none}
.card-menu-popover .btn-sm:hover,.card-menu-popover .pr-link:hover{background:var(--glass-hover);color:var(--text);text-decoration:none}
.card-menu-popover .danger:hover{background:var(--red-soft);color:var(--red)}
.session-card.needs-input .session-card-actions{gap:5px}
.session-card.needs-input .card-menu{margin-left:2px}

@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

@media(max-width:600px){
  .list-container{padding:0 10px max(18px,env(safe-area-inset-bottom))}
  .page-top{position:sticky;top:0;z-index:20;margin:0 -10px 12px;padding:max(8px,env(safe-area-inset-top)) 10px 8px;background:color-mix(in srgb,var(--bg-0) 88%,transparent);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border-bottom:1px solid var(--border);align-items:center}
  .page-nav-toggle{display:flex}
  .page-title{font-size:1.05rem}.page-title .brand-mark{width:28px;height:28px;border-radius:8px}.page-sub{display:none}
  .icon-btn{width:44px;height:44px;margin-top:0}.page-actions .btn-new,.page-actions .btn-spawn,.page-actions .theme-toggle{width:44px;min-width:44px;min-height:44px;height:44px;padding:0;font-size:0;justify-content:center;gap:0}.page-actions .btn-new svg,.page-actions .btn-spawn svg{display:block}
  .stats,.summary{justify-content:flex-start;margin-bottom:10px;font-size:.72rem;padding:.45rem .7rem}
  .section-label{margin:7px 3px;font-size:.65rem}
  .live-band{margin-bottom:14px}.live-band .section-label{margin:10px 12px 6px}
  .session-card{padding:10px 8px}.session-card:active{background:var(--glass-2)}
  .agent-mark{width:32px;height:32px}
  .session-card-title{font-size:.86rem;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.session-card-meta{font-size:.66rem;gap:5px}.session-card-meta code{font-size:.64rem}
  .chip{position:absolute;right:8px;top:10px;font-size:.55rem}.session-card-info{padding-right:44px}
  .session-card-actions{opacity:1}.session-card-actions .btn-sm.pr{font-size:0;width:38px;height:38px;padding:0;border-radius:12px;display:grid;place-items:center}.session-card-actions .btn-sm.pr:after{content:'›';font-size:1.3rem}
  .session-card-actions .btn-sm.danger{font-size:0;width:38px;height:38px;padding:0;border-radius:12px;display:grid;place-items:center}.session-card-actions .btn-sm.danger:after{content:'×';font-size:1.2rem}
  .session-card-actions .btn-sm.approve{min-height:38px;padding:.4rem .7rem;font-size:.72rem}
  .session-card:not(.live) .session-card-actions{display:none}
  .session-card.needs-input{flex-wrap:wrap}.session-card.needs-input .session-card-actions{width:100%;justify-content:flex-end;margin-top:4px}
  .empty-state{padding:var(--s-8) var(--s-4)}
  .page-title .brand-mark{display:none}
  .page-actions .btn-new{width:auto;min-width:44px;padding:0 13px;font-size:.76rem;gap:6px}
  .page-actions .btn-new svg{display:block}
  .page-menu-trigger{width:40px;height:40px}
  .page-menu-popover{right:0;width:min(230px,calc(100vw - 24px))}
  .page-actions .page-menu-popover .btn-spawn,.page-actions .page-menu-popover .menu-action{width:100%;min-width:0;height:auto;min-height:42px;justify-content:flex-start;gap:10px;padding:.58rem .7rem;font-size:.8rem}
  .overview-bar{grid-template-columns:1fr;gap:.45rem;margin-bottom:16px;padding:.65rem .75rem}
  .overview-bar .cost-strip{justify-content:flex-start;white-space:normal}
  .cost-strip .cost-src{margin-left:auto}
  .content-section{margin-bottom:18px}
  .session-card{min-height:66px;padding:10px}
  .session-card-info{padding-right:0}
  .chip{position:static}
  .session-card-actions{display:flex!important}
  .session-card-actions>.open-hint{display:none}
  .session-card-actions>.btn-sm:not(.approve){display:none}
  .card-menu-popover .btn-sm,.card-menu-popover .pr-link{display:flex}
  .session-card-actions .card-menu-popover .btn-sm.pr,.session-card-actions .card-menu-popover .btn-sm.danger{display:flex;width:100%;height:auto;min-height:38px;place-items:initial;padding:.45rem .6rem;font-size:.74rem}
  .session-card-actions .card-menu-popover .btn-sm.pr:after,.session-card-actions .card-menu-popover .btn-sm.danger:after{content:none}
  .session-card-meta code{max-width:55vw}
}

/* ─── Design refinement pass (2026-07) ──────────────────────────────────
   Layered last, over the 2026 workspace refresh. Thesis: more depth and
   finish through elevation, hairline highlights, rhythm and crisper micro-
   typography — NOT more colour (honours the neutral-platform system).      */

/* Header — a soft sheen on the brand mark; sub copy a touch more legible */
.page-title{letter-spacing:-.035em}
.page-title .brand-mark{background:linear-gradient(150deg,color-mix(in srgb,var(--accent) 20%,var(--surface)),var(--surface));border-color:color-mix(in srgb,var(--accent) 30%,var(--border));box-shadow:var(--hi),0 1px 2px rgba(0,0,0,.2)}
.page-sub{color:var(--text-2);opacity:.9}

/* Overview bar — a hint more presence, tabular figures for the counts/spend */
.overview-bar{background:linear-gradient(180deg,color-mix(in srgb,var(--surface) 88%,transparent),color-mix(in srgb,var(--surface) 72%,transparent));box-shadow:var(--e1),var(--hi)}
.summary,.summary b,.cost-strip .cost-main,.cost-strip .cost-sub{font-variant-numeric:tabular-nums}
.cost-breakdown-link,.cost-strip .cost-src{transition:color var(--t)}

/* Section labels — quieter, slightly wider tracking for a formal rhythm */
.section-label{letter-spacing:.09em;color:var(--text-3)}

/* Grids — a defined resting elevation so cards read as one surface */
.session-grid{box-shadow:var(--e1),var(--hi)}
.live-band{box-shadow:var(--e1),var(--hi)}

/* Cards — calm hover finish: an accent hairline reveals on the left edge and
   the row lifts its surface, instead of a flat background swap. */
.session-card{position:relative;transition:background var(--t),box-shadow var(--t)}
.session-card::before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:2px;border-radius:2px;background:var(--accent);opacity:0;transform:scaleY(.4);transform-origin:center;transition:opacity var(--t),transform var(--t-slow)}
.session-card:hover::before,.session-card:focus-within::before{opacity:.7;transform:scaleY(1)}
.session-card.needs-input::before{opacity:.9;background:var(--amber);transform:scaleY(1)}
.live-band .session-card.live::before{background:var(--green)}
.live-band .session-card.live.needs-input::before{background:var(--amber)}
.session-card:hover{box-shadow:var(--hi),inset 0 0 0 1px color-mix(in srgb,var(--accent) 12%,transparent)}

/* Agent mark — subtle inner highlight so the tile reads as a raised chip */
.agent-mark{box-shadow:var(--hi);transition:transform var(--t)}
.session-card:hover .agent-mark{transform:translateY(-1px)}
.presence{box-shadow:0 0 0 2px var(--surface),0 0 8px color-mix(in srgb,var(--green) 55%,transparent)}

/* Title & metadata — a bit more contrast on the working data */
.session-card-title{letter-spacing:-.015em}
.session-card-meta{color:var(--text-2)}
.session-card-meta .sep{color:var(--text-3)}

/* Status chips — hairline definition + tabular, so they read as instruments */
.chip{padding:.26em .7em;border:1px solid transparent;font-variant-numeric:tabular-nums;box-shadow:var(--hi)}
.chip:before{width:6px;height:6px}
.chip.working{border-color:color-mix(in srgb,var(--green) 30%,transparent)}
.chip.attention,.chip.detached{border-color:color-mix(in srgb,var(--amber) 32%,transparent)}
.chip.wrapping,.chip.completed{border-color:color-mix(in srgb,var(--accent) 30%,transparent)}
.chip.error{border-color:color-mix(in srgb,var(--red) 32%,transparent)}

/* Context / usage meter — crisper track, rounded fill, tabular label tucked
   right up against the bar rather than floating away from it. */
.usage-mini{max-width:300px;gap:.55rem;margin-top:.5rem}
.usage-mini .track{height:6px;background:color-mix(in srgb,var(--text) 8%,transparent);box-shadow:inset 0 0 0 1px var(--border)}
.usage-mini .track i{box-shadow:0 0 8px -1px color-mix(in srgb,var(--accent) 55%,transparent)}
.usage-mini .lbl{font-variant-numeric:tabular-nums;color:var(--text-2);font-weight:600;letter-spacing:.01em;flex-shrink:0}

/* Live status / task lines — clearer label, calmer body */
.task-excerpt b{color:var(--text-2)}
.live-status{color:var(--text-2)}

/* Open affordance — the chevron drifts on hover to signal "enter" */
.open-hint{transition:color var(--t),gap var(--t);color:var(--text-3)}
.open-hint svg{transition:transform var(--t-slow)}
.session-card:hover .open-hint{color:var(--accent)}
.session-card:hover .open-hint svg{transform:translateX(3px)}

/* Buttons — springier primary, defined secondary hover */
.btn-new{transition:filter var(--t),transform var(--t),box-shadow var(--t)}
.btn-new:hover{box-shadow:var(--e2),0 0 0 1px color-mix(in srgb,var(--accent) 40%,transparent)}
.btn-sm{transition:background var(--t),color var(--t),border-color var(--t)}

/* Loading & empty — more considered resting states */
.loading-dot{box-shadow:0 0 0 4px var(--accent-soft),0 0 12px -2px var(--accent)}
.empty-state{background:linear-gradient(180deg,var(--glass-1),transparent)}
.empty-state .ico{background:linear-gradient(150deg,color-mix(in srgb,var(--accent) 22%,var(--surface)),var(--surface));color:var(--accent);border:1px solid color-mix(in srgb,var(--accent) 28%,var(--border));box-shadow:var(--e1),var(--hi)}

/* Living workspace — hierarchy follows urgency, not database shape. */
.page-eyebrow{margin-bottom:.2rem;color:var(--accent);font-size:.6rem;font-weight:750;letter-spacing:.13em;text-transform:uppercase}
.page-title{font-weight:740}
.page-sub{font-size:.8rem}
.overview-bar{position:relative;overflow:hidden}
.overview-bar::after{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at 82% -120%,color-mix(in srgb,var(--accent) 14%,transparent),transparent 48%)}
.overview-bar>*{position:relative;z-index:1}
.section-label{min-height:24px}
.section-count{display:inline-grid;place-items:center;min-width:1.45rem;height:1.45rem;padding:0 .38rem;border:1px solid var(--border);border-radius:var(--r-full);background:var(--glass-1);color:var(--text-2);font-size:.6rem;font-variant-numeric:tabular-nums;letter-spacing:0}
.live-band-head .section-count{border-color:color-mix(in srgb,var(--green) 24%,var(--border));background:var(--green-soft);color:var(--green)}
.live-status{display:flex;align-items:flex-start;gap:.45rem;margin-top:.5rem;color:var(--text);font-size:.72rem;font-weight:560}
.live-status::before{content:"";width:5px;height:5px;margin-top:.42em;border-radius:50%;background:var(--accent);box-shadow:0 0 8px color-mix(in srgb,var(--accent) 58%,transparent);flex:0 0 auto}
.session-card.live.needs-input .live-status::before{background:var(--amber);box-shadow:0 0 8px color-mix(in srgb,var(--amber) 58%,transparent)}
.session-card.live{contain:paint}
.session-card.needs-input{box-shadow:inset 3px 0 0 color-mix(in srgb,var(--amber) 72%,transparent)}
.cost-main,.cost-sub{letter-spacing:-.015em}
@media(max-width:600px){
  .page-eyebrow{display:none}
  .section-count{min-width:1.3rem;height:1.3rem}
  .live-status{font-size:.68rem}
}
</style>
</head>
<body>
<div class="list-container">
  <div class="page-top">
    <button class="icon-btn page-nav-toggle" type="button" onclick="document.body.classList.toggle('sb-open')" aria-label="Toggle navigation">${icon('menu', { size: 18 })}</button>
    <div class="page-head">
      <div class="page-eyebrow">Workspace</div>
      <div class="page-title"><span class="brand-mark">${icon('terminal', { size: 18 })}</span> Code Agent</div>
      <p class="page-sub">A focused view of every agent, handoff, and branch in motion.</p>
    </div>
    <div class="page-actions">
      <button class="btn-new" id="btn-spawn" title="Start a live agent in tmux">${icon('zap', { size: 16 })} Live agent</button>
      <details class="page-menu" id="page-menu">
        <summary class="icon-btn page-menu-trigger" title="More actions" aria-label="More actions">•••</summary>
        <div class="page-menu-popover">
          <button class="menu-action" id="btn-new" type="button">${icon('plus', { size: 16 })} New chat</button>
          <button class="menu-action" id="btn-new-group" type="button">${icon('folder', { size: 16 })} New group</button>
          <button class="menu-action" id="btn-refresh" type="button">${icon('refresh', { size: 16 })} Refresh sessions</button>
        </div>
      </details>
    </div>
  </div>

  <div class="overview-bar" style="display:none">
    <div class="summary" id="stats"></div>
    <div class="cost-strip" id="cost-strip" style="display:none"></div>
  </div>
  <div class="list-state" id="list-state"><span class="loading-dot"></span><div class="list-state-copy"><b>Loading sessions</b><span>Checking live agents and saved chats…</span></div></div>
  <div class="live-band" id="live-band" style="display:none">
    <div class="live-band-head">
      <div class="section-label" id="live-label"><span class="live-pulse"></span>Now <span class="section-count" id="live-count">0</span></div>
      <button class="btn-group" id="btn-band-group" type="button" title="Create a group">${icon('folder', { size: 14 })} Group</button>
    </div>
    <div class="session-grid" id="live-sessions"></div>
  </div>
  <div class="schedule-band" id="schedule-band" style="display:none">
    <div class="schedule-band-head">
      <div class="section-label">Scheduled <span class="section-count" id="schedule-count">0</span></div>
    </div>
    <div class="schedule-list" id="schedule-list"></div>
  </div>
  <section class="content-section" id="chats-section" style="display:none">
    <div class="section-label" id="chats-label">Chats <span class="section-count" id="chats-count">0</span></div>
    <div class="session-grid" id="chat-sessions"></div>
  </section>
  <div class="empty-state" id="empty" style="display:none">
    <div class="ico">${icon('terminal', { size: 26 })}</div>
    <h2>No agents yet</h2>
    <p>Start a live agent in tmux, or open a chat session with its own git branch and worktree.</p>
    <button class="btn-new" onclick="document.getElementById('btn-spawn').click()">${icon('zap', { size: 16 })} Live agent</button>
  </div>
</div>

<!-- Create modal -->
<div class="modal-overlay" id="modal">
  <div class="modal-card">
    <div class="modal-title">${icon('plus', { size: 18 })} New chat</div>
    <div class="form-group">
      <label class="form-label">Base branch</label>
      <select class="form-select" id="input-base-branch">
        <option value="">Loading branches…</option>
      </select>
    </div>
    <p class="form-hint">Branch name and title will be generated from your first message.</p>
    <div class="modal-actions">
      <button class="btn-cancel" id="btn-cancel">Cancel</button>
      <button class="btn-create" id="btn-create">Start chat</button>
    </div>
  </div>
</div>

<!-- Spawn live agent modal -->
<div class="modal-overlay" id="spawn-modal">
  <div class="modal-card">
    <div class="modal-title">${icon('zap', { size: 18 })} New live agent</div>
    <div class="spawn-steps" id="spawn-steps" aria-hidden="true"></div>

    <div class="spawn-panel" data-step="0" id="spawn-step-provider">
      <div class="form-group">
        <label class="form-label">Provider</label>
        <div class="provider-grid" id="provider-grid"></div>
      </div>
    </div>

    <div class="spawn-panel" data-step="1" id="spawn-step-settings" hidden>
      <div class="form-group">
        <label class="form-label">Permissions</label>
        <div class="perm-grid" id="spawn-perm-grid"></div>
      </div>
      <div class="form-group" id="spawn-model-group" hidden>
        <label class="form-label">Model</label>
        <select class="form-input" id="spawn-model"></select>
        <p class="form-hint" id="spawn-model-hint" style="margin-top:.35rem">Cloud model catalog for this provider.</p>
      </div>
      <div class="form-group">
        <label class="form-label">Working directory</label>
        <input class="form-input" id="input-cwd" value="/root" spellcheck="false" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="form-label">Display title <span style="font-weight:500;color:var(--text-3)">(optional)</span></label>
        <input class="form-input" id="input-spawn-title" placeholder="e.g. Nightly auth audit" spellcheck="true" autocomplete="off" style="font-family:var(--font)">
      </div>
    </div>

    <div class="spawn-panel" data-step="2" id="spawn-step-prompt" hidden>
      <div class="form-group">
        <label class="form-label">Initial prompt <span id="spawn-prompt-req" style="font-weight:500;color:var(--text-3)">(optional for now)</span></label>
        <textarea class="form-textarea" id="input-spawn-prompt" placeholder="What should this agent do when it starts?"></textarea>
        <p class="form-hint" style="margin-top:.35rem">Seeded after the CLI is ready — same path ticket-repair uses.</p>
      </div>
    </div>

    <div class="spawn-panel" data-step="3" id="spawn-step-when" hidden>
      <div class="form-group">
        <label class="form-label">When</label>
        <div class="when-grid" id="spawn-when-grid">
          <button type="button" class="when-card selected" data-when="now"><b>Start now</b><small>Spawn immediately and open the live session</small></button>
          <button type="button" class="when-card" data-when="schedule"><b>Schedule</b><small>One-shot delayed start at a chosen time</small></button>
        </div>
      </div>
      <div class="form-group" id="spawn-runat-group" hidden>
        <label class="form-label">Run at</label>
        <input class="form-input" id="input-spawn-runat" type="datetime-local" style="font-family:var(--font)">
        <p class="form-hint" style="margin-top:.35rem">Local time. Must be at least 30 seconds ahead. Survives dashboard restarts.</p>
      </div>
    </div>

    <p class="spawn-error" id="spawn-error"></p>
    <div class="modal-actions">
      <button class="btn-cancel" id="btn-spawn-cancel">Cancel</button>
      <button class="btn-cancel" id="btn-spawn-back" hidden>Back</button>
      <button class="btn-create" id="btn-spawn-next" disabled>Continue</button>
      <button class="btn-create" id="btn-spawn-start" hidden disabled>Start agent</button>
    </div>
  </div>
</div>

<script>
(function(){
  var liveEl = document.getElementById('live-sessions');
  var chatsEl = document.getElementById('chat-sessions');
  var emptyEl = document.getElementById('empty');
  var statsEl = document.getElementById('stats');
  var overviewBar = document.querySelector('.overview-bar');
  var liveBand = document.getElementById('live-band');
  var liveCount = document.getElementById('live-count');
  var chatsLabel = document.getElementById('chats-label');
  var chatsCount = document.getElementById('chats-count');
  var chatsSection = document.getElementById('chats-section');
  var modal = document.getElementById('modal');
  var inputBaseBranch = document.getElementById('input-base-branch');
  var btnNew = document.getElementById('btn-new');
  var btnCancel = document.getElementById('btn-cancel');
  var btnCreate = document.getElementById('btn-create');
  var sessions = [];
  var agentGroups = [];
  var costOverview = null;
  var scheduledAgents = [];
  var spawnModal = document.getElementById('spawn-modal');
  var providerGrid = document.getElementById('provider-grid');
  var inputCwd = document.getElementById('input-cwd');
  var inputSpawnTitle = document.getElementById('input-spawn-title');
  var inputSpawnPrompt = document.getElementById('input-spawn-prompt');
  var inputSpawnRunAt = document.getElementById('input-spawn-runat');
  var spawnPromptReq = document.getElementById('spawn-prompt-req');
  var spawnRunAtGroup = document.getElementById('spawn-runat-group');
  var spawnWhenGrid = document.getElementById('spawn-when-grid');
  var spawnStepsEl = document.getElementById('spawn-steps');
  var spawnError = document.getElementById('spawn-error');
  var btnSpawnStart = document.getElementById('btn-spawn-start');
  var btnSpawnNext = document.getElementById('btn-spawn-next');
  var btnSpawnBack = document.getElementById('btn-spawn-back');
  var selectedProvider = null;
  var selectedPermMode = null;
  var selectedModel = null;
  var selectedWhen = 'now';
  var spawnStep = 0;
  var SPAWN_STEP_LABELS = ['Provider', 'Settings', 'Prompt', 'When'];
  var spawnPermGrid = document.getElementById('spawn-perm-grid');
  var spawnModelGroup = document.getElementById('spawn-model-group');
  var spawnModelSelect = document.getElementById('spawn-model');
  var spawnModelHint = document.getElementById('spawn-model-hint');
  var costStrip = document.getElementById('cost-strip');
  var pageMenu = document.getElementById('page-menu');
  var listState = document.getElementById('list-state');
  var scheduleBand = document.getElementById('schedule-band');
  var scheduleList = document.getElementById('schedule-list');
  var scheduleCount = document.getElementById('schedule-count');
  var SPAWN_PROVIDERS = [
    { kind: 'claude', label: 'Claude', command: 'claude', modes: [
      { id: 'auto', label: 'Auto', description: 'Dash auto-approves permission prompts', needsConfirm: true },
      { id: 'ask', label: 'Ask', description: 'Confirm before tools run' },
      { id: 'plan', label: 'Plan', description: 'Read-only planning — propose changes, no edits' }
    ]},
    { kind: 'codex', label: 'Codex', command: 'codex', modes: [
      { id: 'auto', label: 'Auto', description: 'Dash auto-approves approval prompts', needsConfirm: true },
      { id: 'ask', label: 'Ask', description: 'Approve commands on request' }
    ]},
    { kind: 'kimi', label: 'Kimi', command: 'kimi', modes: [
      { id: 'yolo', label: 'Yolo', description: 'Dash auto-approves all actions', needsConfirm: true },
      { id: 'ask', label: 'Ask', description: 'Confirm before actions' },
      { id: 'plan', label: 'Plan', description: 'Read-only plan mode' }
    ]},
    { kind: 'cursor', label: 'Cursor', command: 'agent', modes: [
      { id: 'yolo', label: 'Run Everything', description: 'Force-allow all commands', needsConfirm: true },
      { id: 'auto', label: 'Auto', description: 'Smart auto-review for safe calls', needsConfirm: true },
      { id: 'ask', label: 'Ask', description: 'Prompt for each command' },
      { id: 'plan', label: 'Plan', description: 'Read-only planning — analyze and propose, no edits' }
    ]},
    { kind: 'opencode', label: 'OpenCode Go', command: 'opencode', modes: [
      { id: 'auto', label: 'Auto', description: 'Build agent — tools allowed', needsConfirm: true },
      { id: 'ask', label: 'Ask', description: 'Build agent — confirm external dirs' },
      { id: 'plan', label: 'Plan', description: 'Plan agent — read-only' }
    ], models: [
      'deepseek-v4-flash','deepseek-v4-pro','glm-5','glm-5.1','glm-5.2','grok-4.5','hy3','hy3-preview',
      'kimi-k2.5','kimi-k2.6','kimi-k2.7-code','kimi-k3','mimo-v2-omni','mimo-v2-pro','mimo-v2.5','mimo-v2.5-pro',
      'minimax-m2.5','minimax-m2.7','minimax-m3','qwen3.5-plus','qwen3.6-plus','qwen3.7-max','qwen3.7-plus'
    ], defaultModel: 'deepseek-v4-flash' },
    { kind: 'ollama', label: 'Ollama Cloud', command: 'opencode', modes: [
      { id: 'auto', label: 'Auto', description: 'Build agent — tools allowed', needsConfirm: true },
      { id: 'ask', label: 'Ask', description: 'Build agent — confirm external dirs' },
      { id: 'plan', label: 'Plan', description: 'Plan agent — read-only' }
    ], models: [
      'deepseek-v4-flash','deepseek-v4-pro','gemma4:31b','glm-5.1','glm-5.2','gpt-oss:20b','gpt-oss:120b',
      'kimi-k2.5','kimi-k2.6','kimi-k2.7-code','minimax-m2.5','minimax-m2.7','minimax-m3',
      'mistral-large-3:675b','nemotron-3-nano:30b','nemotron-3-super','nemotron-3-ultra','qwen3.5:397b'
    ], defaultModel: 'deepseek-v4-flash' }
  ];

  function currentSpawnProvider() {
    return SPAWN_PROVIDERS.find(function(p) { return p.kind === selectedProvider; }) || null;
  }

  function renderSpawnModels() {
    var provider = currentSpawnProvider();
    var models = provider && provider.models ? provider.models : [];
    if (!models.length) {
      spawnModelGroup.hidden = true;
      selectedModel = null;
      spawnModelSelect.innerHTML = '';
      return;
    }
    spawnModelGroup.hidden = false;
    if (!selectedModel || models.indexOf(selectedModel) === -1) {
      selectedModel = provider.defaultModel && models.indexOf(provider.defaultModel) !== -1
        ? provider.defaultModel
        : models[0];
    }
    spawnModelSelect.innerHTML = models.map(function(id) {
      return '<option value="' + escapeHtml(id) + '"' + (id === selectedModel ? ' selected' : '') + '>' + escapeHtml(id) + '</option>';
    }).join('');
    spawnModelHint.textContent = models.length + ' models · ' + (provider.kind === 'ollama' ? 'ollama-cloud/' : 'opencode-go/') + selectedModel;
  }

  function refreshSpawnOptions(kind) {
    if (!kind || (kind !== 'ollama' && kind !== 'opencode')) return;
    fetch('/api/code/tmux/spawn-options?provider=' + encodeURIComponent(kind))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data || data.error || selectedProvider !== kind) return;
        var provider = currentSpawnProvider();
        if (!provider) return;
        if (Array.isArray(data.modes) && data.modes.length) {
          provider.modes = data.modes.map(function(m) {
            return {
              id: m.id,
              label: m.label,
              description: m.description,
              needsConfirm: !!m.needsConfirm
            };
          });
        }
        if (Array.isArray(data.models) && data.models.length) {
          provider.models = data.models.map(function(m) { return m.id || m; }).filter(Boolean);
          if (data.defaultModel) provider.defaultModel = data.defaultModel;
        }
        renderSpawnPerms();
        renderSpawnModels();
      })
      .catch(function() { /* keep static catalog */ });
  }

  function renderSpawnPerms() {
    var provider = currentSpawnProvider();
    if (!provider) {
      spawnPermGrid.innerHTML = '<p class="form-hint" style="margin:0">Pick a provider to choose permissions.</p>';
      return;
    }
    if (!selectedPermMode || !provider.modes.some(function(m) { return m.id === selectedPermMode; })) {
      selectedPermMode = provider.modes[0].id;
    }
    spawnPermGrid.innerHTML = provider.modes.map(function(m) {
      return '<button type="button" class="perm-card' + (selectedPermMode === m.id ? ' selected' : '') + '" data-mode="' + m.id + '">' +
        '<b>' + m.label + '</b><small>' + m.description + '</small></button>';
    }).join('');
    spawnPermGrid.querySelectorAll('.perm-card').forEach(function(card) {
      card.onclick = function() {
        selectedPermMode = card.getAttribute('data-mode');
        renderSpawnPerms();
      };
    });
  }

  function renderSpawnWhen() {
    spawnWhenGrid.querySelectorAll('.when-card').forEach(function(card) {
      var on = card.getAttribute('data-when') === selectedWhen;
      card.classList.toggle('selected', on);
    });
    spawnRunAtGroup.hidden = selectedWhen !== 'schedule';
    spawnPromptReq.textContent = selectedWhen === 'schedule' ? '(required)' : '(optional for now)';
    updateSpawnPrimaryLabel();
  }

  function defaultRunAtLocalValue() {
    var d = new Date(Date.now() + 5 * 60 * 1000);
    d.setSeconds(0, 0);
    var pad = function(n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function runAtToIso(localValue) {
    if (!localValue) return null;
    var d = new Date(localValue);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function updateSpawnPrimaryLabel() {
    if (selectedWhen === 'schedule') btnSpawnStart.textContent = 'Schedule agent';
    else btnSpawnStart.textContent = 'Start agent';
  }

  function renderSpawnSteps() {
    spawnStepsEl.innerHTML = SPAWN_STEP_LABELS.map(function(label, i) {
      var cls = 'spawn-step-pill' + (i === spawnStep ? ' active' : (i < spawnStep ? ' done' : ''));
      return '<span class="' + cls + '"><span class="spawn-step-num">' + (i + 1) + '</span>' + label + '</span>';
    }).join('');
    document.querySelectorAll('.spawn-panel').forEach(function(panel) {
      var step = Number(panel.getAttribute('data-step'));
      panel.hidden = step !== spawnStep;
    });
    btnSpawnBack.hidden = spawnStep === 0;
    btnSpawnNext.hidden = spawnStep >= SPAWN_STEP_LABELS.length - 1;
    btnSpawnStart.hidden = spawnStep < SPAWN_STEP_LABELS.length - 1;
    if (spawnStep === 0) btnSpawnNext.disabled = !selectedProvider;
    else btnSpawnNext.disabled = false;
    if (spawnStep === SPAWN_STEP_LABELS.length - 1) {
      btnSpawnStart.disabled = !selectedProvider;
      updateSpawnPrimaryLabel();
    }
  }

  function resetSpawnWizard() {
    selectedProvider = null;
    selectedPermMode = null;
    selectedModel = null;
    selectedWhen = 'now';
    spawnStep = 0;
    inputCwd.value = '/root';
    inputSpawnTitle.value = '';
    inputSpawnPrompt.value = '';
    inputSpawnRunAt.value = defaultRunAtLocalValue();
    spawnError.classList.remove('show');
    spawnError.textContent = '';
    btnSpawnStart.disabled = true;
    updateSpawnPrimaryLabel();
    renderProviderGrid();
    renderSpawnPerms();
    renderSpawnModels();
    renderSpawnWhen();
    renderSpawnSteps();
  }

  function buildSpawnPayload() {
    var provider = currentSpawnProvider();
    var payload = {
      provider: selectedProvider,
      cwd: inputCwd.value.trim() || '/root',
      permissionMode: selectedPermMode || undefined
    };
    if (provider && provider.models && provider.models.length) {
      payload.model = selectedModel || provider.defaultModel || provider.models[0];
    }
    var title = inputSpawnTitle.value.trim();
    if (title) payload.title = title;
    var prompt = inputSpawnPrompt.value.trim();
    if (prompt) payload.prompt = prompt;
    return payload;
  }

  function logoSVG(kind) {
    if (kind === 'claude') return '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 2.5v19M2.5 12h19M5.3 5.3l13.4 13.4M18.7 5.3L5.3 18.7"/></svg>';
    if (kind === 'codex') return '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><ellipse cx="12" cy="7.2" rx="3.1" ry="4.8"/><ellipse cx="12" cy="7.2" rx="3.1" ry="4.8" transform="rotate(60 12 12)"/><ellipse cx="12" cy="7.2" rx="3.1" ry="4.8" transform="rotate(120 12 12)"/></svg>';
    if (kind === 'cursor') return '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>';
    if (kind === 'kimi') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="16.5" cy="7.5" r="3.3" fill="currentColor" stroke="none"/><path d="M13.4 10.6 4 20"/><path d="M16 12.6 9.8 18.8"/><path d="M11.4 8 5.2 14.2"/></svg>';
    if (kind === 'opencode') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16v10H4z"/><path d="M8 7V5a4 4 0 0 1 8 0v2"/><circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/></svg>';
    if (kind === 'ollama') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><circle cx="9" cy="11" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="11" r="1.1" fill="currentColor" stroke="none"/><path d="M9.2 14.2c.8.9 1.7 1.3 2.8 1.3s2-.4 2.8-1.3"/></svg>';
    if (kind === 'gemini') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c.6 5.5 4.5 9.4 10 10-5.5.6-9.4 4.5-10 10-.6-5.5-4.5-9.4-10-10 5.5-.6 9.4-4.5 10-10z"/></svg>';
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 17l6-6-6-6M12 19h8"/></svg>';
  }

  // ── Fetch sessions ──────────────────────────────────────
  function showListState(kind, title, detail, retry) {
    listState.hidden = false;
    listState.className = 'list-state' + (kind ? ' ' + kind : '');
    listState.innerHTML =
      (kind === 'loading' ? '<span class="loading-dot"></span>' : '') +
      '<div class="list-state-copy"><b>' + escapeHtml(title) + '</b><span>' + escapeHtml(detail || '') + '</span></div>' +
      (retry ? '<button type="button" id="list-retry">Retry</button>' : '');
    var retryButton = document.getElementById('list-retry');
    if (retryButton) retryButton.onclick = function() { showListState('loading', 'Loading sessions', 'Trying again…'); load(); };
  }

  function load() {
    return Promise.all([
      fetch('/api/code/sessions', { cache: 'no-store' }).then(function(r) {
        if (!r.ok) return r.json().catch(function() { return {}; }).then(function(data) { throw new Error(data.error || 'HTTP ' + r.status); });
        return r.json();
      }),
      fetch('/api/code/tmux/schedules', { cache: 'no-store' }).then(function(r) {
        if (!r.ok) return { schedules: [] };
        return r.json().catch(function() { return { schedules: [] }; });
      }).catch(function() { return { schedules: [] }; })
    ]).then(function(results) {
      var data = results[0] || {};
      var scheduleData = results[1] || {};
      sessions = data.sessions || [];
      agentGroups = data.groups || [];
      scheduledAgents = (scheduleData.schedules || []).filter(function(s) {
        return s.status === 'pending' || s.status === 'running';
      });
      if (data.costs) costOverview = data.costs;
      render();
      if (data.warning) showListState('warning', 'Saved chats unavailable', data.warning, true);
      else listState.hidden = true;
    }).catch(function(error) {
      showListState('error', 'Could not load sessions', error.message || 'Please try again.', true);
    });
  }

  function loadCosts() {
    fetch('/api/code/costs', { cache: 'no-store' }).then(function(r) { return r.json(); }).then(function(data) {
      if (data && data.today) {
        costOverview = data;
        render();
      }
    }).catch(function() {});
  }

  function liveCard(s) {
    var time = timeAgo(new Date(s.updatedAt));
    var working = s.activity === 'working';
    var detached = !!s.externalProcess;
    var kind = s.kind || 'codex';
    var needsInput = !!s.needsInput && !detached;
    var usageHtml = '';
    if (s.usage && isFinite(s.usage.percent)) {
      usageHtml = '<div class="usage-mini' + (s.usage.direction === 'remaining' ? ' remaining' : '') + '">' +
        '<span class="track"><i style="width:' + Math.max(2, Math.round(s.usage.percent)) + '%"></i></span>' +
        '<span class="lbl">' + escapeHtml(s.usage.label || '') + '</span></div>';
    } else if (s.usage && s.usage.label) {
      usageHtml = '<div class="usage-mini"><span class="lbl">' + escapeHtml(s.usage.label) + '</span></div>';
    }
    var chip = needsInput
      ? '<span class="chip attention">Input needed</span>'
      : (s.wrapUp && s.wrapUp.ready
        ? '<span class="chip ready-close">Ready to close</span>'
        : (s.wrapUp
          ? '<span class="chip wrapping">Wrapping up</span>'
          : (working
            ? '<span class="chip working">Working</span>'
            : (detached ? '<span class="chip detached">Detached</span>' : ''))));
    var approveHtml = needsInput
      ? '<button class="btn-sm approve" onclick="event.stopPropagation();approveAgent(\\'' + s.sessionId + '\\',\\'y\\')">Approve</button>' +
        '<button class="btn-sm" onclick="event.stopPropagation();approveAgent(\\'' + s.sessionId + '\\',\\'n\\')">Deny</button>'
      : '';
    var endHtml = (s.wrapUp && s.wrapUp.ready)
      ? '<button class="btn-sm danger" onclick="event.stopPropagation();terminateAgent(\\'' + s.sessionId + '\\',true)">Close session</button>'
      : (s.wrapUp
        ? '<button class="btn-sm danger" onclick="event.stopPropagation();terminateAgent(\\'' + s.sessionId + '\\',true)">Force end now</button>'
        : '<button class="btn-sm danger" onclick="event.stopPropagation();terminateAgent(\\'' + s.sessionId + '\\',false)">End session</button>' +
          (detached ? '' : '<button class="btn-sm" onclick="event.stopPropagation();terminateAgent(\\'' + s.sessionId + '\\',true)">Force end</button>'));
    var orgHtml =
      '<button class="btn-sm" onclick="event.stopPropagation();renameAgent(\\'' + s.sessionId + '\\')">Rename</button>' +
      '<button class="btn-sm" onclick="event.stopPropagation();moveAgentToGroup(\\'' + s.sessionId + '\\')">Move to group</button>' +
      (s.groupId ? '<button class="btn-sm" onclick="event.stopPropagation();clearAgentGroup(\\'' + s.sessionId + '\\')">Remove from group</button>' : '');
    var taskHtml = s.taskExcerpt
      ? '<div class="task-excerpt"><b>Task</b>' + escapeHtml(s.taskExcerpt) + '</div>'
      : '';
    var statusHtml = s.statusLine
      ? '<div class="live-status">' + escapeHtml(s.statusLine) + '</div>'
      : '';
    return '<div class="session-card live' + (detached ? ' detached' : '') + (needsInput ? ' needs-input' : '') + '" data-id="' + s.sessionId + '"' + (detached ? '' : ' role="link" tabindex="0"') + '>' +
      '<div class="agent-mark kind-' + escapeHtml(kind) + '">' + logoSVG(kind) +
        (working ? '<span class="presence"></span>' : '') + '</div>' +
      '<div class="session-card-info">' +
        '<div class="card-top">' +
          '<div class="session-card-title">' + escapeHtml(s.title || 'Untitled') + '</div>' +
          chip +
        '</div>' +
        '<div class="session-card-meta">' +
          (s.worktreePath ? '<code title="' + escapeHtml(s.worktreePath) + '">' + escapeHtml(shortPath(s.worktreePath)) + '</code><span class="sep">·</span>' : '') +
          (s.modelDetail ? '<span class="model-chip">' + escapeHtml(s.modelDetail) + '</span><span class="sep">·</span>' : '<span>' + escapeHtml(s.model || '') + '</span><span class="sep">·</span>') +
          '<span>' + (detached ? 'started ' + time : time) + '</span>' +
        '</div>' +
        taskHtml +
        statusHtml +
        (needsInput && s.attentionExcerpt ? '<div class="attention-excerpt">' + escapeHtml(s.attentionExcerpt) + '</div>' : '') +
        usageHtml +
      '</div>' +
      '<div class="session-card-actions">' +
        approveHtml +
        (!detached ? '<span class="open-hint">Open ${icon('chevron-right', { size: 14 })}</span>' : '') +
        '<details class="card-menu" onclick="event.stopPropagation()"><summary aria-label="Session actions">•••</summary><div class="card-menu-popover">' +
          orgHtml +
          endHtml +
        '</div></details>' +
      '</div>' +
    '</div>';
  }

  function chatCard(s) {
    var time = timeAgo(new Date(s.updatedAt));
    var prHtml = '';
    if (s.prUrl) {
      var stateClass = (s.prState || 'OPEN').toLowerCase();
      var stateLabel = s.prState || 'OPEN';
      prHtml = '<a class="pr-link" href="' + escapeHtml(s.prUrl) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">Open PR #' + s.prNumber + ' ${icon('external-link', { size: 12 })}</a>';
    }
    var chatActions = (s.prUrl
      ? prHtml
      : '<button class="btn-sm pr" onclick="event.stopPropagation();createPR(\\'' + s.sessionId + '\\')">Create PR</button>') +
      '<button class="btn-sm" onclick="event.stopPropagation();renameChat(\\'' + s.sessionId + '\\')">Rename</button>' +
      '<button class="btn-sm danger" onclick="event.stopPropagation();deleteSession(\\'' + s.sessionId + '\\')">Delete chat</button>';
    return '<div class="session-card" data-id="' + s.sessionId + '" role="link" tabindex="0">' +
      '<div class="agent-mark">${icon('message-square', { size: 19 })}</div>' +
      '<div class="session-card-info">' +
        '<div class="card-top">' +
          '<div class="session-card-title">' + escapeHtml(s.title || 'Untitled') + '</div>' +
          '<span class="chip ' + s.status + '">' + (s.status === 'stub' ? 'ready' : s.status) + '</span>' +
        '</div>' +
        '<div class="session-card-meta">' +
          (s.branchName ? '<code>' + escapeHtml(s.branchName) + '</code><span class="sep">·</span>' : '') +
          '<span>' + escapeHtml(s.model || '') + '</span>' +
          (s.baseBranch ? '<span class="sep">·</span><span>from ' + escapeHtml(s.baseBranch) + '</span>' : '') +
          '<span class="sep">·</span><span>' + time + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="session-card-actions">' +
        (s.prUrl ? '<span class="pr-status ' + escapeHtml(stateClass) + '">' + escapeHtml(stateLabel) + '</span>' : '') +
        '<span class="open-hint">Open ${icon('chevron-right', { size: 14 })}</span>' +
        '<details class="card-menu" onclick="event.stopPropagation()"><summary aria-label="Chat actions">•••</summary><div class="card-menu-popover">' +
          chatActions +
        '</div></details>' +
      '</div>' +
    '</div>';
  }

  function bindCards(el, list) {
    el.querySelectorAll('.session-card').forEach(function(card) {
      function openCard() {
        var selected = list.find(function(s) { return s.sessionId === card.getAttribute('data-id'); });
        if (!selected || selected.externalProcess) return;
        location.href = selected.externalTmux
          ? '/code/tmux/' + encodeURIComponent(selected.tmuxName)
          : '/code/session/' + card.getAttribute('data-id');
      }
      card.addEventListener('click', openCard);
      card.addEventListener('keydown', function(e) {
        if (e.target !== card) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        openCard();
      });
    });
  }

  function livePriority(session) {
    if (session.needsInput && !session.externalProcess) return 0;
    if (session.wrapUp && session.wrapUp.ready) return 1;
    if (session.activity === 'working') return 2;
    if (session.wrapUp) return 3;
    if (session.externalProcess) return 5;
    return 4;
  }

  function compareLiveSessions(a, b) {
    return livePriority(a) - livePriority(b)
      || String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
      || String(a.title || '').localeCompare(String(b.title || ''));
  }

  function render() {
    var live = sessions.filter(function(s) { return s.externalTmux || s.externalProcess; });
    var chats = sessions.filter(function(s) { return !s.externalTmux && !s.externalProcess; });
    live.sort(compareLiveSessions);
    chats.sort(function(a, b) {
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
        || String(a.title || '').localeCompare(String(b.title || ''));
    });
    liveCount.textContent = String(live.length);
    chatsCount.textContent = String(chats.length);

    var counts = { working: 0, detached: 0, idle: 0, active: 0, completed: 0, error: 0 };
    live.forEach(function(s) { if (s.externalProcess) counts.detached += 1; else if (s.needsInput) counts.attention = (counts.attention || 0) + 1; else if (s.activity === 'working') counts.working += 1; });
    chats.forEach(function(s) { counts[s.status] = (counts[s.status] || 0) + 1; });
    var parts = [];
    if (counts.attention) parts.push('<span style="color:var(--amber)"><b>' + counts.attention + '</b> needs input</span>');
    if (counts.working) parts.push('<span class="w"><b>' + counts.working + '</b> working</span>');
    if (counts.detached) parts.push('<span><b>' + counts.detached + '</b> detached</span>');
    if (live.length) parts.push('<span><b>' + live.length + '</b> live</span>');
    if (counts.idle) parts.push('<span><b>' + counts.idle + '</b> idle</span>');
    if (counts.active) parts.push('<span><b>' + counts.active + '</b> active</span>');
    if (counts.completed) parts.push('<span><b>' + counts.completed + '</b> completed</span>');
    if (counts.error) parts.push('<span><b>' + counts.error + '</b> error</span>');
    statsEl.innerHTML = parts.join('<span class="sep">·</span>');

    if (costOverview && costOverview.today) {
      var byProv = (costOverview.today.byProvider || []).slice(0, 4).map(function(p) {
        return escapeHtml(p.provider) + ' $' + (Number(p.cost) || 0).toFixed(2);
      }).join(' · ');
      costStrip.style.display = '';
      costStrip.innerHTML =
        '<span>Spend</span><span class="cost-main">' + escapeHtml(costOverview.today.label || '$0') + ' today</span>' +
        '<span class="sep">·</span><span class="cost-sub">' + escapeHtml((costOverview.month && costOverview.month.label) || '$0') + ' month</span>' +
        '<a class="cost-breakdown-link" href="/code/costs">Details</a>' +
        (byProv ? '<span class="cost-src" title="' + escapeHtml(byProv) + '">CodeBurn</span>' : '');
    } else {
      costStrip.style.display = 'none';
      costStrip.innerHTML = '';
    }
    overviewBar.style.display = parts.length || (costOverview && costOverview.today) ? '' : 'none';

    var pendingSchedules = scheduledAgents.filter(function(s) {
      return s.status === 'pending' || s.status === 'running';
    });
    scheduleCount.textContent = String(pendingSchedules.length);
    scheduleBand.style.display = pendingSchedules.length ? '' : 'none';
    scheduleList.innerHTML = pendingSchedules.map(scheduleCard).join('');

    if (!sessions.length && !pendingSchedules.length) {
      liveEl.innerHTML = '';
      chatsEl.innerHTML = '';
      liveBand.style.display = 'none';
      chatsSection.style.display = 'none';
      emptyEl.style.display = '';
      return;
    }
    emptyEl.style.display = 'none';

    liveBand.style.display = live.length ? '' : 'none';
    liveEl.innerHTML = renderLiveGroups(live);
    bindCards(liveEl, live);

    chatsSection.style.display = chats.length ? '' : 'none';
    chatsEl.innerHTML = chats.map(chatCard).join('');
    bindCards(chatsEl, chats);
  }

  function scheduleCard(job) {
    var provider = job.provider || 'claude';
    var when = job.runAt ? new Date(job.runAt) : null;
    var whenLabel = when && !Number.isNaN(when.getTime())
      ? (when.getTime() > Date.now() ? 'in ' + timeUntil(when) : 'due ' + timeAgo(when))
      : 'unscheduled';
    var absolute = when && !Number.isNaN(when.getTime()) ? when.toLocaleString() : '';
    var promptPreview = String(job.prompt || '').replace(/\\s+/g, ' ').trim();
    if (promptPreview.length > 140) promptPreview = promptPreview.slice(0, 139) + '…';
    var title = job.title || (provider.charAt(0).toUpperCase() + provider.slice(1) + ' agent');
    var cancelBtn = job.status === 'pending'
      ? '<button class="btn-sm danger" type="button" onclick="event.stopPropagation();cancelScheduledAgent(\\'' + escapeHtml(job.id) + '\\')">Cancel</button>'
      : '<span class="chip working">Starting…</span>';
    return '<div class="schedule-row" data-id="' + escapeHtml(job.id) + '">' +
      '<div class="agent-mark kind-' + escapeHtml(provider) + '">' + logoSVG(provider) + '</div>' +
      '<div>' +
        '<div class="schedule-row-title">' + escapeHtml(title) + '</div>' +
        '<div class="schedule-row-meta">' + escapeHtml(provider) +
          (job.permissionMode ? ' · ' + escapeHtml(job.permissionMode) : '') +
          ' · ' + escapeHtml(whenLabel) +
          (absolute ? ' · ' + escapeHtml(absolute) : '') +
        '</div>' +
        (promptPreview ? '<div class="schedule-row-prompt">' + escapeHtml(promptPreview) + '</div>' : '') +
      '</div>' +
      cancelBtn +
    '</div>';
  }

  function timeUntil(date) {
    var s = Math.max(0, Math.floor((date.getTime() - Date.now()) / 1000));
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    return Math.floor(s / 86400) + 'd';
  }

  function renderLiveGroups(live) {
    var byGroup = Object.create(null);
    var ungrouped = [];
    live.forEach(function(s) {
      if (s.groupId) {
        if (!byGroup[s.groupId]) byGroup[s.groupId] = [];
        byGroup[s.groupId].push(s);
      } else {
        ungrouped.push(s);
      }
    });
    var parts = [];
    function groupBlock(g, members) {
      var list = members || [];
      return '<div class="agent-group" data-group="' + escapeHtml(g.id) + '">' +
        '<div class="agent-group-head">' +
          '<span class="agent-group-name">' + escapeHtml(g.name) + '</span>' +
          '<span class="agent-group-count">' + list.length + '</span>' +
          '<details class="card-menu" onclick="event.stopPropagation()"><summary aria-label="Group actions">•••</summary><div class="card-menu-popover">' +
            '<button class="btn-sm" onclick="event.stopPropagation();renameGroup(\\'' + g.id + '\\')">Rename group</button>' +
            '<button class="btn-sm danger" onclick="event.stopPropagation();deleteGroup(\\'' + g.id + '\\')">Delete group</button>' +
          '</div></details>' +
        '</div>' +
        (list.length
          ? list.map(liveCard).join('')
          : '<div class="agent-group-empty">Empty — open a card’s ••• and choose Move to group</div>') +
      '</div>';
    }
    var orderedGroups = agentGroups.slice();
    orderedGroups.sort(function(a, b) {
      var aMembers = byGroup[a.id] || [];
      var bMembers = byGroup[b.id] || [];
      var aPriority = aMembers.length ? livePriority(aMembers[0]) : 99;
      var bPriority = bMembers.length ? livePriority(bMembers[0]) : 99;
      return aPriority - bPriority || String(a.name || '').localeCompare(String(b.name || ''));
    });
    orderedGroups.forEach(function(g) {
      parts.push(groupBlock(g, byGroup[g.id] || []));
    });
    // Orphan memberships (group deleted remotely) still render under Ungrouped.
    Object.keys(byGroup).forEach(function(gid) {
      if (agentGroups.some(function(g) { return g.id === gid; })) return;
      ungrouped = ungrouped.concat(byGroup[gid]);
    });
    if (ungrouped.length) {
      if (agentGroups.length) {
        parts.push(
          '<div class="agent-group">' +
            '<div class="agent-group-head"><span class="agent-group-name">Ungrouped</span>' +
            '<span class="agent-group-count">' + ungrouped.length + '</span></div>' +
            ungrouped.map(liveCard).join('') +
          '</div>'
        );
      } else {
        parts.push(ungrouped.map(liveCard).join(''));
      }
    }
    return parts.join('');
  }

  // ── Spawn live agent ────────────────────────────────────
  spawnModelSelect.onchange = function() {
    selectedModel = spawnModelSelect.value || null;
    renderSpawnModels();
  };
  function renderProviderGrid() {
    providerGrid.innerHTML = SPAWN_PROVIDERS.map(function(p) {
      return '<button type="button" class="provider-card' + (selectedProvider === p.kind ? ' selected' : '') + '" data-kind="' + p.kind + '">' +
        '<span class="agent-tile kind-' + p.kind + '">' + logoSVG(p.kind) + '</span>' +
        '<span><b>' + p.label + '</b><small>' + p.command + '</small></span></button>';
    }).join('');
    providerGrid.querySelectorAll('.provider-card').forEach(function(card) {
      card.onclick = function() {
        selectedProvider = card.getAttribute('data-kind');
        selectedPermMode = null;
        selectedModel = null;
        renderProviderGrid();
        renderSpawnPerms();
        renderSpawnModels();
        refreshSpawnOptions(selectedProvider);
        renderSpawnSteps();
      };
    });
  }
  spawnWhenGrid.querySelectorAll('.when-card').forEach(function(card) {
    card.onclick = function() {
      selectedWhen = card.getAttribute('data-when') || 'now';
      renderSpawnWhen();
    };
  });
  document.getElementById('btn-spawn').onclick = function() {
    pageMenu.open = false;
    resetSpawnWizard();
    spawnModal.classList.add('active');
  };
  function promptNewGroup() {
    pageMenu.open = false;
    var name = prompt('Group name (e.g. Ops dash, MetroForge)');
    if (name == null) return;
    name = String(name).trim();
    if (!name) return;
    fetch('/api/code/agent-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name })
    }).then(function(r) { return r.json(); }).then(function(data) {
      if (data.error) { alert(data.error); return; }
      var group = data.group;
      var live = sessions.filter(function(s) { return s.externalTmux || s.externalProcess; });
      var ungrouped = live.filter(function(s) { return !s.groupId; });
      if (group && ungrouped.length) {
        var lines = ungrouped.map(function(s, i) {
          return (i + 1) + '. ' + (s.title || s.sessionId);
        }).join('\\n');
        var pick = prompt('Group "' + group.name + '" created.\\n\\nAdd which agents now?\\n' + lines + '\\n\\nEnter numbers (e.g. 1,3) or leave blank');
        if (pick != null && String(pick).trim()) {
          var indexes = String(pick).split(/[,\\s]+/).map(Number).filter(function(n) {
            return Number.isFinite(n) && n >= 1 && n <= ungrouped.length;
          });
          var moves = indexes.map(function(n) {
            return fetch('/api/code/agents/group', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId: ungrouped[n - 1].sessionId, groupId: group.id })
            }).then(function(r) { return r.json(); });
          });
          return Promise.all(moves).then(function() { load(); });
        }
      }
      load();
    }).catch(function(e) { alert(e.message); });
  }
  document.getElementById('btn-new-group').onclick = promptNewGroup;
  document.getElementById('btn-band-group').onclick = promptNewGroup;
  document.getElementById('btn-spawn-cancel').onclick = function() { spawnModal.classList.remove('active'); };
  spawnModal.addEventListener('click', function(e) { if (e.target === spawnModal) spawnModal.classList.remove('active'); });
  btnSpawnBack.onclick = function() {
    if (spawnStep <= 0) return;
    spawnStep -= 1;
    spawnError.classList.remove('show');
    renderSpawnSteps();
  };
  btnSpawnNext.onclick = function() {
    if (spawnStep === 0 && !selectedProvider) return;
    if (spawnStep >= SPAWN_STEP_LABELS.length - 1) return;
    spawnStep += 1;
    spawnError.classList.remove('show');
    if (spawnStep === 3) renderSpawnWhen();
    renderSpawnSteps();
  };
  btnSpawnStart.onclick = function() {
    if (!selectedProvider) return;
    var provider = currentSpawnProvider();
    var modeMeta = provider && provider.modes.find(function(m) { return m.id === selectedPermMode; });
    var payload = buildSpawnPayload();
    if (selectedWhen === 'schedule') {
      if (!payload.prompt) {
        spawnError.textContent = 'A prompt is required when scheduling.';
        spawnError.classList.add('show');
        return;
      }
      var runAtIso = runAtToIso(inputSpawnRunAt.value);
      if (!runAtIso) {
        spawnError.textContent = 'Pick a valid run-at time.';
        spawnError.classList.add('show');
        return;
      }
      payload.runAt = runAtIso;
    }
    if (modeMeta && modeMeta.needsConfirm && selectedWhen === 'now' && !confirm('Start with ' + modeMeta.label + '?\\n\\n' + (modeMeta.description || 'Fewer permission prompts.'))) return;
    if (modeMeta && modeMeta.needsConfirm && selectedWhen === 'schedule' && !confirm('Schedule with ' + modeMeta.label + '?\\n\\n' + (modeMeta.description || 'Fewer permission prompts.'))) return;
    btnSpawnStart.disabled = true;
    btnSpawnNext.disabled = true;
    btnSpawnBack.disabled = true;
    btnSpawnStart.textContent = selectedWhen === 'schedule' ? 'Scheduling…' : 'Starting…';
    spawnError.classList.remove('show');
    var endpoint = selectedWhen === 'schedule' ? '/api/code/tmux/schedule' : '/api/code/tmux/spawn';
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function(r) { return r.json(); }).then(function(data) {
      if (data.error) {
        spawnError.textContent = data.error;
        spawnError.classList.add('show');
        btnSpawnStart.disabled = false;
        btnSpawnNext.disabled = false;
        btnSpawnBack.disabled = false;
        updateSpawnPrimaryLabel();
        return;
      }
      if (selectedWhen === 'schedule') {
        spawnModal.classList.remove('active');
        load();
        return;
      }
      location.href = '/code/tmux/' + encodeURIComponent(data.name);
    }).catch(function(e) {
      spawnError.textContent = e.message;
      spawnError.classList.add('show');
      btnSpawnStart.disabled = false;
      btnSpawnNext.disabled = false;
      btnSpawnBack.disabled = false;
      updateSpawnPrimaryLabel();
    });
  };

  window.cancelScheduledAgent = function(id) {
    if (!confirm('Cancel this scheduled agent?')) return;
    fetch('/api/code/tmux/schedules/' + encodeURIComponent(id), { method: 'DELETE' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) { alert(data.error); return; }
        load();
      })
      .catch(function(e) { alert(e.message); });
  };

  // ── Create session ──────────────────────────────────────
  btnNew.onclick = function() {
    modal.classList.add('active');
    fetch('/api/code/branches').then(function(r) { return r.json(); }).then(function(data) {
      var branches = data.branches || [];
      inputBaseBranch.innerHTML = '<option value="">HEAD (current)</option>' +
        branches.map(function(b) { return '<option value="' + escapeHtml(b) + '">' + escapeHtml(b) + '</option>'; }).join('');
      if (branches.indexOf('dev') !== -1) inputBaseBranch.value = 'dev';
      else if (branches.indexOf('staging') !== -1) inputBaseBranch.value = 'staging';
    }).catch(function() {
      inputBaseBranch.innerHTML = '<option value="">HEAD (current)</option>';
    });
  };
  document.getElementById('btn-refresh').onclick = function() {
    pageMenu.open = false;
    showListState('loading', 'Loading sessions', 'Refreshing live agents and saved chats…');
    load();
    loadCosts();
  };
  document.addEventListener('click', function(e) {
    document.querySelectorAll('details[open]').forEach(function(details) {
      if (!details.contains(e.target)) details.open = false;
    });
  });
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('details[open]').forEach(function(details) { details.open = false; });
    modal.classList.remove('active');
    spawnModal.classList.remove('active');
  });
  btnCancel.onclick = function() { modal.classList.remove('active'); };
  modal.addEventListener('click', function(e) { if (e.target === modal) modal.classList.remove('active'); });

  btnCreate.onclick = function() {
    btnCreate.disabled = true;
    btnCreate.textContent = 'Creating…';
    fetch('/api/code/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseBranch: inputBaseBranch.value || undefined,
        provider: 'codex',
        model: 'gpt-5.6-sol'
      }),
    }).then(function(r) { return r.json(); }).then(function(data) {
      modal.classList.remove('active');
      btnCreate.disabled = false;
      btnCreate.textContent = 'Start chat';
      if (data.session) location.href = '/code/session/' + data.session.sessionId;
      else load();
    }).catch(function() {
      btnCreate.disabled = false;
      btnCreate.textContent = 'Start chat';
    });
  };

  // ── PR creation ─────────────────────────────────────────
  window.createPR = function(sessionId) {
    if (!confirm('Create a pull request for this session?')) return;
    fetch('/api/code/sessions/' + sessionId + '/pr', { method: 'POST' })
      .then(function(r) { return r.json(); })
      .then(function(data) { if (data.error) { alert('Error: ' + data.error); return; } load(); })
      .catch(function(e) { alert('Error: ' + e.message); });
  };

  // ── End live agent (soft wrap-up by default; force kills immediately) ──
  window.terminateAgent = function(sessionId, force) {
    var isForce = !!force || String(sessionId || '').indexOf('proc:') === 0;
    if (isForce) {
      if (!confirm('Force kill this agent now? Unsaved work may be lost.')) return;
    } else {
      if (!confirm('Ask this agent to wrap up now (commit, save ops knowledge, AHD pipeline if needed)?\\n\\nThe session stays open until the agent signals ready. Use Force end to kill immediately.')) return;
    }
    fetch('/api/code/agents/terminate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, force: isForce })
    }).then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) { alert('Error: ' + data.error); return; }
        if (data.mode === 'wrapup') {
          alert(data.already
            ? 'Wrap-up already in progress — waiting for the agent to finish.'
            : 'Wrap-up queued. Open the session to watch progress; Close session appears when the agent is ready.');
        }
        load();
      })
      .catch(function(e) { alert('Error: ' + e.message); });
  };

  // ── Approve permission prompt from the lander ─────────
  window.approveAgent = function(sessionId, key) {
    var name = String(sessionId || '').replace(/^tmux:/, '');
    if (!name) return;
    fetch('/api/code/tmux/' + encodeURIComponent(name) + '/key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: key || 'y' })
    }).then(function(r) { return r.json(); })
      .then(function(data) { if (data.error) { alert('Error: ' + data.error); return; } setTimeout(load, 400); })
      .catch(function(e) { alert('Error: ' + e.message); });
  };

  // ── Rename / groups ─────────────────────────────────────
  window.renameAgent = function(sessionId) {
    var selected = sessions.find(function(s) { return s.sessionId === sessionId; });
    var next = prompt('Rename agent', (selected && selected.title) || '');
    if (next == null) return;
    fetch('/api/code/agents/title', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, title: next })
    }).then(function(r) { return r.json(); }).then(function(data) {
      if (data.error) { alert(data.error); return; }
      load();
    }).catch(function(e) { alert(e.message); });
  };

  window.renameChat = function(sessionId) {
    var selected = sessions.find(function(s) { return s.sessionId === sessionId; });
    var next = prompt('Rename chat', (selected && selected.title) || '');
    if (next == null) return;
    next = String(next).trim();
    if (!next) return;
    fetch('/api/code/sessions/' + encodeURIComponent(sessionId) + '/title', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: next })
    }).then(function(r) { return r.json(); }).then(function(data) {
      if (data.error) { alert(data.error); return; }
      load();
    }).catch(function(e) { alert(e.message); });
  };

  window.moveAgentToGroup = function(sessionId) {
    if (!agentGroups.length) {
      var name = prompt('No groups yet. Create one and move this agent into it:');
      if (name == null || !String(name).trim()) return;
      fetch('/api/code/agent-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: String(name).trim() })
      }).then(function(r) { return r.json(); }).then(function(data) {
        if (data.error) { alert(data.error); return; }
        return fetch('/api/code/agents/group', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionId, groupId: data.group.id })
        }).then(function(r) { return r.json(); });
      }).then(function(data) {
        if (!data) return;
        if (data.error) { alert(data.error); return; }
        load();
      }).catch(function(e) { alert(e.message); });
      return;
    }
    var lines = agentGroups.map(function(g, i) { return (i + 1) + '. ' + g.name; }).join('\\n');
    var pick = prompt('Move to group:\\n' + lines + '\\n\\nEnter number (or 0 to ungroup)');
    if (pick == null) return;
    var n = Number(pick);
    if (!Number.isFinite(n) || n < 0 || n > agentGroups.length) {
      alert('Pick a number from the list');
      return;
    }
    var groupId = n === 0 ? null : agentGroups[n - 1].id;
    fetch('/api/code/agents/group', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, groupId: groupId })
    }).then(function(r) { return r.json(); }).then(function(data) {
      if (data.error) { alert(data.error); return; }
      load();
    }).catch(function(e) { alert(e.message); });
  };

  window.clearAgentGroup = function(sessionId) {
    fetch('/api/code/agents/group', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, groupId: null })
    }).then(function(r) { return r.json(); }).then(function(data) {
      if (data.error) { alert(data.error); return; }
      load();
    }).catch(function(e) { alert(e.message); });
  };

  window.renameGroup = function(groupId) {
    var group = agentGroups.find(function(g) { return g.id === groupId; });
    var next = prompt('Rename group', (group && group.name) || '');
    if (next == null) return;
    fetch('/api/code/agent-groups/' + encodeURIComponent(groupId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: next })
    }).then(function(r) { return r.json(); }).then(function(data) {
      if (data.error) { alert(data.error); return; }
      load();
    }).catch(function(e) { alert(e.message); });
  };

  window.deleteGroup = function(groupId) {
    var group = agentGroups.find(function(g) { return g.id === groupId; });
    if (!confirm('Delete group' + (group ? ' "' + group.name + '"' : '') + '? Agents stay live; they just become ungrouped.')) return;
    fetch('/api/code/agent-groups/' + encodeURIComponent(groupId), { method: 'DELETE' })
      .then(function(r) { return r.json(); }).then(function(data) {
        if (data.error) { alert(data.error); return; }
        load();
      }).catch(function(e) { alert(e.message); });
  };

  // ── Delete session ──────────────────────────────────────
  window.deleteSession = function(sessionId) {
    if (!confirm('Delete this chat? This removes the worktree and branch.')) return;
    fetch('/api/code/sessions/' + sessionId, { method: 'DELETE' })
      .then(function() { load(); })
      .catch(function() {});
  };

  // ── Helpers ─────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function shortPath(value) {
    var parts = String(value || '').split('/').filter(Boolean);
    if (parts.length <= 2) return String(value || '');
    return '…/' + parts.slice(-2).join('/');
  }
  function timeAgo(date) {
    var s = Math.floor((Date.now() - date.getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  // ── Auth check + init ──────────────────────────────────
  fetch('/api/me').then(function(r) {
    if (!r.ok) { location.href = '/'; return; }
    return r.json();
  }).then(function(d) {
    if (!d || d.role !== 'admin') { location.href = '/'; return; }
    load();
    loadCosts();
    setInterval(function() { if (!document.hidden) load(); }, 15000);
    setInterval(function() { if (!document.hidden) loadCosts(); }, 60000);
  });

})();
</script>
</body>
</html>`;
};
