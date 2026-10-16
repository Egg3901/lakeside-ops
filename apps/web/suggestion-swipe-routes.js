"use strict";

// HTTP routes for the suggestion swipe deck (/suggestions/swipe). One
// dispatch line in server.js, registered before the /suggestions/<n> detail
// route so "swipe" is never read as a suggestion number:
//
//   if (await handleSuggestionSwipeRoute(req, res, pathname, ctx)) return;
//
// Staff swipe unreviewed suggestions blind. When two voters agree the
// suggestion's status changes directly in the database. That is deliberate:
// the game's admin PATCH route notifies the player on every status change,
// and the deck is meant to clear a backlog silently. A match also opens a
// kanban card in "next"; a super like makes it high impact.
//
// Access: admins only, same rules as the kanban routes. Writes require
// X-Requested-With: ops-dashboard and a same-origin Origin header.

const { sharedKanban } = require("./kanban-store");
const { sharedSwipeStore, STATUS_FOR_OUTCOME, OUTCOMES } = require("./suggestion-swipe-store");
const { buildDeck } = require("./suggestion-swipe-deck");
const { loadAudit } = require("./suggestion-swipe-audit");
const { makeSuggestionSwipeBody } = require("./suggestion-swipe-page");

const PRODUCT = "a-house-divided";
const DECK_PAGE = 12;

function isSwipePath(pathname) {
  return pathname === "/suggestions/swipe" || pathname.startsWith("/api/suggestions/swipe/");
}

function sameOrigin(req) {
  if (req.headers["x-requested-with"] !== "ops-dashboard") return false;
  const host = req.headers.host || "";
  const origin = req.headers.origin;
  if (origin === `https://${host}`) return true;
  return origin === `http://${host}` && /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
}

async function readJson(req, limit = 64 * 1024) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) { const e = new Error("Body too large"); e.status = 413; throw e; }
  }
  try { return JSON.parse(raw || "{}"); } catch { const e = new Error("Invalid JSON"); e.status = 400; throw e; }
}

function issueList(value) {
  const list = (Array.isArray(value) ? value : [value]).map((n) => parseInt(n, 10)).filter((n) => Number.isInteger(n) && n > 0);
  if (!list.length || list.length > 50) throw Object.assign(new Error("issueNumbers must list 1 to 50 suggestion numbers"), { status: 400 });
  return [...new Set(list)];
}

function kanbanDetail(docs, { superLike, by, audit }) {
  const lines = [
    `Matched in the suggestion swipe deck${superLike ? " with a super like (top priority)" : ""}. Decided by ${by}.`,
    "",
  ];
  for (const d of docs) {
    lines.push(`S#${d.issueNumber}: ${d.title || "(untitled)"} (ops /suggestions/${d.issueNumber})`);
    if (d.description) lines.push(String(d.description).slice(0, 1500));
    if (d.impact) lines.push(`Impact: ${String(d.impact).slice(0, 500)}`);
    const check = audit && audit.items && audit.items[d.issueNumber];
    if (check) {
      lines.push(`Code check (${check.verdict}, ${check.confidence || "low"} confidence${audit.sourceCommit ? `, game main ${String(audit.sourceCommit).slice(0, 10)}` : ""}):`);
      if (check.inGameToday) lines.push(`Already in game: ${check.inGameToday}`);
      if (check.missing) lines.push(`Still missing: ${check.missing}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

// Apply one outcome to a group of suggestions decided together (one swipe on
// a merged card, or one call from the discuss pile).
async function applyOutcome({ db, kanban, store, issueNumbers, outcome, superLike = false, by, audit = null }) {
  if (!OUTCOMES.includes(outcome)) throw Object.assign(new Error(`outcome must be one of ${OUTCOMES.join(", ")}`), { status: 400 });
  const coll = db.collection("suggestions");
  const status = STATUS_FOR_OUTCOME[outcome] || null;
  const applied = new Map();
  if (status) {
    const now = new Date();
    for (const n of issueNumbers) {
      // Only move suggestions nobody has handled since the deck loaded.
      const r = await coll.updateOne(
        { issueNumber: n, status: "not_reviewed" },
        {
          $set: { status, statusChangedAt: now, updatedAt: now },
          $push: { statusHistory: { status, at: now, by, source: "ops-swipe" } },
        },
      );
      applied.set(n, r.modifiedCount === 1 ? status : null);
    }
  }
  let kanbanId = null;
  if (outcome === "planned") {
    const docs = await coll.find({ issueNumber: { $in: issueNumbers } }, { projection: { issueNumber: 1, title: 1, description: 1, impact: 1 } })
      .sort({ issueNumber: 1 }).toArray();
    const lead = docs[0] || { issueNumber: issueNumbers[0], title: "" };
    const extra = docs.length > 1 ? ` (+${docs.length - 1} similar)` : "";
    const item = kanban().add({
      product: PRODUCT,
      title: `Player suggestion S#${lead.issueNumber}: ${lead.title || "(untitled)"}${extra}`.slice(0, 300),
      detail: kanbanDetail(docs, { superLike, by, audit }),
      lane: "next",
      impact: superLike ? "high" : "medium",
      kind: "feature",
    }, { actor: "suggestion-swipe" });
    kanbanId = item && item.id ? item.id : null;
  }
  for (const n of issueNumbers) {
    store.recordOutcome(n, { outcome, superLike, appliedStatus: applied.get(n) || null, kanbanId, decidedBy: by });
  }
  return { outcome, superLike, kanbanId, issueNumbers };
}

async function handleSuggestionSwipeRoute(req, res, pathname, {
  resolveSession, addSecurityHeaders, renderShell, getDb,
  store = sharedSwipeStore, kanban = sharedKanban, audit = loadAudit,
}) {
  if (!isSwipePath(pathname)) return false;

  const send = (status, data) => {
    addSecurityHeaders(res);
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
    return true;
  };
  const notFound = () => {
    addSecurityHeaders(res);
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("Not found");
    return true;
  };

  const session = await resolveSession(req);
  const isPage = pathname === "/suggestions/swipe";
  if (!session) {
    if (!isPage) return send(401, { error: "Sign in required" });
    addSecurityHeaders(res);
    res.writeHead(302, { Location: "/", "Cache-Control": "no-store" });
    res.end();
    return true;
  }
  if (session.role !== "admin") return isPage ? notFound() : send(404, { error: "Not found" });

  const voter = String(session.email || "").trim().toLowerCase().slice(0, 200);
  const fail = (error) => {
    if (error.status) return send(error.status, { error: error.message });
    console.error("[suggestion-swipe]", error);
    return send(500, { error: error.message });
  };

  try {
    if ((req.method === "GET" || req.method === "HEAD") && isPage) {
      const { extraCss, body } = makeSuggestionSwipeBody();
      addSecurityHeaders(res);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(req.method === "HEAD" ? "" : renderShell({ title: "Suggestion swipe", active: "/suggestions", role: session.role, extraCss, body }));
      return true;
    }

    if (req.method === "GET" && pathname === "/api/suggestions/swipe/deck") {
      if (!voter) return send(400, { error: "Your session has no email, so votes cannot be attributed" });
      const db = await getDb();
      const deck = await buildDeck({ db, store: store(), voter, audit: audit() });
      // The client refetches after every swipe; only the next few cards travel.
      deck.cards = deck.cards.slice(0, DECK_PAGE);
      return send(200, deck);
    }

    if (req.method !== "POST") return send(405, { error: "Method not allowed" });
    if (!sameOrigin(req)) return send(403, { error: "Cross-origin write refused" });
    if (!voter) return send(400, { error: "Your session has no email, so votes cannot be attributed" });
    const body = await readJson(req);
    const s = store();

    if (pathname === "/api/suggestions/swipe/vote") {
      const issueNumbers = issueList(body.issueNumbers);
      const value = String(body.vote || "");
      // Votes on a merged card land on every member; members that complete a
      // pair with the same outcome are applied together so a match opens one
      // kanban card, not one per duplicate.
      const groups = new Map();
      for (const n of issueNumbers) {
        const r = s.vote(n, voter, value);
        if (!r.outcome) continue;
        const key = `${r.outcome.outcome}:${r.outcome.superLike ? 1 : 0}`;
        if (!groups.has(key)) groups.set(key, { ...r.outcome, issueNumbers: [] });
        groups.get(key).issueNumbers.push(n);
      }
      const results = [];
      if (groups.size) {
        const db = await getDb();
        for (const g of groups.values()) {
          results.push(await applyOutcome({ db, kanban, store: s, issueNumbers: g.issueNumbers, outcome: g.outcome, superLike: g.superLike, by: voter, audit: audit() }));
        }
      }
      return send(200, { ok: true, results });
    }

    if (pathname === "/api/suggestions/swipe/decide") {
      const issueNumbers = issueList(body.issueNumbers);
      const outcome = String(body.outcome || "");
      if (outcome === "discuss") return send(400, { error: "Pick an outcome" });
      const db = await getDb();
      const result = await applyOutcome({ db, kanban, store: s, issueNumbers, outcome, superLike: body.superLike === true, by: voter, audit: audit() });
      return send(200, { ok: true, results: [result] });
    }

    if (pathname === "/api/suggestions/swipe/reopen") {
      // mine:true is the undo button for your own last swipe: if it already
      // completed a pair, the decision is reverted and only your vote is
      // cleared. Without it (the decided list), both voters swipe again.
      const issueNumbers = issueList(body.issueNumbers);
      const onlyVoter = body.mine === true ? voter : null;
      const db = await getDb();
      const coll = db.collection("suggestions");
      const now = new Date();
      const closedCards = new Set();
      for (const n of issueNumbers) {
        const o = s.outcomeFor(n);
        if (o && o.applied_status) {
          await coll.updateOne(
            { issueNumber: n, status: o.applied_status },
            {
              $set: { status: "not_reviewed", statusChangedAt: now, updatedAt: now },
              $push: { statusHistory: { status: "not_reviewed", at: now, by: voter, source: "ops-swipe", note: "swipe decision undone" } },
            },
          );
        }
        if (o && o.kanban_id && !closedCards.has(o.kanban_id)) {
          closedCards.add(o.kanban_id);
          try {
            kanban().update(o.kanban_id, { lane: "done" }, { actor: "suggestion-swipe" });
            kanban().logEvent({ item_id: o.kanban_id, product: PRODUCT, event_type: "progress", actor: "suggestion-swipe", summary: `Swipe decision undone by ${voter}` });
          } catch (e) {
            console.warn("[suggestion-swipe] kanban close on undo failed:", e.message);
          }
        }
        s.reopen(n, { onlyVoter });
      }
      return send(200, { ok: true, reopened: issueNumbers });
    }

    return send(404, { error: "Not found" });
  } catch (error) {
    return fail(error);
  }
}

module.exports = { handleSuggestionSwipeRoute, applyOutcome, isSwipePath };
