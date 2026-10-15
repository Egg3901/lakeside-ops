"use strict";

// Shared visual layer for the dashboard shell and injected legacy navigation.
// The rail remains dark in both themes so navigation has a stable landmark.
const WORKBENCH_CSS = `
:root{--sb-w:258px;--rail:#152333;--rail-2:#1d3043;--rail-line:rgba(222,233,245,.11);--rail-text:#eef3f9;--rail-muted:#9bacbe}
.ahd-sb{background:var(--rail);border-right:1px solid #0d1c2b;box-shadow:8px 0 28px rgba(13,28,43,.07)}
.ahd-sb::-webkit-scrollbar-thumb{background:rgba(222,233,245,.16)}
.sb-brand{min-height:92px;gap:12px;padding:20px 18px;margin:0;border-bottom:1px solid var(--rail-line);color:var(--rail-text)}
.sb-brand:hover{color:#fff}
.sb-brand-mark{position:relative;width:42px;height:42px;flex:0 0 42px;display:grid;place-items:center;border:1px solid rgba(198,214,255,.32);border-radius:11px;background:linear-gradient(145deg,#4968d7,#2e4bb0);box-shadow:0 6px 16px rgba(21,37,100,.25);color:#fff;font:750 1.15rem var(--font);overflow:hidden}
.sb-brand-logo{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.sb-brand-copy{display:flex;flex-direction:column;min-width:0;gap:2px}
.sb-brand-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.91rem;letter-spacing:-.02em}
.sb-brand-copy small{font-size:.65rem;letter-spacing:.11em;text-transform:uppercase;color:var(--rail-muted);font-weight:650}
.sb-nav{padding:14px 11px 18px;overflow:visible}
.sb-group{margin:0;border-bottom:1px solid var(--rail-line);padding:9px 0}
.sb-group:first-child{margin:0}
.sb-group-label{list-style:none;display:flex;align-items:center;justify-content:space-between;padding:7px 10px;cursor:pointer;color:var(--rail-muted);font-size:.66rem;letter-spacing:.13em;text-transform:uppercase;font-weight:750;user-select:none}
.sb-group-label::-webkit-details-marker,.sb-portfolio summary::-webkit-details-marker{display:none}
.sb-group-label:hover{color:var(--rail-text)}
.sb-group-chevron{font-size:1rem;line-height:1;transition:transform var(--t);opacity:.65}
.sb-group[open] .sb-group-chevron{transform:rotate(180deg)}
.sb-links{display:grid;gap:2px;padding:3px 0 5px}
.sb-nav a{min-height:36px;margin:0;padding:7px 10px;border:1px solid transparent;border-radius:8px;color:#b7c5d3;font-size:.81rem;font-weight:560;gap:10px}
.sb-nav a .icon{opacity:.8}
.sb-nav a:hover{color:#fff;background:rgba(218,231,255,.085)}
.sb-nav a.active{color:#fff;background:#3158c9;box-shadow:0 5px 12px rgba(6,24,77,.19);font-weight:680}
.sb-nav a.active .icon{color:#fff}
.sb-nav a .ext{opacity:.45}
.sb-portfolio{border-top:1px solid var(--rail-line);padding:11px}
.sb-portfolio summary{list-style:none;display:flex;justify-content:space-between;padding:7px 10px;cursor:pointer;color:var(--rail-muted);font-size:.66rem;letter-spacing:.13em;text-transform:uppercase;font-weight:750}
.sb-portfolio[open] summary span{transform:rotate(180deg)}
.sb-games{border:0;padding:5px 0 0;max-height:170px;overflow:auto}
.sb-games a{font-size:.78rem;color:#b7c5d3;border-radius:8px}
.sb-games a:hover{color:#fff;background:rgba(218,231,255,.085)}
.sb-foot{min-height:61px;padding:12px 17px;border-top:1px solid var(--rail-line);background:#112030}
.sb-foot .sb-version{font:600 .68rem var(--mono);color:var(--rail-muted);margin-right:auto}
.sb-foot .theme-toggle,.sb-foot .sb-modview{background:rgba(218,231,255,.06);border-color:var(--rail-line);color:var(--rail-text);border-radius:8px}
.sb-foot .theme-toggle:hover,.sb-foot .sb-modview:hover{background:rgba(218,231,255,.14);color:#fff}
.ahd-topbar{min-height:78px;padding:12px clamp(22px,3.5vw,52px);background:var(--surface);border-bottom:1px solid var(--border);box-shadow:0 1px 0 rgba(22,34,48,.025);backdrop-filter:none;-webkit-backdrop-filter:none}
.ahd-topbar .tb-context{gap:2px}
.ahd-topbar .tb-section{color:var(--accent);letter-spacing:.13em;font-size:.65rem}
.ahd-topbar .tb-title{font-size:1.28rem;font-weight:760;letter-spacing:-.035em}
.ahd-topbar .tb-actions{gap:10px}
.ahd-topbar .tb-status{border-radius:8px;background:var(--bg-0);padding:8px 11px;font-weight:650}
.ahd-topbar .tb-status::before{background:var(--green)}
.ahd-topbar .cmdk-trigger{min-width:170px;justify-content:flex-start;padding:8px 10px;border-radius:8px;background:var(--bg-0);font-size:.76rem}
.ahd-topbar .cmdk-trigger kbd{margin-left:auto}
.ahd-main{max-width:none;padding:28px clamp(22px,3.5vw,52px) 80px}
body{background:var(--bg-0)}
@media(max-width:860px){
  .ahd-topbar{min-height:66px;padding:9px 18px}
  .ahd-main{padding:22px 18px 70px}
  .ahd-sb{box-shadow:16px 0 40px rgba(6,16,27,.35)}
}
@media(max-width:560px){
  .ahd-main{padding:18px 14px 60px}
  .ahd-topbar .tb-title{font-size:1rem}
  .ahd-topbar .cmdk-trigger{min-width:0;width:38px;height:38px;justify-content:center}
  .ahd-topbar .cmdk-trigger kbd{display:none}
}
`;

module.exports = { WORKBENCH_CSS };
