// finder-page.js — professional project browser for Lakeside Ops.
// Three view modes (icons / list / columns), editor pane, git badges.
// Styled to the ops design system: neutral surfaces, one accent, color = meaning.
// Returns { extraCss, body } for renderShell. Client talks to /api/finder/*.
"use strict";

const fs = require("fs");
const path = require("path");
const { icon } = require("./ui-kit");
// Paths come from the projects manifest (configurable) — never hardcode per-project
// absolute paths in this file.
function loadProjectsManifest() {
  const candidates = [];
  if (process.env.PROJECTS_MANIFEST) candidates.push(process.env.PROJECTS_MANIFEST);
  try {
    const { getConfig, ROOT } = require("./src/core/config");
    const cfg = getConfig();
    if (cfg.paths?.projectsManifest) candidates.push(cfg.paths.projectsManifest);
    const projectsRoot = cfg.paths?.projectsRoot || process.env.PROJECTS_ROOT;
    if (projectsRoot) candidates.push(path.join(path.dirname(projectsRoot), "projects.manifest.json"));
    // Main checkout: repo/../../projects.manifest.json → /root/projects.manifest.json
    candidates.push(path.resolve(ROOT, "..", "..", "projects.manifest.json"));
    candidates.push(path.resolve(ROOT, "..", "projects.manifest.json"));
  } catch {
    candidates.push(path.resolve(__dirname, "..", "..", "projects.manifest.json"));
  }
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return JSON.parse(fs.readFileSync(c, "utf8"));
    } catch { /* try next */ }
  }
  return { projects: [] };
}
const PROJECTS_MANIFEST = loadProjectsManifest();
const FAVORITE_ICONS = [
  ["a-house-divided", "landmark"],
  ["LSGD-ops-dash", "sliders"],
  ["metroforge", "map"],
  ["grand-century", "gamepad"],
  ["ahd-sim", "vote"],
  ["ahd-android", "smartphone"],
  ["adhd-bot", "bot"],
  ["corpgame", "building"],
  ["ahd-docs", "bookOpen"],
  ["foreshore", "waves"],
  ["lakeside-accounts", "lock"],
];

function makeFinderBody() {
  const extraCss = `
/* ══════════════ Finder — ops professional ══════════════ */
.ahd-main:has(.fn-app){max-width:none;padding:clamp(8px,1.6vw,20px);overflow:hidden}
.fn-app{--fn-accent:var(--accent);--fn-accent-soft:var(--accent-soft);
  display:flex;flex-direction:column;height:calc(100dvh - 92px);min-height:0;
  background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);
  box-shadow:var(--e1);overflow:hidden}

/* ── Toolbar ── */
.fn-toolbar{display:flex;align-items:center;gap:10px;padding:8px 12px;
  background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0}
.fn-nav-btns{display:flex;gap:2px}
.fn-nav-btn{width:28px;height:26px;display:inline-flex;align-items:center;justify-content:center;
  border:1px solid transparent;border-radius:var(--r-xs);background:transparent;color:var(--text-2);cursor:pointer}
.fn-nav-btn:hover:not(:disabled){background:var(--glass-2);color:var(--text)}
.fn-nav-btn:disabled{opacity:.3;cursor:default}
.fn-seg{display:inline-flex;background:var(--glass-2);border:1px solid var(--border);border-radius:var(--r-xs);padding:2px;gap:2px}
.fn-seg button{border:0;background:transparent;color:var(--text-2);font-size:var(--fs-xs);font-weight:600;
  padding:4px 10px;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;gap:5px}
.fn-seg button .icon{opacity:.7}
.fn-seg button:hover{color:var(--text)}
.fn-seg button.on{background:var(--surface-3);color:var(--text);box-shadow:var(--e1)}
.fn-seg button.on .icon{opacity:1;color:var(--fn-accent)}
.fn-toolbar .spacer{flex:1}
.icon.fn-rot90{transform:rotate(90deg)}
.icon.fn-cols-ico{transform:scaleX(1.15)}
.fn-search{position:relative}
.fn-search input{background:var(--field-bg);border:1px solid var(--border);border-radius:var(--r-xs);color:var(--text);
  padding:5px 10px 5px 28px;font-size:var(--fs-xs);width:190px;outline:none;transition:width .15s var(--ease),border-color .15s var(--ease)}
.fn-search input:focus{border-color:var(--fn-accent);box-shadow:var(--ring);width:230px}
.fn-search .ico{position:absolute;left:8px;top:50%;transform:translateY(-50%);color:var(--text-3);display:inline-flex;pointer-events:none}
.fn-act{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);background:var(--surface-2);
  color:var(--text);border-radius:var(--r-xs);padding:5px 12px;font-size:var(--fs-xs);font-weight:600;cursor:pointer}
.fn-act:hover:not(:disabled){background:var(--glass-hover);border-color:var(--border-2)}
.fn-act:disabled{opacity:.38;cursor:default}
.fn-act.save{background:var(--fn-accent);border-color:transparent;color:var(--on-accent)}
.fn-act.save:hover:not(:disabled){background:var(--accent-hover)}

/* ── Body grid ── */
.fn-body{display:grid;grid-template-columns:216px 1fr;flex:1;min-height:0}
.fn-body.editing{grid-template-columns:216px minmax(0,1fr) minmax(340px,1.05fr)}
@media (max-width:1100px){.fn-body,.fn-body.editing{grid-template-columns:1fr}.fn-sidebar{display:none}.fn-editor-col{display:none}
  .fn-body.editing.show-editor{grid-template-columns:1fr}.fn-body.editing.show-editor .fn-browser{display:none}.fn-body.editing.show-editor .fn-editor-col{display:flex}}

/* ── Sidebar ── */
.fn-sidebar{border-right:1px solid var(--border);background:var(--surface);overflow:auto;
  padding:var(--s-3) var(--s-2);font-size:var(--fs-sm)}
.fn-side-label{font-size:var(--fs-2xs);font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  color:var(--text-3);padding:var(--s-2) var(--s-3) 4px}
.fn-side-item{display:flex;align-items:center;gap:8px;padding:6px var(--s-3);border-radius:var(--r-xs);cursor:pointer;
  color:var(--text-2);border:0;background:transparent;width:100%;text-align:left;font:inherit}
.fn-side-item:hover{background:var(--glass-2);color:var(--text)}
.fn-side-item.active{background:var(--fn-accent-soft);color:var(--text);font-weight:600}
.fn-side-item.active .sico{color:var(--fn-accent)}
.fn-side-item .sico{flex-shrink:0;display:inline-flex;align-items:center;color:var(--text-3)}
.fn-side-item .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.fn-side-item .gitdot{width:6px;height:6px;border-radius:50%;background:var(--ok);flex-shrink:0}

/* ── Browser area ── */
.fn-browser{display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--bg-0)}

/* Icon view */
.fn-icons{flex:1;overflow:auto;padding:var(--s-4);display:grid;
  grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:4px;align-content:start;outline:none}
.fn-icon-cell{display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 6px 8px;
  border-radius:var(--r-sm);cursor:default;user-select:none;text-align:center;position:relative;border:1px solid transparent}
.fn-icon-cell:hover{background:var(--glass-1)}
.fn-icon-cell.sel{background:var(--fn-accent-soft);border-color:var(--border-2)}
.fn-icon-glyph{width:44px;height:44px;display:flex;align-items:center;justify-content:center;position:relative;color:var(--text-2)}
.fn-icon-glyph svg{width:100%;height:100%}
.fn-icon-git{position:absolute;right:-3px;bottom:-2px;width:15px;height:15px;border-radius:50%;
  background:var(--ok);color:#fff;display:flex;align-items:center;justify-content:center;
  border:2px solid var(--bg-0)}
.fn-icon-git.dirty{background:var(--warn)}
.fn-icon-git svg{width:9px;height:9px}
.fn-icon-name{font-size:var(--fs-2xs);line-height:1.3;color:var(--text);max-width:88px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}

/* List view */
.fn-list-head{display:grid;grid-template-columns:minmax(160px,1fr) 120px 76px 150px;gap:10px;
  padding:6px 14px;border-bottom:1px solid var(--border);font-size:var(--fs-2xs);font-weight:700;
  letter-spacing:.06em;text-transform:uppercase;color:var(--text-3);background:var(--surface);flex-shrink:0}
.fn-list{flex:1;overflow:auto;outline:none;padding:2px 0}
.fn-row{display:grid;grid-template-columns:minmax(160px,1fr) 120px 76px 150px;gap:10px;
  padding:5px 14px;align-items:center;font-size:var(--fs-sm);user-select:none;cursor:default}
.fn-row:hover:not(.sel){background:var(--glass-1)}
.fn-row.sel{background:var(--fn-accent-soft)}
.fn-row .name{display:flex;align-items:center;gap:8px;min-width:0}
.fn-row .name .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fn-ico{width:18px;height:18px;flex-shrink:0;display:inline-flex;align-items:center;color:var(--text-2)}
.fn-ico svg{width:100%;height:100%}
.fn-ico.dir{color:var(--fn-accent)}
.fn-ico.repo{color:var(--ok)}
.fn-ico.secret{color:var(--text-3)}
.fn-badge{display:inline-flex;align-items:center;gap:4px;font-size:var(--fs-2xs);font-weight:700;
  padding:2px 8px;border-radius:var(--r-full);background:var(--green-soft);color:var(--ok);
  max-width:112px;overflow:hidden;white-space:nowrap}
.fn-badge .icon{flex-shrink:0}
.fn-badge.dirty{background:var(--amber-soft);color:var(--warn)}
.fn-badge.blocked{background:var(--glass-3);color:var(--text-2);font-weight:600}
.fn-meta{color:var(--text-3);font-size:var(--fs-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fn-sep{padding:var(--s-3) 14px 4px;font-size:var(--fs-2xs);font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3)}
.fn-empty,.fn-err{padding:40px 16px;text-align:center;color:var(--text-3);font-size:var(--fs-sm)}
.fn-err{color:var(--danger)}

/* Column (Miller) view */
.fn-cols{flex:1;display:flex;overflow-x:auto;overflow-y:hidden;min-height:0;outline:none}
.fn-col{width:236px;flex-shrink:0;height:100%;overflow-y:auto;border-right:1px solid var(--border);padding:2px 0}
.fn-col.preview{width:auto;flex:1;min-width:300px;border-right:0;display:flex;flex-direction:column;background:var(--surface)}
.fn-col-item{display:flex;align-items:center;gap:8px;padding:4px 12px;font-size:var(--fs-sm);cursor:default;user-select:none}
.fn-col-item:hover{background:var(--glass-1)}
.fn-col-item.sel{background:var(--fn-accent-soft)}
.fn-col-item .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fn-col-item .chev{color:var(--text-3);display:inline-flex}
.fn-col-empty{padding:24px 12px;color:var(--text-3);font-size:var(--fs-xs);text-align:center}

/* Preview/get-info column */
.fn-pv{display:flex;flex-direction:column;align-items:center;padding:var(--s-6) var(--s-4) var(--s-3);text-align:center;gap:8px;flex-shrink:0}
.fn-pv .big{width:56px;height:56px;color:var(--text-2)}
.fn-pv .big svg{width:100%;height:100%}
.fn-pv h3{margin:0;font-size:var(--fs-body);font-weight:700;word-break:break-all}
.fn-pv .kind{font-size:var(--fs-xs);color:var(--text-3)}
.fn-pv .meta{font-size:var(--fs-xs);color:var(--text-3);line-height:1.7}
.fn-pv .meta b{color:var(--text-2);font-weight:600}

/* ── Editor column ── */
.fn-editor-col{display:flex;flex-direction:column;min-width:0;min-height:0;border-left:1px solid var(--border);background:var(--surface)}
.fn-ed-head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border);flex-shrink:0}
.fn-ed-head h2{font-size:var(--fs-sm);font-weight:700;margin:0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fn-ed-sub{padding:5px 12px;font-size:var(--fs-2xs);color:var(--text-3);font-family:var(--mono);flex-shrink:0;display:flex;flex-wrap:wrap;gap:10px;border-bottom:1px solid var(--border)}
.fn-ed-wrap{flex:1;min-height:0;display:flex;position:relative;background:var(--bg-0)}
.fn-gutter{flex-shrink:0;width:44px;overflow:hidden;text-align:right;padding:12px 8px 12px 0;
  font-family:var(--mono);font-size:var(--fs-xs);line-height:1.55;color:var(--text-3);
  background:var(--surface);border-right:1px solid var(--border);user-select:none;white-space:pre}
.fn-editor{flex:1;width:100%;min-height:0;border:0;resize:none;padding:12px 14px;background:transparent;color:var(--text);
  font-family:var(--mono);font-size:var(--fs-xs);line-height:1.55;outline:none;tab-size:2;white-space:pre;overflow:auto}
.fn-editor.dirty{box-shadow:inset 3px 0 0 var(--warn)}
.fn-editor:disabled{opacity:.7}
.fn-placeholder{flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-3);font-size:var(--fs-sm);padding:24px;text-align:center;line-height:1.6}

/* ── Path bar + status bar ── */
.fn-pathbar{display:flex;align-items:center;gap:4px;padding:4px 10px;border-top:1px solid var(--border);
  background:var(--surface);overflow-x:auto;flex-shrink:0}
.fn-crumb{display:inline-flex;align-items:center;color:var(--text-2);padding:2.5px 8px;border-radius:6px;
  cursor:pointer;white-space:nowrap;border:1px solid var(--border);background:var(--surface-2);font:inherit;font-size:var(--fs-2xs)}
.fn-crumb:hover{background:var(--glass-hover);color:var(--text)}
.fn-crumb.cur{background:var(--fn-accent-soft);border-color:var(--fn-accent);color:var(--text);font-weight:600}
.fn-status{display:flex;align-items:center;gap:10px;padding:5px 12px;border-top:1px solid var(--border);
  background:var(--surface);font-size:var(--fs-2xs);color:var(--text-3);flex-shrink:0}
.fn-status b{color:var(--text-2);font-weight:600}
.fn-status .pill{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:var(--r-full);
  background:var(--glass-2);font-family:var(--mono);font-size:var(--fs-2xs)}
.fn-status .pill.ok{background:var(--green-soft);color:var(--ok)}
.fn-status .pill.warn{background:var(--amber-soft);color:var(--warn)}
.fn-toast{position:fixed;right:18px;bottom:18px;background:var(--surface-3);border:1px solid var(--border-2);color:var(--text);
  padding:10px 14px;border-radius:var(--r-sm);font-size:var(--fs-xs);box-shadow:var(--e2);z-index:50;opacity:0;pointer-events:none;transition:opacity .15s}
.fn-toast.show{opacity:1}
.fn-toast.bad{border-color:var(--danger);color:var(--danger)}
.fn-toast.ok{border-color:var(--ok)}

/* ══════════════ Mobile / touch ══════════════ */
.fn-menu-btn{display:none}
.fn-side-backdrop{display:none}

/* ≤1100px: sidebar becomes a drawer, editor takes over full pane */
@media (max-width:1100px){
  .fn-menu-btn{display:inline-flex}
  .fn-sidebar{display:block;position:absolute;top:0;left:0;bottom:0;width:min(280px,84vw);z-index:55;
    transform:translateX(-105%);transition:transform .22s var(--ease);box-shadow:var(--e3);border-right:1px solid var(--border-2)}
  .fn-app{position:relative}
  .fn-app.side-open .fn-sidebar{transform:none}
  .fn-side-backdrop{display:block;position:absolute;inset:0;z-index:54;background:rgba(0,0,0,.45);
    opacity:0;pointer-events:none;transition:opacity .2s var(--ease)}
  .fn-app.side-open .fn-side-backdrop{opacity:1;pointer-events:auto}
  .fn-body.editing.show-editor .fn-editor-col{position:absolute;inset:0;z-index:56;background:var(--surface)}
}

/* ≤860px: compress list, larger touch targets */
@media (max-width:860px){
  .fn-app{height:calc(100dvh - 78px);min-height:0;
    padding-bottom:env(safe-area-inset-bottom,0)}
  .ahd-main:has(.fn-app){padding:8px}
  .fn-toolbar{gap:6px;padding:7px 8px;flex-wrap:wrap}
  .fn-search{flex:1;min-width:120px}
  .fn-search input{width:100%;font-size:16px} /* prevent iOS zoom */
  .fn-search input:focus{width:100%}
  .fn-act.save{display:none} /* save only relevant with editor open; editor is full-pane on mobile */
  .fn-body.editing .fn-act.save{display:inline-flex}
  .fn-list-head{grid-template-columns:minmax(0,1fr) auto 108px;padding:6px 10px}
  .fn-list-head>div:nth-child(3){display:none}
  .fn-row{grid-template-columns:minmax(0,1fr) auto 108px;padding:7px 10px;min-height:42px}
  .fn-row>div:nth-child(3){display:none}
  .fn-icons{grid-template-columns:repeat(auto-fill,minmax(88px,1fr));padding:12px}
  .fn-icon-cell{min-height:92px}
  .fn-nav-btn{width:34px;height:32px}
  .fn-act{padding:7px 12px;min-height:34px}
  .fn-status{padding:6px 10px}
  .fn-status .pill:nth-child(n+3){display:none}
  .fn-pathbar{padding:4px 8px}
  .fn-editor{font-size:13px}
  .fn-gutter{font-size:13px;width:40px}
  /* Safe area for notched phones */
  .fn-toolbar{padding-top:calc(7px + env(safe-area-inset-top,0))}
}

/* ≤560px: phone — drill-down columns, minimal chrome */
@media (max-width:560px){
  .fn-seg button span{display:none}
  .fn-seg button{padding:6px 10px}
  .fn-list-head{grid-template-columns:minmax(0,1fr) auto}
  .fn-list-head>div:nth-child(4){display:none}
  .fn-row{grid-template-columns:minmax(0,1fr) auto}
  .fn-row>div:nth-child(4){display:none}
  /* Miller columns become paged full-width drill with snap */
  .fn-cols{scroll-snap-type:x mandatory}
  .fn-col{width:100%;min-width:100%;scroll-snap-align:start}
  .fn-col.preview{min-width:100%}
  .fn-col-item{min-height:40px;padding:8px 14px}
  .fn-ed-head{padding:10px 12px}
  .fn-ed-head h2{font-size:var(--fs-body)}
  .fn-crumb{padding:4px 9px;font-size:var(--fs-xs)}
}

/* Touch devices: bigger hit areas regardless of width */
@media (pointer:coarse){
  .fn-row{min-height:44px}
  .fn-col-item{min-height:42px}
  .fn-side-item{min-height:38px;padding-top:8px;padding-bottom:8px}
  .fn-icon-cell{padding-top:14px;padding-bottom:12px}
}
`;

  // Server-rendered SVG icon strings (Lucide, from ui-kit)
  const I = {
    chevronLeft: icon("arrow-left", { size: 15 }),
    chevronRight: icon("arrow-right", { size: 15 }),
    arrowUp: icon("arrow-left", { size: 15, cls: "fn-rot90" }),
    grid: icon("layers", { size: 13 }),
    list: icon("menu", { size: 13 }),
    columns: icon("chevron-right", { size: 13, cls: "fn-cols-ico" }),
    search: icon("search", { size: 12 }),
    save: icon("download", { size: 13 }),
    folder: icon("folder", { size: 15 }),
    home: icon("home", { size: 15 }),
    globe: icon("globe", { size: 15 }),
    hardDrive: icon("database", { size: 15 }),
    database: icon("database", { size: 15 }),
    gamepad: icon("play", { size: 15 }),
    map: icon("map", { size: 15 }),
    vote: icon("vote", { size: 15 }),
    smartphone: icon("message", { size: 15 }),
    bot: icon("bot", { size: 15 }),
    building: icon("package", { size: 15 }),
    bookOpen: icon("book-open", { size: 15 }),
    waves: icon("activity", { size: 15 }),
    lock: icon("lock", { size: 15 }),
    cpu: icon("cpu", { size: 15 }),
    landmark: icon("landmark", { size: 15 }),
    sliders: icon("sliders", { size: 15 }),
    refreshCw: icon("refresh", { size: 13 }),
    x: icon("x", { size: 13 }),
    gitBranch: icon("git-branch", { size: 10 }),
    fileCode: icon("code", { size: 18 }),
    fileJson: icon("file-text", { size: 18 }),
    fileText: icon("file-text", { size: 18 }),
    file: icon("file-text", { size: 18 }),
    image: icon("image", { size: 18 }),
    fileType: icon("file-text", { size: 18 }),
  };

  const body = `
<div class="fn-app" id="fnApp">
  <div class="fn-toolbar">
    <button type="button" class="fn-nav-btn fn-menu-btn" id="fnMenuBtn" title="Folders">${I.menu}</button>
    <div class="fn-nav-btns">
      <button type="button" class="fn-nav-btn" id="fnBack" title="Back" disabled>${I.chevronLeft}</button>
      <button type="button" class="fn-nav-btn" id="fnFwd" title="Forward" disabled>${I.chevronRight}</button>
      <button type="button" class="fn-nav-btn" id="fnUp" title="Enclosing folder" disabled>${I.arrowUp}</button>
    </div>
    <div class="fn-seg" id="fnViewSeg">
      <button type="button" data-view="icons" title="Icon view">${I.grid}<span>Icons</span></button>
      <button type="button" data-view="list" title="List view">${I.list}<span>List</span></button>
      <button type="button" data-view="cols" title="Column view">${I.columns}<span>Columns</span></button>
    </div>
    <div class="spacer"></div>
    <div class="fn-search"><span class="ico">${I.search}</span><input id="fnFilter" type="search" placeholder="Filter" autocomplete="off" /></div>
    <button type="button" class="fn-act save" id="fnSave" disabled>${I.save}<span>Save</span></button>
  </div>
  <div class="fn-body" id="fnBody">
    <div class="fn-side-backdrop" id="fnSideBackdrop"></div>
    <aside class="fn-sidebar" id="fnSidebar"></aside>
    <section class="fn-browser" id="fnBrowser">
      <div class="fn-icons" id="fnIcons" tabindex="0" hidden></div>
      <div id="fnListWrap" hidden>
        <div class="fn-list-head"><div>Name</div><div>Git</div><div>Size</div><div>Date Modified</div></div>
        <div class="fn-list" id="fnList" tabindex="0"></div>
      </div>
      <div class="fn-cols" id="fnCols" tabindex="0" hidden></div>
      <div class="fn-pathbar" id="fnPathbar"></div>
      <div class="fn-status" id="fnStatus"><span>Ready</span></div>
    </section>
    <section class="fn-editor-col" id="fnEditorCol" hidden>
      <div class="fn-ed-head">
        <h2 id="fnPrevTitle">No selection</h2>
        <button type="button" class="fn-act" id="fnReloadFile" disabled>${I.refreshCw}<span>Reload</span></button>
        <button type="button" class="fn-act" id="fnCloseEd">${I.x}<span>Close</span></button>
      </div>
      <div class="fn-ed-sub" id="fnPrevSub"></div>
      <div class="fn-ed-wrap" id="fnEdWrap">
        <div class="fn-placeholder" id="fnPlaceholder">Select a file to edit.<br/>⌘S / Ctrl+S saves. A .finder-bak backup is kept.</div>
        <div class="fn-gutter" id="fnGutter" hidden>1</div>
        <textarea class="fn-editor" id="fnEditor" hidden spellcheck="false" wrap="off"></textarea>
      </div>
    </section>
  </div>
</div>
<div class="fn-toast" id="fnToast"></div>
<script>
(function(){
  "use strict";
  var $ = function(id){ return document.getElementById(id); };
  var bodyEl = $("fnBody"), iconsEl = $("fnIcons"), listWrap = $("fnListWrap"), listEl = $("fnList"),
      colsEl = $("fnCols"), sideEl = $("fnSidebar"), pathbarEl = $("fnPathbar"), statusEl = $("fnStatus"),
      editorCol = $("fnEditorCol"), editor = $("fnEditor"), gutter = $("fnGutter"), placeholder = $("fnPlaceholder"),
      prevTitle = $("fnPrevTitle"), prevSub = $("fnPrevSub"), toastEl = $("fnToast"), filterEl = $("fnFilter");

  /* Server-rendered Lucide SVGs injected as icon library */
  var ICONS = {
    folder: ${JSON.stringify(I.folder)},
    gitBranch: ${JSON.stringify(I.gitBranch)},
    gitBranch18: ${JSON.stringify(I.gitBranch).replace('width="10" height="10"', 'width="18" height="18"')},
    fileCode: ${JSON.stringify(I.fileCode)},
    fileJson: ${JSON.stringify(I.fileJson)},
    fileText: ${JSON.stringify(I.fileText)},
    file: ${JSON.stringify(I.file)},
    image: ${JSON.stringify(I.image)},
    fileType: ${JSON.stringify(I.fileType)},
    lock: ${JSON.stringify(I.lock).replace('width="15" height="15"', 'width="18" height="18"')},
    lockBadge: ${JSON.stringify(I.lock)},
    home: ${JSON.stringify(I.home)},
    globe: ${JSON.stringify(I.globe)},
    hardDrive: ${JSON.stringify(I.hardDrive)},
    database: ${JSON.stringify(I.database)},
    gamepad: ${JSON.stringify(I.gamepad)},
    map: ${JSON.stringify(I.map)},
    vote: ${JSON.stringify(I.vote)},
    smartphone: ${JSON.stringify(I.smartphone)},
    bot: ${JSON.stringify(I.bot)},
    building: ${JSON.stringify(I.building)},
    bookOpen: ${JSON.stringify(I.bookOpen)},
    waves: ${JSON.stringify(I.waves)},
    cpu: ${JSON.stringify(I.cpu)},
    landmark: ${JSON.stringify(I.landmark)},
    sliders: ${JSON.stringify(I.sliders)},
    chevronRight: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>'
  };

  var state = {
    view: "icons",
    path: null,
    items: [],
    breadcrumbs: [],
    selection: null,
    filter: "",
    history: [], histIdx: -1,
    file: null, original: null, dirty: false,
    navLock: false,
    columns: [],
  };

  var FAVORITES = ${JSON.stringify([
    { name: "Projects", path: null, icon: "home" },
    ...FAVORITE_ICONS
      .filter(([name]) => PROJECTS_MANIFEST.entries[name])
      .map(([name, icon]) => ({ name, path: PROJECTS_MANIFEST.entries[name].path, icon })),
    { name: "hermes-agent", path: "/usr/local/lib/hermes-agent", icon: "cpu" },
    { name: "/var/www", path: "/var/www", icon: "globe" },
  ])};
  var SIDEBAR_REPOS = {};

  /* ── glyphs ── */
  var CODE_EXT = [".js",".ts",".tsx",".jsx",".mjs",".cjs",".py",".sh",".go",".rs",".java",".kt",".rb",".vue",".svelte",".astro"];
  var DATA_EXT = [".json",".yml",".yaml",".toml",".xml",".csv"];
  var DOC_EXT = [".md",".mdx",".txt"];
  var MARKUP_EXT = [".css",".scss",".html",".svg"];
  var IMG_EXT = [".png",".jpg",".jpeg",".gif",".webp",".ico"];
  function glyphFor(it){
    if (it.type === "dir") return ICONS.folder;
    if (it.blocked) return ICONS.lock;
    var e = (it.ext || "").toLowerCase();
    if (CODE_EXT.indexOf(e) >= 0) return ICONS.fileCode;
    if (DATA_EXT.indexOf(e) >= 0) return ICONS.fileJson;
    if (DOC_EXT.indexOf(e) >= 0) return ICONS.fileText;
    if (MARKUP_EXT.indexOf(e) >= 0) return ICONS.fileType;
    if (IMG_EXT.indexOf(e) >= 0) return ICONS.image;
    return ICONS.file;
  }
  function icoCls(it){
    if (it.type === "dir") return (it.git && it.git.isRepo) ? "fn-ico repo" : "fn-ico dir";
    if (it.blocked) return "fn-ico secret";
    return "fn-ico";
  }

  /* ── helpers ── */
  function toast(msg, kind){
    toastEl.textContent = msg;
    toastEl.className = "fn-toast show" + (kind ? " " + kind : "");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function(){ toastEl.classList.remove("show"); }, 2200);
  }
  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }
  function fmtTime(ms){
    if (!ms) return "—";
    try { return new Date(ms).toLocaleString(undefined, { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" }); }
    catch(e){ return "—"; }
  }
  function setStatus(html){ statusEl.innerHTML = html; }
  function api(url, opts){
    return fetch(url, Object.assign({ headers: { "Accept": "application/json" } }, opts || {}))
      .then(function(res){
        return res.json().catch(function(){ return { error: "bad json" }; }).then(function(data){
          if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
          return data;
        });
      });
  }
  function confirmLeave(){
    if (!state.dirty) return true;
    return confirm("Discard unsaved changes?");
  }
  function filteredItems(){
    var q = state.filter.trim().toLowerCase();
    if (!q) return state.items;
    return state.items.filter(function(it){
      return it.type === "separator" || (it.name || "").toLowerCase().indexOf(q) >= 0;
    });
  }
  function gitBadgeHtml(g){
    if (!g || !g.isRepo) return '<span class="fn-meta">—</span>';
    var title = [g.branch, g.shortHead, g.remote, g.dirty ? "dirty" : "clean"].filter(Boolean).join(" · ");
    return '<span class="fn-badge' + (g.dirty ? " dirty" : "") + '" title="' + esc(title) + '">'
      + '<span class="icon">' + ICONS.gitBranch + '</span>' + esc(g.branch || "git") + (g.dirty ? " •" : "") + "</span>";
  }

  /* ── sidebar drawer (mobile) ── */
  var appEl = $("fnApp");
  function closeSidebar(){ appEl.classList.remove("side-open"); }
  $("fnMenuBtn").addEventListener("click", function(){ appEl.classList.toggle("side-open"); });
  $("fnSideBackdrop").addEventListener("click", closeSidebar);

  /* ── sidebar ── */
  function renderSidebar(){
    var h = '<div class="fn-side-label">Favorites</div>';
    FAVORITES.forEach(function(f){
      var active = (f.path == null && state.path == null) || (f.path != null && state.path === f.path);
      h += '<button type="button" class="fn-side-item' + (active ? " active" : "") + '" data-path="' + esc(f.path == null ? "" : f.path) + '">'
        + '<span class="sico">' + (ICONS[f.icon] || ICONS.folder) + '</span><span class="nm">' + esc(f.name) + "</span>"
        + (SIDEBAR_REPOS[f.path] ? '<span class="gitdot" title="git repo"></span>' : "")
        + "</button>";
    });
    h += '<div class="fn-side-label">Locations</div>';
    h += '<button type="button" class="fn-side-item" data-path="/root"><span class="sico">' + ICONS.hardDrive + '</span><span class="nm">/root</span></button>';
    h += '<button type="button" class="fn-side-item" data-path="/srv"><span class="sico">' + ICONS.database + '</span><span class="nm">/srv</span></button>';
    sideEl.innerHTML = h;
    sideEl.querySelectorAll(".fn-side-item").forEach(function(btn){
      btn.addEventListener("click", function(){
        closeSidebar();
        var p = btn.getAttribute("data-path");
        navigate(p === "" ? null : p, { push: true });
      });
    });
  }

  /* ── path bar ── */
  function renderPathbar(){
    var crumbs = state.breadcrumbs || [];
    pathbarEl.innerHTML = crumbs.map(function(c, i){
      var isLast = i === crumbs.length - 1;
      return '<button type="button" class="fn-crumb' + (isLast ? " cur" : "") + '" data-path="' + esc(c.path == null ? "" : c.path) + '">' + esc(c.name) + "</button>";
    }).join("");
    pathbarEl.querySelectorAll(".fn-crumb").forEach(function(b){
      b.addEventListener("click", function(){
        var p = b.getAttribute("data-path");
        navigate(p === "" ? null : p, { push: true });
      });
    });
  }

  /* ── icon view ── */
  function renderIcons(){
    var items = filteredItems().filter(function(it){ return it.type !== "separator"; });
    if (!items.length) { iconsEl.innerHTML = '<div class="fn-empty" style="grid-column:1/-1">No items</div>'; return; }
    iconsEl.innerHTML = items.map(function(it){
      var sel = state.selection && state.selection.path === it.path ? " sel" : "";
      var gitDot = it.git && it.git.isRepo
        ? '<span class="fn-icon-git' + (it.git.dirty ? " dirty" : "") + '" title="' + esc(it.git.branch || "git") + (it.git.dirty ? " · dirty" : "") + '">' + ICONS.gitBranch + "</span>" : "";
      return '<div class="fn-icon-cell' + sel + '" data-path="' + esc(it.path) + '" data-type="' + esc(it.type) + '">'
        + '<div class="fn-icon-glyph" style="color:' + (it.type === "dir" ? (it.git && it.git.isRepo ? "var(--ok)" : "var(--fn-accent)") : "inherit") + '">' + glyphFor(it) + gitDot + "</div>"
        + '<div class="fn-icon-name">' + esc(it.name) + "</div>"
        + "</div>";
    }).join("");
    wireCells(iconsEl, ".fn-icon-cell");
  }

  /* ── list view ── */
  function renderList(){
    var items = filteredItems();
    if (!items.length) { listEl.innerHTML = '<div class="fn-empty">No items</div>'; return; }
    var h = "";
    items.forEach(function(it){
      if (it.type === "separator") { h += '<div class="fn-sep">' + esc(it.name) + "</div>"; return; }
      var sel = state.selection && state.selection.path === it.path ? " sel" : "";
      var gitCol = it.git ? gitBadgeHtml(it.git) : (it.blocked ? '<span class="fn-badge blocked">secret</span>' : '<span class="fn-meta">—</span>');
      var size = it.type === "dir" ? '<span class="fn-meta">' + (it.skipped ? "skipped" : "—") + "</span>"
        : '<span class="fn-meta">' + esc(it.sizeLabel || "—") + "</span>";
      h += '<div class="fn-row' + sel + '" data-path="' + esc(it.path) + '" data-type="' + esc(it.type) + '">'
        + '<div class="name"><span class="' + icoCls(it) + '">' + glyphFor(it) + '</span><span class="nm">' + esc(it.name) + (it.isSymlink ? " ↗" : "") + "</span></div>"
        + "<div>" + gitCol + "</div>"
        + "<div>" + size + "</div>"
        + '<div class="fn-meta">' + esc(fmtTime(it.mtime)) + "</div>"
        + "</div>";
    });
    listEl.innerHTML = h;
    wireCells(listEl, ".fn-row");
  }

  /* ── column view ── */
  function ancestorPaths(p){
    if (!p) return [null];
    var parts = p.split("/").filter(Boolean);
    var chain = [null];
    var acc = "";
    for (var i = 0; i < parts.length; i++) { acc += "/" + parts[i]; chain.push(acc); }
    return chain;
  }
  function loadColumn(idx, p){
    return api("/api/finder/list" + (p == null ? "" : "?path=" + encodeURIComponent(p)))
      .then(function(data){
        state.columns[idx] = { path: p, items: (data.items || []).filter(function(it){ return it.type !== "separator"; }) };
      })
      .catch(function(e){
        state.columns[idx] = { path: p, items: [], error: e.message };
      });
  }
  function buildColumns(p){
    var chain = ancestorPaths(p);
    var jobs = [];
    state.columns = [];
    for (var i = 0; i < chain.length; i++) {
      (function(idx, cp){ jobs.push(loadColumn(idx, cp)); })(i, chain[i]);
    }
    return Promise.all(jobs);
  }
  function renderCols(){
    if (!state.columns.length) { colsEl.innerHTML = '<div class="fn-col-empty">Loading…</div>'; return; }
    var h = "";
    state.columns.forEach(function(col, ci){
      h += '<div class="fn-col" data-col="' + ci + '">';
      if (col.error) h += '<div class="fn-col-empty">' + esc(col.error) + "</div>";
      else if (!col.items.length) h += '<div class="fn-col-empty">Empty</div>';
      else col.items.forEach(function(it){
        var isSel = (ci + 1 < state.columns.length && state.columns[ci + 1].path === it.path)
          || (state.selection && state.selection.path === it.path);
        h += '<div class="fn-col-item' + (isSel ? " sel" : "") + '" data-col="' + ci + '" data-path="' + esc(it.path) + '" data-type="' + esc(it.type) + '">'
          + '<span class="' + icoCls(it) + '">' + glyphFor(it) + '</span><span class="nm">' + esc(it.name) + "</span>"
          + (it.type === "dir" ? '<span class="chev">' + ICONS.chevronRight + "</span>" : "")
          + "</div>";
      });
      h += "</div>";
    });
    h += '<div class="fn-col preview">';
    var sel = state.selection;
    if (sel && sel.type === "dir") {
      h += '<div class="fn-pv"><div class="big" style="color:' + (sel.git && sel.git.isRepo ? "var(--ok)" : "var(--fn-accent)") + '">' + ICONS.folder + "</div><h3>" + esc(sel.name) + "</h3>"
        + '<div class="kind">Folder' + (sel.git && sel.git.isRepo ? " · Git repository" : "") + "</div>"
        + '<div class="meta">' + (sel.mtime ? "Modified <b>" + esc(fmtTime(sel.mtime)) + "</b><br/>" : "")
        + (sel.git && sel.git.isRepo ? "Branch <b>" + esc(sel.git.branch || "?") + "</b>" + (sel.git.dirty ? " (dirty)" : "") + "<br/>" : "")
        + '<span style="opacity:.7">Double-click to open</span></div></div>';
    } else if (sel && sel.type === "file") {
      h += '<div class="fn-pv"><div class="big">' + glyphFor(sel) + "</div><h3>" + esc(sel.name) + "</h3>"
        + '<div class="kind">Document</div>'
        + '<div class="meta">' + (sel.sizeLabel ? "Size <b>" + esc(sel.sizeLabel) + "</b><br/>" : "")
        + (sel.mtime ? "Modified <b>" + esc(fmtTime(sel.mtime)) + "</b><br/>" : "")
        + '<span style="opacity:.7">Double-click to edit</span></div></div>';
    } else {
      h += '<div class="fn-col-empty" style="margin:auto">No selection</div>';
    }
    h += "</div>";
    colsEl.innerHTML = h;
    colsEl.scrollLeft = colsEl.scrollWidth;
    colsEl.querySelectorAll(".fn-col-item").forEach(function(el){
      el.addEventListener("click", function(){
        var ci = parseInt(el.getAttribute("data-col"), 10);
        var p = el.getAttribute("data-path");
        var t = el.getAttribute("data-type");
        var it = (state.columns[ci].items || []).find(function(x){ return x.path === p; });
        state.selection = it || { path: p, type: t };
        if (t === "dir") {
          state.columns = state.columns.slice(0, ci + 1);
          loadColumn(ci + 1, p).then(renderCols);
        } else {
          state.columns = state.columns.slice(0, ci + 1);
          renderCols();
        }
      });
      el.addEventListener("dblclick", function(){
        var p = el.getAttribute("data-path");
        var t = el.getAttribute("data-type");
        if (t === "dir") navigate(p, { push: true });
        else openFile(p);
      });
    });
  }

  /* ── shared cell wiring ── */
  function wireCells(root, sel){
    root.querySelectorAll(sel).forEach(function(el){
      el.addEventListener("click", function(){
        var p = el.getAttribute("data-path");
        var t = el.getAttribute("data-type");
        var it = state.items.find(function(x){ return x.path === p; });
        state.selection = it || { path: p, type: t };
        renderView();
        if (t === "file") openFile(p);
      });
      el.addEventListener("dblclick", function(){
        var p = el.getAttribute("data-path");
        var t = el.getAttribute("data-type");
        var it = state.items.find(function(x){ return x.path === p; });
        if (t === "dir") {
          if (it && it.skipped) { toast("Skipped directory (node_modules etc.)", "bad"); return; }
          navigate(p, { push: true });
        } else openFile(p);
      });
    });
  }

  /* ── view switching ── */
  function renderView(){
    iconsEl.hidden = state.view !== "icons";
    listWrap.hidden = state.view !== "list";
    colsEl.hidden = state.view !== "cols";
    document.querySelectorAll("#fnViewSeg button").forEach(function(b){
      b.classList.toggle("on", b.getAttribute("data-view") === state.view);
    });
    if (state.view === "icons") renderIcons();
    else if (state.view === "list") renderList();
    else renderCols();
  }
  document.querySelectorAll("#fnViewSeg button").forEach(function(b){
    b.addEventListener("click", function(){
      var v = b.getAttribute("data-view");
      if (v === state.view) return;
      state.view = v;
      if (v === "cols" && !state.columns.length) {
        iconsEl.hidden = true; listWrap.hidden = true; colsEl.hidden = false;
        renderCols();
        buildColumns(state.path).then(renderCols);
      } else renderView();
    });
  });

  /* ── status line ── */
  function updateStatus(data){
    var n = (state.items || []).filter(function(x){ return x.type !== "separator"; }).length;
    var st = "<span><b>" + n + "</b> item" + (n === 1 ? "" : "s") + "</span>";
    var g = data && data.git;
    if (g && g.isRepo) {
      st += ' <span class="pill ' + (g.dirty ? "warn" : "ok") + '">' + ICONS.gitBranch + " " + esc(g.branch || "?") + (g.dirty ? " · dirty" : "") + "</span>";
      if (g.remote) st += ' <span class="pill">' + esc(String(g.remote).replace(/^https?:\\/\\//, "").slice(0, 52)) + "</span>";
    }
    if (data && data.truncated) st += ' <span class="pill warn">truncated</span>';
    setStatus(st);
  }

  /* ── navigation ── */
  function navigate(p, opts){
    opts = opts || {};
    if (state.navLock) return;
    if (!confirmLeave()) return;
    state.navLock = true;
    setStatus("<span>Loading…</span>");
    var dataRef = null;
    api("/api/finder/list" + (p == null ? "" : "?path=" + encodeURIComponent(p)))
      .then(function(data){
        dataRef = data;
        state.path = data.path;
        state.items = data.items || [];
        state.breadcrumbs = data.breadcrumbs || [];
        state.selection = null;
        closeEditor();
        if (opts.push) {
          state.history = state.history.slice(0, state.histIdx + 1);
          state.history.push(p);
          state.histIdx = state.history.length - 1;
        }
        renderSidebar();
        renderPathbar();
        if (state.view === "cols") {
          state.columns = [];
          return buildColumns(state.path).then(function(){ renderView(); });
        }
        renderView();
      })
      .then(function(){
        updateNavButtons();
        updateStatus(dataRef);
      })
      .catch(function(e){
        listEl.innerHTML = '<div class="fn-err">' + esc(e.message) + "</div>";
        iconsEl.innerHTML = '<div class="fn-err" style="grid-column:1/-1">' + esc(e.message) + "</div>";
        setStatus('<span style="color:var(--danger)">' + esc(e.message) + "</span>");
        toast(e.message, "bad");
      })
      .finally(function(){ state.navLock = false; });
  }
  function updateNavButtons(){
    $("fnBack").disabled = state.histIdx <= 0;
    $("fnFwd").disabled = state.histIdx < 0 || state.histIdx >= state.history.length - 1;
    $("fnUp").disabled = state.path == null;
    $("fnSave").disabled = !state.dirty;
  }

  /* ── editor column ── */
  function openEditorCol(){
    editorCol.hidden = false;
    bodyEl.classList.add("editing");
    if (window.matchMedia("(max-width:1100px)").matches) bodyEl.classList.add("show-editor");
  }
  function closeEditorCol(){
    editorCol.hidden = true;
    bodyEl.classList.remove("editing", "show-editor");
  }
  function closeEditor(){
    state.file = null; state.original = null; state.dirty = false;
    editor.hidden = true; gutter.hidden = true;
    editor.value = ""; editor.classList.remove("dirty");
    placeholder.hidden = false;
    placeholder.innerHTML = "Select a file to edit.<br/>⌘S / Ctrl+S saves. A .finder-bak backup is kept.";
    $("fnReloadFile").disabled = true;
    $("fnSave").disabled = true;
    closeEditorCol();
  }
  function syncGutter(){
    var lines = editor.value.split("\\n").length;
    var nums = "";
    for (var i = 1; i <= lines; i++) nums += i + "\\n";
    gutter.textContent = nums;
    gutter.scrollTop = editor.scrollTop;
  }
  function openFile(p){
    if (!confirmLeave()) return;
    openEditorCol();
    placeholder.hidden = false;
    placeholder.textContent = "Loading…";
    editor.hidden = true; gutter.hidden = true;
    api("/api/finder/read?path=" + encodeURIComponent(p))
      .then(function(data){
        state.file = data;
        state.original = data.content;
        state.dirty = false;
        prevTitle.textContent = data.name;
        prevSub.innerHTML = "<span>" + esc(data.path) + "</span><span>" + esc(data.sizeLabel) + "</span><span>" + esc(fmtTime(data.mtime)) + "</span>"
          + (data.writable ? "" : ' <span class="fn-badge blocked">read-only</span>');
        placeholder.hidden = true;
        editor.hidden = false; gutter.hidden = false;
        editor.value = data.content;
        editor.readOnly = !data.writable;
        editor.classList.remove("dirty");
        syncGutter();
        $("fnReloadFile").disabled = false;
        $("fnSave").disabled = true;
      })
      .catch(function(e){
        state.file = null;
        editor.hidden = true; gutter.hidden = true;
        placeholder.hidden = false;
        placeholder.innerHTML = '<span style="color:var(--danger)">' + esc(e.message) + "</span>";
        prevTitle.textContent = p.split("/").pop();
        prevSub.innerHTML = "<span>" + esc(p) + "</span>";
        toast(e.message, "bad");
      });
  }
  function saveFile(){
    if (!state.file || !state.dirty) return;
    $("fnSave").disabled = true;
    api("/api/finder/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: state.file.path, content: editor.value }),
    }).then(function(data){
      state.original = editor.value;
      state.dirty = false;
      editor.classList.remove("dirty");
      prevSub.innerHTML = "<span>" + esc(data.path) + "</span><span>" + esc(data.sizeLabel) + "</span><span>" + esc(fmtTime(data.mtime)) + '</span> <span class="fn-badge">saved</span>';
      toast("Saved" + (data.backup ? " (backup kept)" : ""), "ok");
      navigate(state.path, { push: false });
    }).catch(function(e){
      toast(e.message, "bad");
      $("fnSave").disabled = false;
    });
  }

  editor.addEventListener("input", function(){
    if (!state.file) return;
    state.dirty = editor.value !== state.original;
    editor.classList.toggle("dirty", state.dirty);
    $("fnSave").disabled = !state.dirty;
    syncGutter();
  });
  editor.addEventListener("scroll", function(){ gutter.scrollTop = editor.scrollTop; });
  editor.addEventListener("keydown", function(e){
    if (e.key === "Tab") {
      e.preventDefault();
      var s = editor.selectionStart, end = editor.selectionEnd;
      editor.value = editor.value.slice(0, s) + "  " + editor.value.slice(end);
      editor.selectionStart = editor.selectionEnd = s + 2;
      editor.dispatchEvent(new Event("input"));
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); saveFile(); }
  });

  /* ── keyboard nav ── */
  function browserKeydown(e){
    var root = state.view === "icons" ? iconsEl : state.view === "list" ? listEl : null;
    if (!root) return;
    var cells = Array.prototype.slice.call(root.querySelectorAll(".fn-row, .fn-icon-cell"));
    if (!cells.length) return;
    var idx = cells.findIndex(function(r){ return r.classList.contains("sel"); });
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      idx = Math.min(cells.length - 1, idx + 1);
      cells[idx].click(); cells[idx].scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      idx = Math.max(0, idx < 0 ? 0 : idx - 1);
      cells[idx].click(); cells[idx].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (idx >= 0) cells[idx].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    } else if (e.key === "Backspace") {
      e.preventDefault();
      $("fnUp").click();
    }
  }
  [iconsEl, listEl, colsEl].forEach(function(el){ el.addEventListener("keydown", browserKeydown); });

  filterEl.addEventListener("input", function(){
    state.filter = filterEl.value;
    if (state.view !== "cols") renderView();
  });

  /* ── toolbar wiring ── */
  $("fnBack").addEventListener("click", function(){
    if (state.histIdx <= 0) return;
    state.histIdx -= 1;
    navigate(state.history[state.histIdx], { push: false });
  });
  $("fnFwd").addEventListener("click", function(){
    if (state.histIdx >= state.history.length - 1) return;
    state.histIdx += 1;
    navigate(state.history[state.histIdx], { push: false });
  });
  $("fnUp").addEventListener("click", function(){
    if (!state.path) return;
    var trimmed = state.path.replace(/\\/+$/, "");
    var parent = trimmed.split("/").slice(0, -1).join("/");
    if (!parent) return navigate(null, { push: true });
    api("/api/finder/list?path=" + encodeURIComponent(parent))
      .then(function(){ navigate(parent, { push: true }); })
      .catch(function(){ navigate(null, { push: true }); });
  });
  $("fnSave").addEventListener("click", saveFile);
  $("fnReloadFile").addEventListener("click", function(){ if (state.file) openFile(state.file.path); });
  $("fnCloseEd").addEventListener("click", function(){ if (confirmLeave()) closeEditor(); });

  window.addEventListener("beforeunload", function(e){
    if (state.dirty) { e.preventDefault(); e.returnValue = ""; }
  });

  /* ── boot ── */
  renderSidebar();
  navigate(null, { push: true });
})();
</script>
`;

  return { extraCss, body };
}

module.exports = { makeFinderBody };
