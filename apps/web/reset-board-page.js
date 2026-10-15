// reset-board-page.js, the public, read-only view of the reset readiness board.
//
// The board itself lives in lakeside-tracker (:9741) as `ahd/reset-next`. The
// admin /tracker page renders every realm behind a session; this page renders
// one project, to anyone, with no session at all, because the point of the
// board is that the people who raise the issues can see them, and most of them
// will never have an ops login. A list only the ops admin can read is the same
// failure as no list.
//
// It also carries the ideas box: an anonymous submission form. Submissions are
// NOT rendered back to the public. An unauthenticated page that publishes
// whatever anyone types is a defacement surface, and the value here is the
// devs receiving the idea, not the internet reading it.
//
// Exports buildResetBoardPage() → a full standalone HTML document.

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

// Minimal inline markdown: **bold** and `code`, on already-escaped text. The
// bodies are authored in markdown by agents; rendering the asterisks raw looks
// like a bug, and running a markdown library on a public page for two features
// is not worth the dependency.
function inlineMd(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

// Every item body is authored as three labelled parts: what is wrong, what
// would fix it, where the fix has got to. That is the whole question anyone
// reading this page is asking, so the page renders those parts as a small
// table rather than as prose you have to mine. Bodies that predate the
// convention fall through to plain paragraphs instead of being dropped.
const PART_RE = /^\*\*(Wrong|Question|Fix|Options|Status)\.\*\*\s*/i;
const PART_LABEL = {
  wrong: "What's wrong",
  question: "The question",
  fix: "What fixes it",
  options: "The options",
  status: "Where it's at",
};

function bodyHtml(s) {
  const paras = String(s || "").split(/\n{2,}/).filter((p) => p.trim());
  const parts = [];
  const loose = [];
  for (const p of paras) {
    const m = PART_RE.exec(p.trim());
    if (m) parts.push([m[1].toLowerCase(), p.trim().replace(PART_RE, "")]);
    else loose.push(p);
  }
  const table = parts.length
    ? `<dl class="parts">${parts
        .map(
          ([k, v]) =>
            `<dt class="${k === "status" ? "st" : ""}">${PART_LABEL[k]}</dt><dd>${inlineMd(v).replace(/\n/g, "<br>")}</dd>`,
        )
        .join("")}</dl>`
    : "";
  const rest = loose.map((p) => `<p>${inlineMd(p).replace(/\n/g, "<br>")}</p>`).join("");
  return table + rest;
}

const CSS = `
:root{color-scheme:dark;--bg:#0a0d14;--surface:#111621;--surface-2:#161c29;--border:#1f2736;--border-2:#2c3548;--text:#e8ecf3;--text-2:#a6b0c2;--text-3:#6c7789;--accent:#7dd3fc;--warn:#f0b354;--good:#5fd39a;--bad:#f08a8a;--mono:JetBrains Mono,ui-monospace,SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 Inter,system-ui,-apple-system,Segoe UI,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:900px;margin:0 auto;padding:34px 18px 80px;display:flex;flex-direction:column;gap:22px}

header.hd{display:flex;flex-direction:column;gap:8px}
.eyebrow{font:700 .68rem/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--text-3)}
h1{margin:0;font-size:1.6rem;font-weight:700;letter-spacing:-.025em}
.lede{margin:0;color:var(--text-2);font-size:.95rem;max-width:64ch}
.lede strong{color:var(--text)}

.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
.stat{border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:12px 14px}
.stat .n{font:700 1.45rem/1 var(--mono);letter-spacing:-.03em}
.stat .l{margin-top:5px;color:var(--text-3);font-size:.68rem;text-transform:uppercase;letter-spacing:.07em;font-weight:700}
.stat.warn .n{color:var(--warn)} .stat.good .n{color:var(--good)}

details.grp{border:1px solid var(--border);border-radius:13px;background:var(--surface);overflow:hidden}
details.grp > summary{list-style:none;cursor:pointer;padding:14px 16px;display:flex;justify-content:space-between;gap:10px;align-items:center}
details.grp > summary::-webkit-details-marker{display:none}
details.grp > summary:hover{background:var(--surface-2)}
details.grp > summary h2{margin:0;font-size:.76rem;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--text-2);display:flex;align-items:center;gap:9px}
details.grp > summary h2::before{content:"";width:6px;height:6px;border-right:1.5px solid var(--text-3);border-bottom:1.5px solid var(--text-3);transform:rotate(-45deg);transition:transform .15s;flex:none}
details.grp[open] > summary h2::before{transform:rotate(45deg)}
.gcount{font:600 .72rem var(--mono);color:var(--text-3);flex:none}
.gcount b{color:var(--warn);font-weight:700}

/* An item row is title-first. On a phone the title is the only thing that
   matters, so it wraps to as many lines as it needs and the status chips drop
   underneath it, rather than the title being ellipsed to make room for a chip
   nobody came here to read. */
details.item{border-top:1px solid var(--border)}
details.item > summary{list-style:none;cursor:pointer;padding:12px 16px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;align-items:start}
details.item > summary::-webkit-details-marker{display:none}
details.item > summary:hover{background:var(--surface-2)}
.item.done .ttl{color:var(--text-2)}
.ttl{min-width:0;font-size:.92rem;line-height:1.4;overflow-wrap:anywhere}
.item.blocked .ttl::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--warn);margin-right:7px;vertical-align:middle}
.item.done .ttl::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--good);margin-right:7px;vertical-align:middle}
.chips{display:flex;gap:5px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.chip{padding:2px 8px;border-radius:999px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-3);font:700 .64rem/1.5 var(--mono);white-space:nowrap}
.chip.blocked{border-color:color-mix(in srgb,var(--warn) 45%,var(--border));color:var(--warn)}
.chip.active{border-color:color-mix(in srgb,var(--accent) 45%,var(--border));color:var(--accent)}
.chip.done{border-color:color-mix(in srgb,var(--good) 45%,var(--border));color:var(--good)}
.chip.p0{border-color:color-mix(in srgb,var(--bad) 45%,var(--border));color:var(--bad)}
.chip.focus{border-color:color-mix(in srgb,var(--accent) 55%,var(--border));background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent)}
.detail{padding:2px 16px 16px;color:var(--text-2);font-size:.87rem}
.detail p{margin:.5em 0} .detail code{font-family:var(--mono);font-size:.85em;background:var(--surface-2);padding:1px 5px;border-radius:4px}
.detail strong{color:var(--text)}
dl.parts{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:5px 16px;margin:2px 0 0}
dl.parts dt{font:700 .64rem/1.7 var(--mono);letter-spacing:.07em;text-transform:uppercase;color:var(--text-3);white-space:nowrap}
dl.parts dt.st{color:var(--accent)}
dl.parts dd{margin:0;line-height:1.55}
@media(max-width:600px){dl.parts{grid-template-columns:1fr;gap:2px}dl.parts dt{margin-top:9px}}
.why{margin:.6em 0 0;padding:8px 11px;border-left:2px solid var(--warn);background:color-mix(in srgb,var(--warn) 7%,transparent);color:var(--warn);font-size:.82rem;border-radius:0 6px 6px 0}
.detail a{color:var(--accent)}

details.grp.plan{border-color:color-mix(in srgb,var(--accent) 28%,var(--border))}
.planwrap{border-top:1px solid var(--border);padding:14px 16px 18px;display:flex;flex-direction:column;gap:16px}
.wave{display:grid;grid-template-columns:auto minmax(0,1fr);gap:13px}
.wn{font:700 .66rem/1.6 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--accent);border:1px solid color-mix(in srgb,var(--accent) 40%,var(--border));border-radius:999px;padding:1px 9px;height:fit-content;white-space:nowrap}
.wb h3{margin:0 0 3px;font-size:.93rem;font-weight:700;letter-spacing:-.01em}
.wwhy{margin:0 0 7px;color:var(--text-3);font-size:.82rem;line-height:1.5}
.wb ol{margin:0;padding-left:1.15em;color:var(--text-2);font-size:.86rem;line-height:1.55}
.wb ol li{margin:.28em 0}
.skip{border-top:1px solid var(--border);padding-top:13px}
.skip h3{margin:0 0 5px;font:700 .66rem/1.6 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--text-3)}
.skip ul{margin:0;padding-left:1.15em;color:var(--text-2);font-size:.85rem;line-height:1.55}
@media(max-width:620px){.wave{grid-template-columns:1fr;gap:4px}.wn{justify-self:start}}

.box{border:1px solid var(--border);border-radius:13px;background:var(--surface);padding:17px 18px;display:flex;flex-direction:column;gap:12px}
.box h2{margin:0;font-size:1.02rem;font-weight:700;letter-spacing:-.02em}
.box p{margin:0;color:var(--text-2);font-size:.88rem}
textarea,select{width:100%;font:inherit;font-size:.9rem;color:var(--text);background:var(--bg);border:1px solid var(--border-2);border-radius:10px;padding:10px 12px;outline:none;resize:vertical}
textarea:focus,select:focus{border-color:var(--accent)}
textarea{min-height:110px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.row select{width:auto;min-width:170px}
button{font:600 .88rem inherit;padding:.6rem 1.15rem;border-radius:10px;border:1px solid var(--accent);background:var(--accent);color:#06121c;cursor:pointer}
button:disabled{opacity:.5;cursor:default}
.count{margin-left:auto;font:.72rem var(--mono);color:var(--text-3)}
.msg{display:none;font-size:.85rem;border-radius:10px;padding:9px 12px}
.msg.on{display:block}
.msg.ok{border:1px solid color-mix(in srgb,var(--good) 45%,var(--border));color:var(--good);background:color-mix(in srgb,var(--good) 8%,transparent)}
.msg.err{border:1px solid color-mix(in srgb,var(--bad) 45%,var(--border));color:var(--bad);background:color-mix(in srgb,var(--bad) 8%,transparent)}

.err-banner{border:1px solid color-mix(in srgb,var(--bad) 45%,var(--border));background:color-mix(in srgb,var(--bad) 8%,transparent);color:var(--bad);border-radius:12px;padding:13px 15px;font-size:.88rem}
footer{color:var(--text-3);font-size:.78rem;border-top:1px solid var(--border);padding-top:14px}
footer a{color:var(--text-2)}
.inbox{border-color:color-mix(in srgb,var(--accent) 30%,var(--border))}
.idea{border-top:1px solid var(--border);padding:11px 0;font-size:.87rem;color:var(--text-2);white-space:pre-wrap;word-break:break-word}
.idea .meta{font:.7rem var(--mono);color:var(--text-3);margin-bottom:4px}
@media(max-width:620px){
.wrap{padding:20px 12px 56px;gap:16px}
h1{font-size:1.3rem}
.lede{font-size:.9rem}
details.item > summary{grid-template-columns:minmax(0,1fr)}
.chips{justify-content:flex-start}
.stats{grid-template-columns:1fr 1fr}
}
`;


// The plan. The board says what is wrong; this says what order to fix it in and
// why that order. It is editorial, so it lives here rather than in the tracker:
// the sequencing changes when a decision lands, not when an item does.
const WAVES = [
  {
    n: "Fix now",
    title: "Two bugs that should not wait for a reset",
    why: "Both are live and one of them is corrupting other countries' economies every time a bill passes. Every claim on this board was re-verified against code and prod on 2026-09-05.",
    steps: [
      "A bill that resolves to a macro metric applies its delta to every region in the world, because the filter is empty. The political branch beside it was already fixed for this.",
      "Idle upkeep bills demand-throttled capacity as owner overbuild at a cost basis frozen on a starved first turn: a healthcare plant with capacity 17,600 units sells 1,500 and pays 8M upkeep on 3M revenue. This is what makes healthcare, entertainment and extraction permanent traps. The throughput-floor explanation was checked and dropped.",
    ],
  },
  {
    n: "Now",
    title: "Decide, and build the thing that measures",
    why: "Nothing below can be scoped until the era and country set land, and no balance change can be tuned until the harness exists.",
    steps: [
      "Owner call on era, country set and the no-org iteration, against the real option set: 1953, 1979, 1991 or 2019 (1999, 2007 and 2023 exist as US-only reskins). There is no 1973.",
      "Build the election A/B sweep harness. It gates the death-spiral fix, the manifesto vote effect and five presidential knobs.",
    ],
  },
  {
    n: "1",
    title: "The reason iterations die",
    why: "This is the failure that ends every world. A reset without it just restarts the clock, which is the whole argument for having this board.",
    steps: [
      "Election balance audit: decompose winning margins by channel over the last iteration.",
      "Fix what the audit names, measured through the harness. Current suspects: incumbency at roughly a tenth of its intended weight, favorability at roughly eleven times it.",
      "Catch-up for the trailing party, designed by Danica and Berry, swept before it ships.",
      "Fix the granular lean maths. The recalibrated era leans are already live on prod US; reseed the UK, RU and DD at the reset, which is free at t0.",
    ],
  },
  {
    n: "2",
    title: "Make the levers do something",
    why: "Players legislate and the number does not move. Outside the four catalog countries a law is a one-shot nudge of two to six hundredths of a point on the turn it passes, because those countries have no law ladder at all.",
    steps: [
      "Give the non-catalog countries a real law ladder, or scale the legacy bridge to one catalog level.",
      "Set a perception floor: any lever that cannot visibly move its target within a term gets rescaled or removed. Over the last game year 12 of 63 US metrics moved exactly zero and 17 more moved under a tenth of a point.",
      "Wire or delete the three dead levers: minimum wage, conscription, policy reactions.",
      "Map the nine unmapped budget categories, or stop charging for them. The unmapped bucket is 17bn of 129bn programme spending, and the typed catalog books environment and governance laws into it too.",
      "Give income, payroll, capital gains, excise and property taxes a behavioural and a political consequence, not just revenue. Sales tax and tariffs already have one.",
    ],
  },
  {
    n: "3",
    title: "Give regions a reason to differ",
    why: "State policy is stored per state and identical in 24 of 26 countries. A national law applies the same delta to every region.",
    steps: [
      "Vary the national fan-out by regional characteristics instead of applying the same delta everywhere.",
      "Open more of the 63 metrics to state legislation. Today 39 of them have no state-enactable law at all.",
      "Give states a reason to spend: 31 of 51 US states spend exactly zero while treasuries hoard.",
      "Give the UK a regional tax law at all, read the enacted council tax and business rates instead of a GDP share, and make Japan's regional budget read the rates its laws already write.",
    ],
  },
  {
    n: "4",
    title: "Stabilise the economy, then the markets",
    why: "The volatility is mostly one formula, and the sector traps are mostly one cost line. Fix those before tuning anything downstream of them.",
    steps: [
      "Damp the output-gap term and clamp the sector signal after smoothing, not before. 28% of regions currently sit exactly on a bound.",
      "Mirror the live national growth into the budget page every turn. It currently shows a once-a-year snapshot from the top of the wave, eleven points off the live number.",
      "Aggregate regional growth for the eight countries with no national metrics doc, so forex and legitimacy stop reading a seed constant.",
      "Record truncated demand first: a 1.5x demand cap is what pins coal, timber, fertilizers and rare earth at exactly a third short, and every shortage number on this board is measured after that cap.",
      "Then the rest: supply response off the floor, extraction placement, labour tightness into unemployment, era-aware GDP baselines.",
    ],
  },
  {
    n: "5",
    title: "Corps players can trust",
    why: "Ordered by what a player can see. The first two are cheap and visible today.",
    steps: [
      "Count fund units in wealth, and show a margin that includes upkeep so the trap is visible.",
      "Put the public API on the same profit basis as the corp page.",
      "Enforce the wash-trade flags that already exist, and cap single-name weight in index funds.",
      "Repair the valuation anchors instead of clamping them, and cap policy credit against the bill it offsets. Extraction book value was already re-anchored in #1039.",
    ],
  },
  {
    n: "6",
    title: "The presidential race",
    why: "Independent of the rest. Turnout is saturated at the eligible-population ceiling, and six apportionment calls omit the year, so DC has been missing three electoral votes since 1961.",
    steps: [
      "Apply the electorate cap after the multipliers, and cap at expected turnout rather than the whole eligible population.",
      "Split Maine and Nebraska district pools by district population. It will not fire at 1972 in this world until the apportionment year is passed through; immediate in a modern era.",
      "Pass the apportionment year everywhere and derive the electoral total from the era map instead of a hardcoded 538.",
      "Calibrate the five v3 knobs that currently sit at identity. Needs the harness.",
    ],
  },
  {
    n: "7",
    title: "The UK, if the UK is playable",
    why: "If it is one of two playable countries, half the player base lives here, and the two headline systems have never executed.",
    steps: [
      "Move the confidence tick out of the one-time seed, upsert the gauge write, and wire dissolution to call an election. NHS falls out of the same fix.",
      "Turn on the manifesto vote effect once its magnitude is calibrated, and call the broken-promise evaluator.",
      "Integrate the cores that already merged: Commons by-elections on the existing governor by-election engine, leadership removal, reshuffle cap.",
      "Only then build what does not exist: recall petitions and conferences.",
    ],
  },
  {
    n: "8",
    title: "The world, scoped by the era choice",
    why: "Half of this disappears depending on the era, so it deliberately comes after the decision.",
    steps: [
      "Cold War eras: wire the three tension dials into procurement and diplomacy (the tension scalar itself already drives events, counter-intel and Vietnam), decide whether nuclear weapons are ever used, author a conflict that outlives 1975 (all seven authored windows close by then), and add France and China plus post-1968 anchors to nuclear seeding.",
      "Modern era: skip the above, author EU membership per era instead. The Non-Aligned Movement already founded on prod with zero members, which is what the EU will do at 1993.",
      "Either way: Bretton Woods gets wired or deleted, and orders of battle and population anchors get authored for the era chosen.",
    ],
  },
  {
    n: "9",
    title: "Execute the reset",
    why: "Gates, in order. Each one has burned a previous reset.",
    steps: [
      "Author the named gaps in the chosen era.",
      "Seven registry migrations have no prod marker; run the index-only one now and confirm the reseed moots the six backfills.",
      "Verified backup by artifact (latest is 9.5G uncompressed), plus a real restore, plus a named dump, because only named dumps survive the two-day prune.",
      "Rehearse in the sandbox: chosen era, chosen countries, no parties, twenty turns, played as a player.",
      "Read the seed diagnostic output, especially its silent-fallback check.",
      "Announce with carryover stated, then watch the first twenty turns and the first election.",
    ],
  },
];

const SKIP = [
  "Do not build 1973. It does not exist, and standing it up is roughly the 1979 workload.",
  "Do not chase the phantom cash on corp 643 (234M and falling). The reset clears it for free.",
  "Do not tune sector margins or commodity prices before the upkeep fix, the output-gap fix and the truncated-demand metric land. Everything downstream of them is currently measuring the bug or the cap.",
  "Do not add a third playable country. There is no player base for it.",
  "Do not spend on the Cold War arc until the era is decided. A modern era deletes the question.",
];

function planHtml() {
  const waves = WAVES.map(
    (w) => `<div class="wave"><div class="wn">${esc(w.n)}</div><div class="wb"><h3>${esc(w.title)}</h3><p class="wwhy">${esc(w.why)}</p><ol>${w.steps
      .map((x) => `<li>${esc(x)}</li>`)
      .join("")}</ol></div></div>`,
  ).join("");
  return `<details class="grp plan" open>
  <summary><h2>The order of work</h2><span class="gcount">${WAVES.length} waves</span></summary>
  <div class="planwrap">${waves}
  <div class="skip"><h3>Not worth doing</h3><ul>${SKIP.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
  </div>
</details>`;
}

const STATUS_CLASS = {
  open: "",
  active: "active",
  blocked: "blocked",
  done_branch: "done",
  done_dev: "done",
  done_prod: "done",
  done: "done",
  dropped: "done",
};

function renderItem(it) {
  const sc = STATUS_CLASS[it.status] || "";
  const isDone = sc === "done";
  const chips = [];
  if ((it.tags || []).includes("focus")) chips.push('<span class="chip focus">Main focus</span>');
  if (it.status !== "open") chips.push(`<span class="chip ${sc}">${esc(it.status_label || it.status)}</span>`);
  if ((it.tags || []).includes("p0")) chips.push('<span class="chip p0">P0</span>');
  if (it.issue) {
    const num = String(it.issue).replace(/^.*#/, "#");
    chips.push(`<span class="chip">${esc(num)}</span>`);
  }
  const why = it.blocked_by ? `<div class="why">Blocked: ${esc(it.blocked_by)}</div>` : "";
  const detail = it.body || it.blocked_by ? `<div class="detail">${bodyHtml(it.body)}${why}</div>` : "";
  return `<details class="item ${sc}${isDone ? " done" : ""}">
  <summary><span class="ttl">${esc(it.title)}</span>${chips.length ? `<span class="chips">${chips.join("")}</span>` : ""}</summary>
  ${detail}
</details>`;
}

// Phase order is editorial, not alphabetical: you decide, then you fix, then
// you reseed, then you ship it to players. A board that lists Cutover first
// tells the reader the wrong story about what happens next.
const PHASE_ORDER = [
  "Decisions",
  "Politics and elections",
  "Policy and player levers",
  "Presidential race",
  "UK Westminster",
  "Corporations",
  "Markets and economy",
  "World and Cold War",
  "Reset mechanics",
  "Cutover",
];

function buildResetBoardPage({ phases = [], project = null, error = null, ideas = null, ideaCount = 0 } = {}) {
  const ordered = [...phases].sort((a, b) => {
    const ia = PHASE_ORDER.indexOf(a.name);
    const ib = PHASE_ORDER.indexOf(b.name);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const all = ordered.flatMap((p) => p.items);
  const openN = all.filter((i) => i.status === "open").length;
  const blockedN = all.filter((i) => i.status === "blocked").length;
  const doneN = all.filter((i) => String(i.status).startsWith("done")).length;
  const decisionsN = all.filter((i) => (i.tags || []).includes("decision")).length;

  const groups = ordered
    .map((p) => {
      const blocked = p.items.filter((i) => i.status === "blocked").length;
      const count = `${p.items.length}${blocked ? ` · <b>${blocked} blocked</b>` : ""}`;
      return `<details class="grp"${p.name === "Decisions" ? " open" : ""}>
  <summary><h2>${esc(p.name)}</h2><span class="gcount">${count}</span></summary>
${p.items.map(renderItem).join("\n")}</details>`;
    })
    .join("\n");

  const banner = error
    ? `<div class="err-banner">The tracker service did not answer, so this list may be missing or stale: ${esc(error)}. Nothing has been lost, the board lives in the tracker, not on this page.</div>`
    : "";

  // Admin-only: the submitted ideas, so they can be triaged onto the board.
  const inbox =
    ideas === null
      ? ""
      : `<section class="box inbox">
  <h2>Ideas box, ${ideas.length} unreviewed</h2>
  <p>Visible to ops admins only. Triage each onto the board as a child of <code>ahd/reset-next</code>, then delete it.</p>
  ${
    ideas.length
      ? ideas
          .map(
            (i) =>
              `<div class="idea"><div class="meta">${esc(new Date(i.createdAt).toISOString().slice(0, 16).replace("T", " "))} · ${esc(i.area || "unsorted")}</div>${esc(i.text)}</div>`,
          )
          .join("")
      : '<div class="idea">Nothing submitted yet.</div>'
  }
</section>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Reset readiness board · A House Divided</title>
<style>${CSS}</style>
</head><body><div class="wrap">

<header class="hd">
  <div class="eyebrow">A House Divided · pre-reset</div>
  <h1>Reset readiness board</h1>
  <p class="lede">What is broken, and what is still undecided, <strong>before the next iteration resets</strong>. Resetting on top of broken systems just restarts the clock.</p>
  <p class="lede">Tap any line for what is wrong, what would fix it, and where that fix has got to. Missing something? The ideas box at the bottom is anonymous.</p>
</header>
${banner}

<div class="stats">
  <div class="stat"><div class="n">${all.length}</div><div class="l">Tracked</div></div>
  <div class="stat"><div class="n">${decisionsN}</div><div class="l">Decisions open</div></div>
  <div class="stat warn"><div class="n">${blockedN}</div><div class="l">Blocked</div></div>
  <div class="stat good"><div class="n">${doneN}</div><div class="l">Done</div></div>
</div>

${planHtml()}

${groups || '<div class="err-banner">No items on the board yet.</div>'}

${inbox}

<section class="box" id="ideas">
  <h2>Ideas box</h2>
  <p>Anything you think should be looked at or fixed before the reset. Anonymous: no name, no account, nothing tied back to you. It goes straight to the dev list, it is not published on this page.</p>
  <div class="row">
    <select id="area" aria-label="Area">
      <option value="politics">Politics / elections</option>
      <option value="economy">Economy / markets / corps</option>
      <option value="world">World / countries / Cold War</option>
      <option value="iteration">Next iteration design</option>
      <option value="other" selected>Anything else</option>
    </select>
    <span class="count" id="count">0 / 2000</span>
  </div>
  <textarea id="text" maxlength="2000" placeholder="What is broken, or what should we look at before we reset?"></textarea>
  <div class="row"><button id="send">Send anonymously</button></div>
  <div class="msg" id="msg"></div>
</section>

<footer>Board id <code>ahd/reset-next</code>, stored in the ops tracker. ${ideaCount ? `${ideaCount} ideas submitted so far. ` : ""}Live view, updated whenever an item changes.</footer>

</div>
<script>
(function(){
  var t=document.getElementById('text'),c=document.getElementById('count'),b=document.getElementById('send'),m=document.getElementById('msg'),a=document.getElementById('area');
  function show(cls,txt){m.className='msg on '+cls;m.textContent=txt;}
  t.addEventListener('input',function(){c.textContent=t.value.length+' / 2000';});
  b.addEventListener('click',function(){
    var v=t.value.trim();
    if(v.length<8){show('err','Say a bit more than that.');return;}
    b.disabled=true;show('ok','Sending…');
    fetch('/api/reset-ideas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:v,area:a.value})})
      .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
      .then(function(res){
        if(res.ok){t.value='';c.textContent='0 / 2000';show('ok','Sent. Thanks, it is on the dev list.');}
        else{show('err',res.j&&res.j.error?res.j.error:'Could not send that.');}
      })
      .catch(function(){show('err','Could not reach the server.');})
      .finally(function(){b.disabled=false;});
  });
})();
</script>
</body></html>`;
}

module.exports = { buildResetBoardPage, PHASE_ORDER };
