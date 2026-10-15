// ─── TICKET REPAIR: ATOMIC LAUNCH CLAIMS ───────────────────────────────────
// Every repair launch path (worker auto-launch, manual Launch button, Discord
// /handoff) funnels through claimRepairLaunch BEFORE doing any slow work
// (image downloads, worktree init, agent spawn). Previously the
// fix_sessions doc + ticket fixSessionId link were written AFTER the agent
// spawned, so any second trigger inside that minutes-long window — or any
// throw between spawn and insert — produced a live agent with no DB record,
// and the next trigger launched a duplicate.
//
// Protocol:
//   1. Fresh-read the item (never trust the caller's snapshot).
//   2. If it links to a live session -> return { status: "existing", ... }.
//   3. Else pre-generate the fix ObjectId and atomically link it onto the
//      item with a guarded update (only-if-unset, or only-if-still-stale).
//      Loser re-reads and returns the winner. No doc is inserted for losers.
//   4. Insert the fix_sessions doc as status "launching".
//   5. Caller does the slow work, then completeRepairClaim (status running /
//      launched + session details), or failRepairClaim on error (doc -> failed,
//      item link released only if it still points at our claim).
//
// A "launching" claim older than STALE_LAUNCHING_MS is treated as dead (crashed
// process between claim and spawn) and may be superseded by a fresh claim.

const { ObjectId } = require("mongodb");

const LIVE_STATUSES = new Set(["running", "launched", "launching"]);
const STALE_LAUNCHING_MS = parseInt(process.env.TICKET_LAUNCH_CLAIM_TIMEOUT_MS || String(15 * 60_000), 10);

function asId(v) {
  if (v == null) return null;
  if (v instanceof ObjectId) return v;
  if (typeof v === "string" && /^[a-f0-9]{24}$/i.test(v)) return new ObjectId(v);
  if (typeof v === "string" && /^[a-f0-9]{24}$/i.test(v.trim())) return new ObjectId(v.trim());
  // Some paths store { $oid }-shaped or other wrappers; anything else is dangling.
  return null;
}

function isLiveFixSession(doc, now = Date.now()) {
  if (!doc || typeof doc !== "object") return false;
  const status = doc.status;
  if (status === "launching") {
    const at = doc.launchedAt instanceof Date ? doc.launchedAt.getTime() : new Date(doc.launchedAt).getTime();
    if (!Number.isFinite(at)) return true; // no timestamp: assume live, never strand
    return now - at < STALE_LAUNCHING_MS;
  }
  return LIVE_STATUSES.has(status);
}

async function readFixSession(db, fixSessionId) {
  const id = asId(fixSessionId);
  if (!id) return null;
  return db.collection("fix_sessions").findOne({ _id: id });
}

// Link filter matching what currentLink looks like NOW, so a concurrent third
// claim between our read and our write makes us lose cleanly instead of
// clobbering it.
function linkFilter(itemId, currentLink) {
  if (currentLink == null) {
    return { _id: itemId, $or: [{ fixSessionId: { $exists: false } }, { fixSessionId: null }] };
  }
  return { _id: itemId, fixSessionId: currentLink };
}

async function claimRepairLaunch(db, { collName, itemId, targetType, displayNumber, launchedBy, baseDoc = {}, now = Date.now() }) {
  const coll = db.collection(collName);
  for (let attempt = 0; attempt < 2; attempt++) {
    const item = await coll.findOne({ _id: itemId });
    if (!item) throw new Error("Item not found for repair claim");
    const linked = await readFixSession(db, item.fixSessionId);
    if (linked && isLiveFixSession(linked, now)) {
      return { status: "existing", fixSessionId: String(linked._id), session: linked };
    }
    if (linked && !isLiveFixSession(linked, now) && linked.status === "launching") {
      // Stale claim from a launcher that died between claim and spawn:
      // supersede for the audit trail. Best-effort; the guarded link update
      // below is the real synchronization. Failed docs keep their status.
      await db.collection("fix_sessions").updateOne({ _id: linked._id }, { $set: { status: "superseded", updatedAt: new Date(now) } }).catch(() => {});
    }
    const fixId = new ObjectId();
    const claimed = await coll.updateOne(linkFilter(itemId, item.fixSessionId ?? null), {
      $set: { fixSessionId: fixId, repairClaimAt: new Date(now), updatedAt: new Date(now) },
    });
    if (!claimed || claimed.matchedCount !== 1) continue; // lost the race: re-read, return winner
    const doc = {
      ...baseDoc,
      _id: fixId,
      targetType,
      targetId: itemId,
      ...(targetType === "ticket" ? { ticketNumber: displayNumber } : { issueNumber: displayNumber }),
      status: "launching",
      launchedBy: launchedBy || "unknown",
      launchedAt: new Date(now),
    };
    try {
      await db.collection("fix_sessions").insertOne(doc);
    } catch (e) {
      // Link is ours but the doc insert failed: release so the next trigger
      // retries instead of stranding on a dangling link.
      await coll.updateOne({ _id: itemId, fixSessionId: fixId }, { $unset: { fixSessionId: "", repairClaimAt: "" } }).catch(() => {});
      throw e;
    }
    return { status: "claimed", fixSessionId: String(fixId), fixObjectId: fixId };
  }
  // Two consecutive race losses: back off and let a later tick retry. The
  // worker counts attempts and resets status on throw, so this degrades to a
  // delayed launch, never a duplicate.
  throw new Error("Repair claim lost to a concurrent launch; retrying on a later tick");
}

async function completeRepairClaim(db, fixSessionId, fields = {}) {
  const id = asId(fixSessionId);
  if (!id) throw new Error("completeRepairClaim: invalid fix session id");
  const { status, ...rest } = fields;
  await db.collection("fix_sessions").updateOne(
    { _id: id },
    { $set: { ...rest, status: status || "running", updatedAt: new Date() } }
  );
}

async function failRepairClaim(db, { collName, itemId, fixSessionId, error } = {}) {
  const id = asId(fixSessionId);
  if (!id) return;
  await db.collection("fix_sessions").updateOne(
    { _id: id },
    { $set: { status: "failed", error: String((error && error.message) || error || "unknown").slice(0, 500), updatedAt: new Date() } }
  ).catch(() => {});
  if (collName && itemId) {
    // Release the item link only if it still points at our claim: a newer
    // claim (or an admin) may have legitimately relinked it since.
    await db.collection(collName).updateOne(
      { _id: itemId, fixSessionId: id },
      { $unset: { fixSessionId: "", repairClaimAt: "" } }
    ).catch(() => {});
  }
}

module.exports = {
  LIVE_STATUSES,
  STALE_LAUNCHING_MS,
  asId,
  isLiveFixSession,
  readFixSession,
  claimRepairLaunch,
  completeRepairClaim,
  failRepairClaim,
};
