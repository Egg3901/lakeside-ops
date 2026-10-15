"use strict";
// Keir 3.0 F3 (part 1), duplicate and cluster detection. New reports are
// matched against known issues by symptom terms and a shared error or
// entity signature. Matching suggests a link a human or coordinator
// confirms; it never merges tickets, closes anything, or lets one player's
// report inherit another ticket's evidence as fact. Clusters share a root
// cause record so one fix can carry many tickets, each still verified
// individually by the verification loop.

const STOP = new Set(["the", "and", "for", "with", "when", "then", "this", "that", "from", "have", "has", "was", "were", "are", "not", "but", "all", "any", "can", "cant", "cannot", "doesnt", "dont", "after", "before", "every", "time"]);

function tokens(text) {
  return new Set((String(text || "").toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || []).filter((w) => !STOP.has(w)));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / (a.size + b.size - shared);
}

// candidates: [{ id, title/text, signature }] known open or resolved issues.
// A shared signature (error code, broken entity, failing endpoint) outweighs
// loose wording; wording alone needs a strong overlap.
function suggestCluster(report, candidates, { threshold = 0.35 } = {}) {
  const terms = tokens(`${report.title || ""} ${report.text || ""}`);
  const scored = candidates.map((c) => {
    const textScore = jaccard(terms, tokens(`${c.title || ""} ${c.text || ""}`));
    const signatureMatch = Boolean(report.signature && c.signature && report.signature === c.signature);
    return { id: c.id, score: signatureMatch ? Math.max(textScore, 0.8) : textScore, signatureMatch };
  }).filter((s) => s.score >= threshold).sort((a, b) => b.score - a.score);
  return { suggestions: scored, best: scored[0] || null };
}

// A confirmed cluster: root cause work plus member tickets, each with its
// own verification state. The cluster is resolved only when every member
// is individually live-verified or closed with its own receipt.
function clusterState(members) {
  const outstanding = members.filter((m) => !["live-verified", "closed"].includes(m.state));
  return { members: members.length, outstanding: outstanding.map((m) => m.ticket),
    resolved: members.length > 0 && outstanding.length === 0 };
}

module.exports = { tokens, jaccard, suggestCluster, clusterState };
