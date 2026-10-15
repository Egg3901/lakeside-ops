// AHD Comprehensive Codebase Audit Report
// Read-only audit findings compiled into a dashboard page template
// This module exports the AUDIT_PAGE_HTML string for injection into server.js

const { icon, faviconFor, THEME_HEAD, themeToggle, THEME_TOGGLE_JS } = require('./ui-kit');

function makeAuditPage(fontLinks, baseCss) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Lakeside Ops — Codebase Audit</title>
${THEME_HEAD}
<link rel="icon" href="${faviconFor('search')}">
${fontLinks}
<style>${baseCss}
.container{max-width:1100px}
.audit-header{display:flex;align-items:center;gap:var(--s-4);margin-bottom:var(--s-6);flex-wrap:wrap}
.audit-header h1{font-size:clamp(1.3rem,3vw,1.7rem);font-weight:800;letter-spacing:-.02em}
.audit-header .badge{display:inline-flex;align-items:center;gap:.35rem;padding:.35rem .7rem;border-radius:var(--r-sm);font-size:.75rem;font-weight:600;border:1px solid var(--border);background:var(--glass-2)}
.audit-header .badge.p0{color:var(--red);border-color:color-mix(in srgb,var(--red) 35%,var(--border));background:color-mix(in srgb,var(--red) 8%,var(--glass-2))}
.audit-header .badge.p1{color:var(--amber);border-color:color-mix(in srgb,var(--amber) 35%,var(--border));background:color-mix(in srgb,var(--amber) 8%,var(--glass-2))}
.audit-header .badge.p2{color:var(--cyan);border-color:color-mix(in srgb,var(--cyan) 35%,var(--border));background:color-mix(in srgb,var(--cyan) 8%,var(--glass-2))}
.audit-header .badge.p3{color:var(--text-2)}

.tabbar{display:flex;gap:var(--s-1);margin-bottom:var(--s-6);border-bottom:1px solid var(--border);overflow-x:auto}
.tabbar button{white-space:nowrap;padding:.55rem .9rem;font-size:.85rem;font-weight:600;color:var(--text-3);background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;transition:all var(--t)}
.tabbar button:hover{color:var(--text)}
.tabbar button.active{color:var(--accent);border-bottom-color:var(--accent)}

.panel{display:none}
.panel.active{display:block}

.metric-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:var(--s-4);margin-bottom:var(--s-8)}
.metric-card{padding:var(--s-5);border-radius:var(--r-lg);border:1px solid var(--border);background:linear-gradient(180deg,var(--glass-2),var(--glass-1));backdrop-filter:var(--blur)}
.metric-value{font-size:1.6rem;font-weight:800;font-variant-numeric:tabular-nums;color:var(--text);line-height:1.2}
.metric-label{font-size:.8rem;color:var(--text-3);margin-top:.2rem;text-transform:uppercase;letter-spacing:.06em;font-weight:600}
.metric-card.ok .metric-value{color:var(--green)}
.metric-card.warn .metric-value{color:var(--amber)}
.metric-card.error .metric-value{color:var(--red)}

.issue-table{width:100%;border-collapse:collapse;font-size:.85rem;margin-bottom:var(--s-8)}
.issue-table th{text-align:left;padding:.6rem .75rem;font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);font-weight:700;border-bottom:1px solid var(--border);white-space:nowrap}
.issue-table td{padding:.55rem .75rem;border-bottom:1px solid var(--border);vertical-align:top}
.issue-table tr:hover td{background:var(--glass-hover)}
.issue-table .sev{display:inline-flex;align-items:center;gap:.35rem;padding:.2rem .5rem;border-radius:var(--r-xs);font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.sev-p0{color:var(--red);background:color-mix(in srgb,var(--red) 12%,transparent);border:1px solid color-mix(in srgb,var(--red) 25%,transparent)}
.sev-p1{color:var(--amber);background:color-mix(in srgb,var(--amber) 12%,transparent);border:1px solid color-mix(in srgb,var(--amber) 25%,transparent)}
.sev-p2{color:var(--cyan);background:color-mix(in srgb,var(--cyan) 12%,transparent);border:1px solid color-mix(in srgb,var(--cyan) 25%,transparent)}
.sev-p3{color:var(--text-2);background:var(--glass-2);border:1px solid var(--border)}
.issue-table code{font-family:var(--mono);font-size:.78rem;background:var(--bg-1);padding:1px 4px;border-radius:3px;color:var(--accent-2)}
.issue-table .file{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--mono);font-size:.78rem;color:var(--text-2)}

.system-card{margin-bottom:var(--s-6);border-radius:var(--r-lg);border:1px solid var(--border);background:linear-gradient(180deg,var(--glass-2),var(--glass-1));backdrop-filter:var(--blur);overflow:hidden}
.system-header{display:flex;align-items:center;gap:var(--s-3);padding:var(--s-4) var(--s-5);border-bottom:1px solid var(--border);cursor:pointer;transition:background var(--t)}
.system-header:hover{background:var(--glass-hover)}
.system-header h3{font-size:1rem;font-weight:700}
.system-header .count{margin-left:auto;font-size:.75rem;color:var(--text-3);font-weight:600}
.system-body{padding:var(--s-5);display:none}
.system-body.open{display:block}
.system-body p,.system-body li{font-size:.875rem;color:var(--text-2);line-height:1.65}
.system-body ul{margin:.5rem 0 .5rem 1.2rem}
.system-body li{margin-bottom:.25rem}
.system-body .finding{display:flex;gap:var(--s-3);padding:.5rem 0;border-bottom:1px solid var(--border)}
.system-body .finding:last-child{border-bottom:none}
.system-body .finding-dot{width:8px;height:8px;border-radius:50%;margin-top:.4rem;flex-shrink:0}
.system-body .finding-dot.ok{background:var(--green)}
.system-body .finding-dot.warn{background:var(--amber)}
.system-body .finding-dot.error{background:var(--red)}
.system-body .finding-text{flex:1}
.system-body .finding-text strong{color:var(--text);font-size:.85rem}
.system-body .finding-text code{font-family:var(--mono);font-size:.78rem;background:var(--bg-1);padding:1px 4px;border-radius:3px;color:var(--accent-2)}

.risk-matrix{display:grid;grid-template-columns:repeat(5,1fr);gap:2px;margin-bottom:var(--s-8);border-radius:var(--r-md);overflow:hidden;border:1px solid var(--border)}
.risk-cell{padding:var(--s-3);text-align:center;font-size:.75rem;font-weight:600}
.risk-cell.header{background:var(--bg-1);color:var(--text-3)}
.risk-cell.low{background:color-mix(in srgb,var(--green) 15%,var(--bg-1));color:var(--green)}
.risk-cell.med{background:color-mix(in srgb,var(--amber) 15%,var(--bg-1));color:var(--amber)}
.risk-cell.high{background:color-mix(in srgb,var(--red) 15%,var(--bg-1));color:var(--red)}
.risk-cell.crit{background:color-mix(in srgb,var(--red) 30%,var(--bg-1));color:var(--red);font-weight:800}

.phase-card{margin-bottom:var(--s-5);border-radius:var(--r-lg);border:1px solid var(--border);background:linear-gradient(180deg,var(--glass-2),var(--glass-1));padding:var(--s-5)}
.phase-card h4{font-size:.95rem;font-weight:700;margin-bottom:var(--s-3);display:flex;align-items:center;gap:var(--s-2)}
.phase-card h4 .num{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:var(--accent-soft);color:var(--accent);font-size:.75rem;font-weight:800}
.phase-card ul{margin-left:1.2rem;font-size:.85rem;color:var(--text-2);line-height:1.7}
.phase-card li{margin-bottom:.2rem}

.debt-bar{height:6px;border-radius:var(--r-full);background:var(--glass-2);overflow:hidden;margin:.3rem 0 .6rem}
.debt-fill{height:100%;border-radius:var(--r-full);transition:width .5s var(--ease)}
.debt-fill.high{background:var(--red)}
.debt-fill.med{background:var(--amber)}
.debt-fill.low{background:var(--green)}

@media(max-width:700px){
  .metric-grid{grid-template-columns:repeat(2,1fr)}
  .issue-table .file{max-width:140px}
  .risk-matrix{grid-template-columns:repeat(3,1fr)}
}
</style>
</head>
<body>
${themeToggle('fixed')}
<div class="container">
  <div class="topbar">
    <a href="/" class="back-link">${icon('arrow-left',{size:15})} Dashboard</a>
    <div class="page-title">${icon('search',{size:22})} Codebase Audit Report</div>
  </div>

  <div class="audit-header">
    <h1>A House Divided — Full Repo Audit</h1>
    <span class="badge p1">1 Test Failing</span>
    <span class="badge p2">20 TS Errors</span>
    <span class="badge p0">730 Silent Catches</span>
    <span class="badge p3">10,089 Tests Pass</span>
  </div>

  <div class="tabbar">
    <button class="active" onclick="showTab('summary')">Executive Summary</button>
    <button onclick="showTab('architecture')">Architecture</button>
    <button onclick="showTab('systems')">System Findings</button>
    <button onclick="showTab('issues')">Issue Register</button>
    <button onclick="showTab('debt')">Technical Debt</button>
    <button onclick="showTab('uiux')">UI/UX Audit</button>
    <button onclick="showTab('risk')">Risk Matrix</button>
    <button onclick="showTab('plan')">Remediation Plan</button>
  </div>

  <!-- EXECUTIVE SUMMARY -->
  <div id="tab-summary" class="panel active">
    <div class="metric-grid">
      <div class="metric-card"><div class="metric-value">937K</div><div class="metric-label">Lines of Code</div></div>
      <div class="metric-card"><div class="metric-value">4,966</div><div class="metric-label">TS/TSX Files</div></div>
      <div class="metric-card"><div class="metric-value">943</div><div class="metric-label">API Routes</div></div>
      <div class="metric-card"><div class="metric-value">150</div><div class="metric-label">Pages</div></div>
      <div class="metric-card ok"><div class="metric-value">10,089</div><div class="metric-label">Tests Passing</div></div>
      <div class="metric-card error"><div class="metric-value">1</div><div class="metric-label">Test Failing</div></div>
      <div class="metric-card warn"><div class="metric-value">20</div><div class="metric-label">TS Errors</div></div>
      <div class="metric-card error"><div class="metric-value">730</div><div class="metric-label">Bare Catches</div></div>
    </div>

    <div class="system-card">
      <div class="system-header" onclick="toggleSystem(this)"><h3>${icon('clipboard',{size:18})} Audit Scope</h3><span class="count">10 areas</span></div>
      <div class="system-body open">
        <p>This read-only audit inspected the entire A House Divided codebase without modifying any application logic, schemas, database code, turn processing, or production functionality. Areas covered:</p>
        <ul>
          <li><strong>Architecture & Repo Structure</strong> — module organization, coupling, dependencies</li>
          <li><strong>Next.js App Router</strong> — page patterns, RSC vs client components, caching</li>
          <li><strong>API Routes</strong> — 943 route handlers, validation, auth guards</li>
          <li><strong>MongoDB Access</strong> — connection pooling, transactions, indexes</li>
          <li><strong>Auth & Sessions</strong> — JWT (jose), cookies, role-based guards</li>
          <li><strong>Turn Processor & Cron</strong> — node-cron, processing lock, heap diagnostics</li>
          <li><strong>Elections / Legislature / NPPs</strong> — voting, bill lifecycle, NPC behavior</li>
          <li><strong>Admin / Operations</strong> — seeding, migrations, health checks</li>
          <li><strong>UI/UX Consistency</strong> — loading states, errors, skeletons, empty states</li>
          <li><strong>TypeScript / Testing / Security / Deployment</strong> — type safety, test coverage, env handling</li>
        </ul>
      </div>
    </div>

    <div class="system-card">
      <div class="system-header" onclick="toggleSystem(this)"><h3>${icon('alert-circle',{size:18})} Top-Line Findings</h3><span class="count">6 critical</span></div>
      <div class="system-body">
        <div class="finding"><div class="finding-dot error"></div><div class="finding-text"><strong>Failing auth test</strong> — <code>src/app/api/auth/login/route.test.ts</code> returns 500 instead of 200 on fingerprint persistence. Regression risk in auth flow.</div></div>
        <div class="finding"><div class="finding-dot error"></div><div class="finding-text"><strong>20 TypeScript errors</strong> — Chamber type mismatches in <code>law-types</code> routes, null safety gaps in <code>investment-funds</code>, missing properties in <code>sectors</code> route, and <code>indexFundsMode</code> not in <code>GameConfig</code> type.</div></div>
        <div class="finding"><div class="finding-dot error"></div><div class="finding-text"><strong>730 bare catch blocks</strong> — <code>catch {}</code> across <code>src/</code> swallows errors silently. Makes debugging extremely difficult and hides runtime failures.</div></div>
        <div class="finding"><div class="finding-dot warn"></div><div class="finding-text"><strong>Turn system is a coupling hotspot</strong> — <code>src/lib/turn/</code> has 270 cross-boundary imports touching elections, corporations, bonds, budget, legislature, forex, commodities, crises, NPPs, and notifications.</div></div>
        <div class="finding"><div class="finding-dot warn"></div><div class="finding-text"><strong>2,021 any/unknown usages</strong> in <code>src/lib/</code> erode type safety across the codebase.</div></div>
        <div class="finding"><div class="finding-dot warn"></div><div class="finding-text"><strong>Minimal Next.js caching</strong> — Only 17 uses of <code>revalidatePath</code>/<code>revalidateTag</code> across 937K lines. 436 client components suggest heavy client-side rendering.</div></div>
      </div>
    </div>
  </div>

  <!-- ARCHITECTURE -->
  <div id="tab-architecture" class="panel">
    <div class="system-card">
      <div class="system-header" onclick="toggleSystem(this)"><h3>${icon('package',{size:18})} Repo Structure</h3><span class="count">Flat modular</span></div>
      <div class="system-body open">
        <p>AHD uses a <strong>flat modular architecture</strong> — <code>src/lib/&lt;feature&gt;/</code> with 80+ feature directories. This is modular and works well at scale. The codebase is <strong>7.5× larger</strong> than Corporate Warfare (937K vs 125K lines).</p>
        <ul>
          <li><code>src/app/</code> — 1,947 files, 1,414 directories. 150 pages, 42 layouts, 11 loading.tsx, 9 error.tsx</li>
          <li><code>src/lib/</code> — 96 top-level feature directories, 183 total subdirectories</li>
          <li><code>src/components/</code> — 626 files across 78 directories</li>
          <li><code>src/app/api/</code> — 943 route files (129K lines of route handler code)</li>
          <li><code>src/lib/db/types/</code> — 153 type definition files (the "shared kernel")</li>
        </ul>
      </div>
    </div>

    <div class="system-card">
      <div class="system-header" onclick="toggleSystem(this)"><h3>${icon('bar-chart',{size:18})} Module Sizes</h3><span class="count">Largest modules</span></div>
      <div class="system-body">
        <table class="issue-table">
          <tr><th>Module</th><th>Files</th><th>Lines</th><th>Exports</th><th>Cross-Imports</th></tr>
          <tr><td><code>src/lib/turn/</code></td><td>282</td><td>87,169</td><td>347</td><td>270</td></tr>
          <tr><td><code>src/lib/corporations/</code></td><td>105</td><td>16,512</td><td>177</td><td>225</td></tr>
          <tr><td><code>src/lib/elections/</code></td><td>54</td><td>10,073</td><td>87</td><td>112</td></tr>
          <tr><td><code>src/lib/congress/</code></td><td>38</td><td>8,619</td><td>73</td><td>109</td></tr>
          <tr><td><code>src/lib/budget/</code></td><td>23</td><td>6,514</td><td>55</td><td>26</td></tr>
        </table>
      </div>
    </div>

    <div class="system-card">
      <div class="system-header" onclick="toggleSystem(this)"><h3>${icon('git-branch',{size:18})} Import Patterns</h3><span class="count">Shared infrastructure</span></div>
      <div class="system-body">
        <p>Shared infrastructure is deeply embedded and imported thousands of times:</p>
        <ul>
          <li><code>@/lib/mongodb</code> — 1,046 total imports (871 from API routes, 175 from lib)</li>
          <li><code>@/lib/db/types</code> — 1,530 total imports (545 from API routes, 985 from lib)</li>
          <li><code>@/lib/api/errors</code> — 50 API route imports (every route needs this)</li>
          <li><code>@/lib/constants/countries</code> — 412 API route imports</li>
          <li><code>@/lib/api/requireAuth</code> — 380 API route imports</li>
        </ul>
        <p>This is the "shared kernel" in DDD terms. It's already centralized — moving files wouldn't change functionality.</p>
      </div>
    </div>
  </div>

  <!-- SYSTEM FINDINGS -->
  <div id="tab-systems" class="panel">
    <div class="system-card">
      <div class="system-header" onclick="toggleSystem(this)"><h3>${icon('zap',{size:18})} Next.js App Router</h3><span class="count">Mixed patterns</span></div>
      <div class="system-body open">
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>Root loading.tsx</strong> — Comprehensive skeleton shell mirroring navbar + content layout. Good pattern.</div></div>
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>Root error.tsx</strong> — Network-aware error detection with custom messages for fetch failures vs runtime errors.</div></div>
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>not-found.tsx</strong> — Political flavor text ("impeached, filibustered, or never existed") with quick nav links.</div></div>
        <div class="finding"><div class="finding-dot warn"></div><div class="finding-text"><strong>Only 11 loading.tsx files</strong> for 150 pages — most routes lack loading states.</div></div>
        <div class="finding"><div class="finding-dot warn"></div><div class="finding-text"><strong>436 client components</strong> vs 0 server components with <code>use server</code>. Heavy client-side rendering.</div></div>
        <div class="finding"><div class="finding-dot warn"></div><div class="finding-text"><strong>Minimal caching</strong> — Only 17 <code>revalidatePath</code>/<code>revalidateTag</code> usages. 6 <code>cache()</code> calls in lib.</div></div>
        <div class="finding"><div class="finding-dot warn"></div><div class="finding-text"><strong>No parallel routes, intercepting routes, or route groups</strong> — missing advanced App Router features.</div></div>
      </div>
    </div>

    <div class="system-card">
      <div class="system-header" onclick="toggleSystem(this)"><h3>${icon('code',{size:18})} API Routes</h3><span class="count">943 routes</span></div>
      <div class="system-body">
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>Centralized auth guards</strong> — <code>requireAuth</code>, <code>requireAdmin</code>, <code>requireModerator</code>, <code>requireCron</code>, <code>requireHumanSession</code> (blocks X-Bot-Token).</div></div>
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>Zod validation schemas</strong> — 27 schema files in <code>src/lib/api/schemas/</code> with 352+ Zod object definitions.</div></div>
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>Structured error handling</strong> — <code>ApiError</code> class with status codes, <code>handleRouteError</code> utility.</div></div>
        <div class="finding"><div class="finding-dot warn"></div><div class="finding-text"><strong>96 console.log statements</strong> in API routes — should use structured logging.</div></div>
      </div>
    </div>

    <div class="system-card">
      <div class="system-header" onclick="toggleSystem(this)"><h3>${icon('database',{size:18})} MongoDB Access</h3><span class="count">Production-hardened</span></div>
      <div class="system-body">
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>Connection pooling</strong> — <code>maxPoolSize: 15</code>, <code>minPoolSize: 5</code> for warm connections. Retry on failure with stale-state clearing.</div></div>
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>Transaction support</strong> — <code>runWithOptionalTransaction()</code> falls back to sequential writes on standalone dev mongods.</div></div>
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>Async <code>getDb()</code></strong> — returns <code>Promise&lt;Db&gt;</code> with one immediate retry after clearing stale state.</div></div>
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>Environment validation</strong> — <code>src/lib/env.ts</code> validates MONGODB_URI, AUTH_SECRET, CRON_SECRET at runtime with Zod.</div></div>
      </div>
    </div>

    <div class="system-card">
      <div class="system-header" onclick="toggleSystem(this)"><h3>${icon('lock',{size:18})} Auth & Sessions</h3><span class="count">Edge-safe JWT</span></div>
      <div class="system-body">
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>Jose library</strong> — Edge-runtime compatible JWT verification (unlike jsonwebtoken).</div></div>
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>Cookie domain resolution</strong> — Handles <code>.ahousedividedgame.com</code> and subdomains correctly.</div></div>
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>Bot token rejection</strong> — <code>requireHumanSession()</code> rejects requests with <code>X-Bot-Token</code> header for sensitive endpoints.</div></div>
        <div class="finding"><div class="finding-dot warn"></div><div class="finding-text"><strong>Direct <code>process.env</code> access</strong> in some API routes instead of <code>getValidatedEnv()</code> — 56 instances in routes.</div></div>
      </div>
    </div>

    <div class="system-card">
      <div class="system-header" onclick="toggleSystem(this)"><h3>${icon('clock',{size:18})} Turn Processor & Cron</h3><span class="count">Mature orchestration</span></div>
      <div class="system-body">
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>In-process cron</strong> — <code>node-cron</code> with primary (:00) + backup (:30) scheduling. Self-correcting — backup only fires if primary missed its slot.</div></div>
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>Processing lock with stale detection</strong> — <code>TURN_LOCK_STALE_MS = 20min</code>, heartbeat every 30s. Prevents hung turns.</div></div>
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>Heap diagnostics</strong> — Per-turn heap delta logging, ring buffer for leak detection. Sentry cron monitor with service-specific slugs.</div></div>
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>Crash capture</strong> — <code>unhandledRejection</code> and <code>uncaughtException</code> handlers that flush to Sentry before exit.</div></div>
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>Pre-OOM heap watchdog</strong> — Monitors heapUsed vs V8 limit and RSS vs container cap. Exits cleanly with telemetry before Railway SIGKILL.</div></div>
        <div class="finding"><div class="finding-dot warn"></div><div class="finding-text"><strong>87K lines of turn orchestration</strong> — <code>src/lib/turn/</code> is massive. 282 files, 347 exports. High maintenance burden.</div></div>
      </div>
    </div>

    <div class="system-card">
      <div class="system-header" onclick="toggleSystem(this)"><h3>${icon('vote',{size:18})} Elections / Legislature / NPPs</h3><span class="count">Deep simulation</span></div>
      <div class="system-body">
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>Election engine</strong> — Cycle anchor context, polling data, primary view models, vote tally service, seat allocation.</div></div>
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>Congress</strong> — Bill lifecycle, voting, whip system, composition calculations (House, Senate, Bundestag, etc.).</div></div>
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>NPP behavior</strong> — Cross-pressure voting (ideology, whip, party line, district, donors), slate responses, bill voting.</div></div>
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>Multi-country support</strong> — US, UK, Ireland, Germany, China, Japan with country-specific bill lifecycles.</div></div>
      </div>
    </div>

    <div class="system-card">
      <div class="system-header" onclick="toggleSystem(this)"><h3>${icon('activity',{size:18})} Observability</h3><span class="count">Comprehensive</span></div>
      <div class="system-body">
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>Sentry integration</strong> — Server, edge, and crash capture configs. Request error auto-capture.</div></div>
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>Heap watchdog</strong> — V8 space stats, turn delta ring buffer, periodic sampling logs.</div></div>
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>Allocation profiling</strong> — Background capture with state machine, formatted output for leak hunting.</div></div>
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>Boot heap logging</strong> — <code>instrumentation.ts</code> logs heap at each init step to identify memory-heavy imports.</div></div>
      </div>
    </div>
  </div>

  <!-- ISSUE REGISTER -->
  <div id="tab-issues" class="panel">
    <table class="issue-table">
      <tr><th>Sev</th><th>Area</th><th>Issue</th><th>Files</th><th>Impact</th><th>Fix</th></tr>
      <tr><td><span class="sev sev-p0">P0</span></td><td>Testing</td><td>Auth login test failing</td><td><code>src/app/api/auth/login/route.test.ts:47</code></td><td>Auth regression risk</td><td>Fix fingerprint components mock</td></tr>
      <tr><td><span class="sev sev-p0">P0</span></td><td>TypeScript</td><td>20 TS errors blocking strict builds</td><td><code>law-types</code>, <code>investment-funds</code>, <code>sectors</code>, <code>indexFunds</code></td><td>Type safety gaps</td><td>Fix chamber unions, add null guards, add missing props</td></tr>
      <tr><td><span class="sev sev-p0">P0</span></td><td>Reliability</td><td>730 bare catch {} blocks</td><td>Across <code>src/</code></td><td>Silent failures, debugging hell</td><td>Add error logging or re-throw</td></tr>
      <tr><td><span class="sev sev-p1">P1</span></td><td>Type Safety</td><td>2,021 any/unknown usages</td><td><code>src/lib/</code></td><td>Type erosion</td><td>Gradual typing with interfaces</td></tr>
      <tr><td><span class="sev sev-p1">P1</span></td><td>Architecture</td><td>Turn system coupling hotspot</td><td><code>src/lib/turn/</code> (270 cross-imports)</td><td>High maintenance, risky changes</td><td>Event bus for cross-domain comms</td></tr>
      <tr><td><span class="sev sev-p1">P1</span></td><td>Performance</td><td>Minimal Next.js caching</td><td>Across app</td><td>Unnecessary DB round-trips</td><td>Add revalidateTag/cache patterns</td></tr>
      <tr><td><span class="sev sev-p1">P1</span></td><td>UX</td><td>Missing loading states</td><td>139 pages without loading.tsx</td><td>Perceived slowness</td><td>Add skeleton shells</td></tr>
      <tr><td><span class="sev sev-p1">P1</span></td><td>Security</td><td>Direct process.env access</td><td>56 instances in API routes</td><td>Missing validation</td><td>Use getValidatedEnv()</td></tr>
      <tr><td><span class="sev sev-p2">P2</span></td><td>Logging</td><td>Console.log in production</td><td>96 in routes, 413 in lib</td><td>Noisy logs, no structured output</td><td>Replace with structured logger</td></tr>
      <tr><td><span class="sev sev-p2">P2</span></td><td>Code Quality</td><td>catch {} without error param</td><td>730 instances</td><td>Lost context</td><td>Always capture error object</td></tr>
      <tr><td><span class="sev sev-p2">P2</span></td><td>Testing</td><td>3 skipped test files</td><td>—</td><td>Unknown coverage gaps</td><td>Investigate and fix or remove</td></tr>
      <tr><td><span class="sev sev-p2">P2</span></td><td>Components</td><td>dangerouslySetInnerHTML</td><td>9 instances</td><td>XSS risk</td><td>Sanitize or replace with React</td></tr>
      <tr><td><span class="sev sev-p3">P3</span></td><td>Architecture</td><td>No DDD boundaries documented</td><td>—</td><td>Onboarding friction</td><td>Add DOMAIN.md per module</td></tr>
      <tr><td><span class="sev sev-p3">P3</span></td><td>DevEx</td><td>TODO comments (9 total)</td><td>—</td><td>Minor tech debt</td><td>Address or ticket</td></tr>
    </table>
  </div>

  <!-- TECHNICAL DEBT -->
  <div id="tab-debt" class="panel">
    <div class="system-card">
      <div class="system-header" onclick="toggleSystem(this)"><h3>${icon('trending-up',{size:18})} Debt Map</h3><span class="count">By category</span></div>
      <div class="system-body open">
        <div style="margin-bottom:var(--s-4)"><div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:.2rem"><span>Bare catch blocks</span><span class="err-text">730</span></div><div class="debt-bar"><div class="debt-fill high" style="width:100%"></div></div></div>
        <div style="margin-bottom:var(--s-4)"><div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:.2rem"><span>any/unknown usages</span><span class="err-text">2,021</span></div><div class="debt-bar"><div class="debt-fill high" style="width:85%"></div></div></div>
        <div style="margin-bottom:var(--s-4)"><div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:.2rem"><span>Console.log statements</span><span>509</span></div><div class="debt-bar"><div class="debt-fill med" style="width:60%"></div></div></div>
        <div style="margin-bottom:var(--s-4)"><div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:.2rem"><span>TypeScript errors</span><span class="err-text">20</span></div><div class="debt-bar"><div class="debt-fill med" style="width:15%"></div></div></div>
        <div style="margin-bottom:var(--s-4)"><div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:.2rem"><span>Failing tests</span><span class="err-text">1</span></div><div class="debt-bar"><div class="debt-fill low" style="width:5%"></div></div></div>
        <div style="margin-bottom:var(--s-4)"><div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:.2rem"><span>TODO comments</span><span>9</span></div><div class="debt-bar"><div class="debt-fill low" style="width:3%"></div></div></div>
      </div>
    </div>

    <div class="system-card">
      <div class="system-header" onclick="toggleSystem(this)"><h3>${icon('landmark',{size:18})} Turn System Debt</h3><span class="count">87K lines</span></div>
      <div class="system-body">
        <p>The turn system is the single largest concentration of complexity:</p>
        <ul>
          <li>282 files, 87,169 lines — 9.3% of entire codebase</li>
          <li>347 exported functions, 201 async</li>
          <li>270 cross-boundary imports — touches every domain</li>
          <li>Includes: elections, corporations, bonds, budget, legislature, forex, commodities, crises, NPPs, notifications, party influence, GDP growth, demographic turnout, bill lifecycles (US/UK/DE/IE/JP/CN), and more</li>
        </ul>
        <p><strong>Debt:</strong> Any change to turn processing risks breaking multiple subsystems. The module is too large to reason about in isolation.</p>
      </div>
    </div>
  </div>

  <!-- UI/UX AUDIT -->
  <div id="tab-uiux" class="panel">
    <div class="system-card">
      <div class="system-header" onclick="toggleSystem(this)"><h3>${icon('refresh',{size:18})} Loading States</h3><span class="count">Incomplete</span></div>
      <div class="system-body open">
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>Root loading.tsx</strong> — Excellent skeleton shell with navbar + hero + content blocks + strip. Sets a high bar.</div></div>
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>5 nested loading.tsx files</strong> — admin, profile, congress, dashboard, state pages have custom loaders.</div></div>
        <div class="finding"><div class="finding-dot error"></div><div class="finding-text"><strong>139 pages without loading.tsx</strong> — Routes fall back to root loader or show blank while fetching.</div></div>
        <div class="finding"><div class="finding-dot warn"></div><div class="finding-text"><strong>Only 1 not-found.tsx</strong> — at root level. No country-specific or feature-specific 404s.</div></div>
      </div>
    </div>

    <div class="system-card">
      <div class="system-header" onclick="toggleSystem(this)"><h3>${icon('alert-triangle',{size:18})} Error States</h3><span class="count">Good coverage</span></div>
      <div class="system-body">
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>Root error.tsx</strong> — Detects network errors vs runtime errors, shows different messages. Full-screen with nav links.</div></div>
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>5 nested error.tsx files</strong> — admin, congress bills/nominations, country legislature have custom error boundaries.</div></div>
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>ErrorPageContent component</strong> — Reusable error UI with log prefix, title, description, navigation links.</div></div>
      </div>
    </div>

    <div class="system-card">
      <div class="system-header" onclick="toggleSystem(this)"><h3>${icon('folder',{size:18})} Skeletons & Empty States</h3><span class="count">1,180 references</span></div>
      <div class="system-body">
        <div class="finding"><div class="finding-dot ok"></div><div class="finding-text"><strong>Skeleton component</strong> — Used extensively (1,180 references). Consistent styling via <code>className</code> pattern.</div></div>
        <div class="finding"><div class="finding-dot warn"></div><div class="finding-text"><strong>Empty state inconsistency</strong> — Some pages show raw "No data" text, others use Empty component with icon + message.</div></div>
        <div class="finding"><div class="finding-dot warn"></div><div class="finding-text"><strong>Disabled button patterns</strong> — 440 <code>disabled={</code> references. Some use opacity-only, others add cursor-not-allowed. Inconsistent.</div></div>
      </div>
    </div>
  </div>

  <!-- RISK MATRIX -->
  <div id="tab-risk" class="panel">
    <div class="system-card">
      <div class="system-header" onclick="toggleSystem(this)"><h3>${icon('alert-triangle',{size:18})} Risk Matrix</h3><span class="count">Likelihood × Impact</span></div>
      <div class="system-body open">
        <div style="display:grid;grid-template-columns:auto repeat(5,1fr);gap:2px;margin-bottom:var(--s-4);font-size:.8rem">
          <div></div>
          <div class="risk-cell header">Negligible</div>
          <div class="risk-cell header">Low</div>
          <div class="risk-cell header">Medium</div>
          <div class="risk-cell header">High</div>
          <div class="risk-cell header">Critical</div>

          <div class="risk-cell header" style="text-align:right;padding-right:var(--s-2)">Almost Certain</div>
          <div class="risk-cell low">—</div>
          <div class="risk-cell med">Console noise</div>
          <div class="risk-cell high">Type erosion</div>
          <div class="risk-cell crit">Silent failures</div>
          <div class="risk-cell crit">Turn corruption</div>

          <div class="risk-cell header" style="text-align:right;padding-right:var(--s-2)">Likely</div>
          <div class="risk-cell low">—</div>
          <div class="risk-cell low">TODO debt</div>
          <div class="risk-cell med">Missing loaders</div>
          <div class="risk-cell high">Auth test gap</div>
          <div class="risk-cell high">TS build breaks</div>

          <div class="risk-cell header" style="text-align:right;padding-right:var(--s-2)">Possible</div>
          <div class="risk-cell low">—</div>
          <div class="risk-cell low">Skipped tests</div>
          <div class="risk-cell med">Cache misses</div>
          <div class="risk-cell med">Env misconfig</div>
          <div class="risk-cell high">XSS (innerHTML)</div>

          <div class="risk-cell header" style="text-align:right;padding-right:var(--s-2)">Unlikely</div>
          <div class="risk-cell low">—</div>
          <div class="risk-cell low">—</div>
          <div class="risk-cell low">—</div>
          <div class="risk-cell med">Transaction fail</div>
          <div class="risk-cell med">Cron double-fire</div>

          <div class="risk-cell header" style="text-align:right;padding-right:var(--s-2)">Rare</div>
          <div class="risk-cell low">—</div>
          <div class="risk-cell low">—</div>
          <div class="risk-cell low">—</div>
          <div class="risk-cell low">—</div>
          <div class="risk-cell med">OOM mid-turn</div>
        </div>
        <p style="font-size:.8rem;color:var(--text-3)">Matrix shows relative risk positioning. Highest concern: <strong>silent failures</strong> (bare catches) and <strong>turn corruption</strong> (coupling complexity) are both almost-certain × critical-impact.</p>
      </div>
    </div>
  </div>

  <!-- REMEDIATION PLAN -->
  <div id="tab-plan" class="panel">
    <div class="phase-card">
      <h4><span class="num">1</span> Phase 1 — Critical Fixes (Week 1)</h4>
      <ul>
        <li>Fix failing auth login test — <code>src/app/api/auth/login/route.test.ts</code></li>
        <li>Fix 20 TypeScript errors — chamber type unions, null safety, missing props</li>
        <li>Add error logging to top 50 bare catch blocks (highest-traffic routes)</li>
        <li>Run full test suite and verify 100% pass rate</li>
      </ul>
    </div>
    <div class="phase-card">
      <h4><span class="num">2</span> Phase 2 — Type Safety & Logging (Weeks 2–3)</h4>
      <ul>
        <li>Replace direct <code>process.env</code> access with <code>getValidatedEnv()</code> in API routes</li>
        <li>Add structured logger (pino/winston) and replace console.log in API layer</li>
        <li>Audit remaining 680 bare catch blocks — add error capture or re-throw</li>
        <li>Begin gradual any→unknown→typed migration in high-traffic lib modules</li>
      </ul>
    </div>
    <div class="phase-card">
      <h4><span class="num">3</span> Phase 3 — UX & Performance (Weeks 4–5)</h4>
      <ul>
        <li>Add loading.tsx skeletons to top 20 most-visited pages</li>
        <li>Implement revalidateTag for frequently-read but rarely-changed data</li>
        <li>Add Suspense boundaries around heavy data-fetching components</li>
        <li>Standardize disabled button styling across components</li>
      </ul>
    </div>
    <div class="phase-card">
      <h4><span class="num">4</span> Phase 4 — Architecture (Weeks 6–8)</h4>
      <ul>
        <li>Document domain boundaries with DOMAIN.md per module</li>
        <li>Prototype event bus for cross-domain communication (turn → elections)</li>
        <li>Extract turn orchestrator interfaces to reduce direct imports</li>
        <li>Add integration tests for full turn pipeline</li>
      </ul>
    </div>
    <div class="phase-card">
      <h4><span class="num">5</span> Phase 5 — Hardening (Weeks 9–10)</h4>
      <ul>
        <li>Sanitize or replace dangerouslySetInnerHTML usages</li>
        <li>Add rate limiting to sensitive API endpoints</li>
        <li>Review and fix skipped tests</li>
        <li>Add Playwright e2e coverage for critical user flows</li>
      </ul>
    </div>
  </div>

  <footer class="app-footer">
    <p>A House Divided Codebase Audit · Read-only inspection · No runtime modifications · <a href="/">Dashboard</a></p>
  </footer>
</div>

<script>
function showTab(id){
  document.querySelectorAll('.panel').forEach(function(p){p.classList.remove('active');});
  document.getElementById('tab-'+id).classList.add('active');
  document.querySelectorAll('.tabbar button').forEach(function(b){b.classList.remove('active');});
  event.target.classList.add('active');
}
function toggleSystem(header){
  var body=header.nextElementSibling;
  body.classList.toggle('open');
}
</script>
${THEME_TOGGLE_JS}
</body>
</html>`;
}

module.exports = { makeAuditPage };
