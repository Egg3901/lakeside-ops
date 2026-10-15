// PR Reviews page — lists automated (Kimi) PR reviews with the PR's LIVE
// GitHub status (open / draft / merged / closed). Server-rendered: the route
// resolves live status before calling makePrReviewsBody.

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function timeAgo(d) {
  if (!d) return "";
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const days = Math.floor(h / 24);
  return days + "d ago";
}

// state: "merged" | "open" | "draft" | "closed" | "unknown"
function statusBadge(state) {
  const map = {
    merged: { bg: "#8957e5", fg: "#fff", label: "Merged" },
    open: { bg: "#238636", fg: "#fff", label: "Open" },
    draft: { bg: "#6e7681", fg: "#fff", label: "Draft" },
    closed: { bg: "#da3633", fg: "#fff", label: "Closed" },
    unknown: { bg: "#30363d", fg: "#c9d1d9", label: "—" },
  };
  const s = map[state] || map.unknown;
  return `<span class="pr-badge" style="background:${s.bg};color:${s.fg}">${s.label}</span>`;
}

const EXTRA_CSS = `
  .pr-wrap { padding: var(--s-4, 16px); max-width: 1100px; margin: 0 auto; }
  .pr-head { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:14px; }
  .pr-head h1 { font-size: 20px; margin:0; }
  .pr-sub { color: var(--muted, #8b949e); font-size: 13px; }
  .pr-list { display:flex; flex-direction:column; gap:10px; }
  .pr-row { border:1px solid var(--border,#30363d); border-radius:10px; padding:12px 14px; background:var(--card,#161b22); }
  .pr-row-top { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .pr-badge { font-size:11px; font-weight:600; padding:2px 8px; border-radius:999px; letter-spacing:.2px; }
  .pr-title { font-weight:600; color:var(--fg,#e6edf3); text-decoration:none; }
  .pr-title:hover { text-decoration:underline; }
  .pr-meta { color:var(--muted,#8b949e); font-size:12px; margin-left:auto; white-space:nowrap; }
  .pr-repo { color:var(--muted,#8b949e); font-size:12px; font-family:ui-monospace,monospace; }
  .pr-excerpt { color:var(--muted,#8b949e); font-size:13px; margin-top:8px; white-space:pre-wrap;
                max-height:5.4em; overflow:hidden; position:relative; }
  .pr-excerpt details summary { cursor:pointer; color:var(--fg,#e6edf3); font-size:12px; margin-top:6px; }
  .pr-empty { color:var(--muted,#8b949e); padding:40px; text-align:center; }
  .pr-detail-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:6px; }
  .pr-detail-title { font-size:20px; font-weight:700; color:var(--fg,#e6edf3); text-decoration:none; }
  .pr-detail-title:hover { text-decoration:underline; }
  .pr-detail-meta { color:var(--muted,#8b949e); font-size:13px; margin-bottom:16px; }
  .pr-actions { display:flex; gap:10px; align-items:center; margin:14px 0; flex-wrap:wrap; }
  .pr-btn { font:inherit; font-size:13px; font-weight:600; padding:7px 14px; border-radius:8px; cursor:pointer;
            border:1px solid var(--border,#30363d); background:var(--card,#161b22); color:var(--fg,#e6edf3); text-decoration:none; }
  .pr-btn:hover { border-color:#58a6ff; }
  .pr-btn[disabled] { opacity:.6; cursor:default; }
  .pr-btn-primary { background:#238636; border-color:#238636; color:#fff; }
  .pr-review-text { border:1px solid var(--border,#30363d); border-radius:10px; padding:14px 16px;
                    background:var(--card,#161b22); color:var(--fg,#e6edf3); font-size:13px; line-height:1.5;
                    white-space:pre-wrap; word-wrap:break-word; }
  .pr-rr-status { color:var(--muted,#8b949e); font-size:13px; }
`;

// reviews: [{ repo, prNumber, title, url, model, createdAt, review, state }]
function makePrReviewsBody({ reviews }) {
  const rows = (reviews || [])
    .map((r) => {
      const excerpt = String(r.review || "").trim();
      const short = excerpt.length > 600 ? excerpt.slice(0, 600) + "…" : excerpt;
      const portalHref = `/pr-review?repo=${encodeURIComponent(r.repo)}&pr=${encodeURIComponent(r.prNumber)}`;
      return `<div class="pr-row">
        <div class="pr-row-top">
          ${statusBadge(r.state)}
          <a class="pr-title" href="${esc(portalHref)}">${esc(r.title || "PR #" + r.prNumber)}</a>
          <span class="pr-repo">${esc(r.repo)} #${esc(r.prNumber)}</span>
          <span class="pr-meta">${esc(r.model || "kimi")} · ${esc(timeAgo(r.createdAt))}</span>
        </div>
        ${short ? `<div class="pr-excerpt">${esc(short)}</div>` : ""}
      </div>`;
    })
    .join("\n");

  const body = `<div class="pr-wrap">
    <div class="pr-head">
      <h1>PR Auto-Reviews</h1>
      <span class="pr-sub">Automated reviews with live GitHub status</span>
    </div>
    ${rows ? `<div class="pr-list">${rows}</div>` : `<div class="pr-empty">No automated reviews recorded yet. Reviews appear here after the next PR is opened or updated.</div>`}
  </div>`;

  return { extraCss: EXTRA_CSS, body };
}

// Detail / "review portal" page for a single PR.
// review: the latest pr_reviews doc { repo, prNumber, title, url, model, createdAt, review } or null.
// state:  live GitHub status ("merged" | "open" | "draft" | "closed" | "unknown").
// repo/prNumber are passed explicitly so an empty state (no review doc) still renders + re-reviews.
function makePrReviewDetailBody({ review, state, repo, prNumber }) {
  const r = review || {};
  const theRepo = r.repo || repo || "";
  const thePr = r.prNumber != null ? r.prNumber : prNumber;
  const prUrl = r.url || (theRepo && thePr != null ? `https://github.com/${theRepo}/pull/${thePr}` : "");
  const title = r.title || "PR #" + thePr;

  const rrPayload = esc(JSON.stringify({ repo: theRepo, prNumber: thePr }));
  const reReviewBtn =
    `<button class="pr-btn pr-btn-primary" id="pr-rereview-btn"
        onclick='reReview(this, ${rrPayload})'>Re-review</button>
     <span class="pr-rr-status" id="pr-rr-status"></span>`;

  const openPrLink = prUrl
    ? `<a class="pr-btn" href="${esc(prUrl)}" target="_blank" rel="noopener">Open PR ↗</a>`
    : "";

  const reviewText = review && String(r.review || "").trim()
    ? `<div class="pr-review-text">${esc(String(r.review).trim())}</div>`
    : `<div class="pr-empty">No review recorded for this PR yet. Use “Re-review” to generate one now.</div>`;

  const titleEl = prUrl
    ? `<a class="pr-detail-title" href="${esc(prUrl)}" target="_blank" rel="noopener">${esc(title)}</a>`
    : `<span class="pr-detail-title">${esc(title)}</span>`;

  const metaBits = [];
  if (r.model) metaBits.push(esc(r.model));
  if (r.createdAt) metaBits.push("reviewed " + esc(timeAgo(r.createdAt)));
  const meta = metaBits.length ? `<div class="pr-detail-meta">${metaBits.join(" · ")}</div>` : "";

  const body = `<div class="pr-wrap">
    <div class="pr-head">
      <div>
        <div class="pr-detail-head">
          ${statusBadge(state)}
          ${titleEl}
        </div>
        <span class="pr-repo">${esc(theRepo)} #${esc(thePr)}</span>
      </div>
      <a class="pr-sub" href="/pr-reviews">← All reviews</a>
    </div>
    ${meta}
    <div class="pr-actions">
      ${openPrLink}
      ${reReviewBtn}
    </div>
    ${reviewText}
  </div>
  <script>
    async function reReview(btn, payload) {
      var status = document.getElementById('pr-rr-status');
      btn.disabled = true;
      var prev = btn.textContent;
      btn.textContent = 'Requesting…';
      if (status) status.textContent = 'Running review…';
      try {
        var res = await fetch('/api/pr-reviews/re-review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          var err = '';
          try { err = (await res.json()).error || ''; } catch (e) {}
          throw new Error(err || ('HTTP ' + res.status));
        }
        if (status) status.textContent = 'Done — reloading…';
        location.reload();
      } catch (e) {
        btn.disabled = false;
        btn.textContent = prev;
        if (status) status.textContent = 'Failed: ' + e.message;
      }
    }
  </script>`;

  return { extraCss: EXTRA_CSS, body };
}

module.exports = { makePrReviewsBody, makePrReviewDetailBody };
