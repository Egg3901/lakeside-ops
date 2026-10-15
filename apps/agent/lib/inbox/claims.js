"use strict";

// Reward claims sent to Keir by DM. A claim collects screenshots for a short
// quiet period, then Keir checks them once:
//   collecting -> checking -> approved -> granting -> granted
//                          -> incomplete   (player asked for a better screenshot)
//                          -> not_linked   (Discord not linked to a game account)
//                          -> needs_review (a moderator decides in the ops inbox)
// Staff can approve, reject or retry from the inbox. The game enforces once
// per player, so every grant call is safe to repeat.

const QUIET_MS = 20_000;
const STALE_MS = 10 * 60_000;
const DISCORD_EPOCH = 1420070400000n;
const MIN_COMMENT_CHARS = 25;
const NEW_CHARACTER_MS = 3 * 86_400_000;
const NEW_DISCORD_MS = 30 * 86_400_000;
const HINT_EVERY_MS = 24 * 3_600_000;
const REMIND_EVERY_MS = 6 * 3_600_000;
const TEST_WINDOW_MS = 30 * 60_000;
const TEST_OPT_IN = /\bitch\s*test\b/i;

const FLAG_TEXT = {
  duplicate_image: "Screenshot already used in another claim",
  itch_username_reused: "itch.io username already claimed by another Discord account",
  character_reused: "Game character already used by another claim",
  username_mismatch: "Logged-in itch.io user differs from the comment author",
  edit_suspected: "Screenshot may be edited",
  low_effort_comment: "Very short comment",
  new_character: "Game character created in the last 3 days",
  new_discord_account: "Discord account younger than 30 days",
  name_mismatch: "In-game name given does not match the linked account",
  vision_unavailable: "Automatic screenshot check unavailable",
  comment_reused: "Same comment text already used in another claim",
};

const discordCreatedAt = (id) => Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
const fmtAnchor = (n) => `₳${Math.round(n).toLocaleString("en-US")}`;
const isImage = (a) => Boolean(a.file);

const COPY = {
  ack: "Got it, checking your screenshots. This takes about a minute.",
  notLinked: "Your Discord account isn't linked to an A House Divided account yet. Link it in your account settings on the site, then send me any message and I'll check again.",
  notItch: "I couldn't find A House Divided on itch.io in that screenshot. Send a screenshot of https://egg3901.itch.io/a-house-divided showing your comment, and one of https://itch.io/my-collections showing the game in a collection.",
  needCollection: "I can see your comment, thanks. I can't see the game in one of your collections yet. Add it with the Add To Collection button on the game page, then send a screenshot of https://itch.io/my-collections with A House Divided visible.",
  needComment: "I can see the game in your collection, thanks. I can't find your comment yet. Send a screenshot of your comment on https://egg3901.itch.io/a-house-divided with your itch.io username next to it.",
  needBoth: "The reward needs two screenshots: your comment on https://egg3901.itch.io/a-house-divided with your itch.io username next to it, and https://itch.io/my-collections with A House Divided visible.",
  unreadable: "I couldn't open that image. Send it as a normal screenshot (PNG or JPG) and I'll check it.",
  review: "Thanks. A moderator will double-check this one, usually within a day. I'll message you here as soon as it's done.",
  stillReview: "Your claim is still with a moderator. I'll message you here as soon as it's done.",
  already: "You've already received the itch.io reward on this account. Thanks again for supporting the game.",
  granted: (g) => `Thanks for supporting A House Divided. ${fmtAnchor(g.amountAnchor)} has been added to ${g.characterName}'s personal funds${g.currency && g.currency !== "ANCHOR" ? ` (paid in ${g.currency})` : ""}.`,
  failed: "Your claim checked out, but the payment didn't go through. A moderator has been alerted and will sort it out.",
  hintActive: "Hi, I'm Keir. I handle the itch.io thank-you reward here. Send me two screenshots: your comment on https://egg3901.itch.io/a-house-divided, and https://itch.io/my-collections with the game visible. For help with the game itself, open a ticket in the support channel on the server.",
  testStart: "Itch test mode on for 30 minutes. Send your two screenshots and I'll run the full check without paying. Anything else you send me stays a normal conversation.",
  testInactive: "Itch claims are switched off right now, so there's nothing to test.",
  testPassed: (name) => `Test claim passed. A real player would be paid on ${name}. Nothing was paid because you are a tester. Say \"itch test\" again to run another.`,
  hintIdle: "Hi, I'm Keir. Messages here are read by the team. For help with the game, open a ticket in the support channel on the server.",
};

function decide({ verdict, flags }) {
  if (!verdict || verdict.refused) return { status: "needs_review", flags: [...flags, "vision_unavailable"] };
  if (!verdict.is_itch_page || !verdict.game_matches) return { status: "incomplete", reply: COPY.notItch };
  if (!verdict.in_collection && !verdict.comment_found) return { status: "incomplete", reply: COPY.needBoth };
  if (!verdict.in_collection) return { status: "incomplete", reply: COPY.needCollection };
  if (!verdict.comment_found) return { status: "incomplete", reply: COPY.needComment };
  return flags.length ? { status: "needs_review", flags } : { status: "approved", flags };
}

function createClaims({ store, ingest, game, vision, campaign, active, staffIds = [], testers = [], botId, log = console.log, now = () => Date.now(), quietMs = QUIET_MS, setTimer = setTimeout }) {
  const timers = new Map();
  const testWindows = new Map(); // tester id -> opt-in expiry
  const running = new Set();

  function schedule(claimId, delay = quietMs) {
    clearTimeout(timers.get(claimId));
    timers.set(claimId, setTimer(() => { timers.delete(claimId); evaluate(claimId).catch((e) => log(`claim ${claimId}: ${e.stack || e.message}`)); }, delay));
  }

  const say = (channelId, text) => ingest.send(channelId, text).catch((e) => log(`reply ${channelId}: ${e.message}`));

  /** Called for each new inbound DM. */
  async function onMessage(message) {
    if (message.direction !== "in" || message.authorId === botId) return;
    // Staff DMs belong to the operator (Keir's normal conversation). A tester
    // (KEIR_PROMO_TESTERS) enters the claim desk only by saying "itch test";
    // screenshots sent in the next 30 minutes run the full check in a
    // separate test campaign that never pays. Nothing else a tester sends,
    // text or image, is touched here, and testers never get the player hints.
    const tester = testers.includes(message.authorId);
    if (staffIds.includes(message.authorId) || tester) {
      if (!tester) return;
      if (TEST_OPT_IN.test(message.content || "")) testWindows.set(message.authorId, now() + TEST_WINDOW_MS);
      if (!((testWindows.get(message.authorId) || 0) > now())) return;
    }
    const thread = store.thread(message.channelId);
    if (!thread || thread.kind !== "dm") return;
    const images = message.attachments.filter(isImage);
    const camp = tester ? `${campaign}:test` : campaign;
    let existing = active ? store.claimFor(camp, message.authorId) : null;
    // A tester can start over with new screenshots once a test has finished.
    if (tester && existing && images.length && ["granted", "rejected", "failed", "needs_review"].includes(existing.status)) {
      existing = store.updateClaim(existing.id, { status: "incomplete", evidence: [], verdict: null, flags: [], grant_result: null, note: null, reviewed_by: null });
    }
    if (active && !images.length && message.attachments.length && (!existing || ["collecting", "incomplete", "not_linked"].includes(existing.status))) {
      return say(message.channelId, COPY.unreadable);
    }

    // Text alone only continues a claim that is waiting on it (a quiet period or an account link).
    if (!active || (!images.length && !(existing && ["collecting", "not_linked"].includes(existing.status)))) {
      if (tester) {
        if (TEST_OPT_IN.test(message.content || "")) return say(message.channelId, active ? COPY.testStart : COPY.testInactive);
        return;
      }
      if (existing?.status === "needs_review" && now() - existing.updated_at > REMIND_EVERY_MS) return say(message.channelId, COPY.stillReview);
      if (existing?.status === "granted") return;
      if (!thread?.hint_at || now() - thread.hint_at > HINT_EVERY_MS) {
        store.setHint(message.channelId, now());
        return say(message.channelId, active ? COPY.hintActive : COPY.hintIdle);
      }
      return;
    }

    const claim = existing || store.openClaim({ campaign: camp, discordId: message.authorId, channelId: message.channelId, at: now() });
    if (claim.status === "granted") return say(message.channelId, COPY.already);
    if (["needs_review", "approved", "granting", "checking", "failed"].includes(claim.status)) {
      // New screenshots during review are added for the moderator to see.
      if (images.length) store.updateClaim(claim.id, { evidence: [...new Set([...claim.evidence, message.id])] });
      if (claim.status === "needs_review" && now() - claim.updated_at > REMIND_EVERY_MS) return say(message.channelId, COPY.stillReview);
      return;
    }
    if (claim.status === "rejected") return;

    const firstEvidence = !claim.evidence.length && images.length;
    store.updateClaim(claim.id, { status: "collecting", evidence: images.length ? [...new Set([...claim.evidence, message.id])] : claim.evidence });
    if (firstEvidence || (claim.status === "incomplete" && images.length)) await say(message.channelId, COPY.ack);
    schedule(claim.id);
  }

  function evidenceOf(claim) {
    const ids = new Set(claim.evidence);
    const msgs = store.messages(claim.channel_id).filter((m) => m.direction === "in");
    const files = [], hashes = [];
    for (const m of msgs) if (ids.has(m.id)) for (const a of m.attachments) if (isImage(a)) { files.push(a.file); hashes.push(a.sha256); }
    const text = msgs.filter((m) => m.created_at >= claim.created_at - 3_600_000).map((m) => m.content).join("\n");
    // Newest screenshots first: a resend usually fixes the earlier one.
    return { files: files.reverse(), hashes, text };
  }

  async function evaluate(claimId) {
    if (running.has(claimId)) return;
    const claim = store.transitionClaim(claimId, ["collecting"], "checking", now());
    if (!claim) return;
    running.add(claimId);
    try {
      const { files, hashes, text } = evidenceOf(claim);
      if (!files.length) { store.updateClaim(claimId, { status: "incomplete" }); return; }

      const characters = await game.characters(claim.discord_id);
      if (!characters.length) {
        store.updateClaim(claimId, { status: "not_linked" });
        return say(claim.channel_id, COPY.notLinked);
      }
      const lowered = text.toLowerCase();
      const named = characters.find((c) => c.name && lowered.includes(String(c.name).toLowerCase()));
      const character = named || characters[0];

      let verdict = null;
      try { verdict = await vision.inspect(files, null); } catch (e) {
        log(`vision claim ${claimId}: ${e.message}`);
        if (e.unreadable?.length) {
          store.updateClaim(claimId, { status: "incomplete", note: "No readable image" });
          return say(claim.channel_id, COPY.unreadable);
        }
      }

      const flags = [];
      if (store.hashOwners(hashes, claimId).length) flags.push("duplicate_image");
      const itch = verdict && !verdict.refused ? (verdict.comment_author || verdict.logged_in_username) : null;
      if (itch && store.itchUsernameOwners(claim.campaign, itch, claimId).some((c) => c.discord_id !== claim.discord_id)) flags.push("itch_username_reused");
      if (store.characterOwners(claim.campaign, character.id, claimId).length) flags.push("character_reused");
      // The same comment on another claim means a reused (possibly cropped or
      // re-saved) screenshot, or one comment pasted across accounts.
      if (verdict?.comment_text && store.commentOwners(claim.campaign, verdict.comment_text, claimId).some((c) => c.discord_id !== claim.discord_id)) flags.push("comment_reused");
      if (verdict?.logged_in_username && verdict?.comment_author && verdict.logged_in_username.toLowerCase() !== verdict.comment_author.toLowerCase()) flags.push("username_mismatch");
      if (verdict?.edit_suspicion === "high") flags.push("edit_suspected");
      if (verdict?.comment_found && String(verdict.comment_text || "").trim().length < MIN_COMMENT_CHARS) flags.push("low_effort_comment");
      if (character.createdAt && now() - Date.parse(character.createdAt) < NEW_CHARACTER_MS) flags.push("new_character");
      if (now() - discordCreatedAt(claim.discord_id) < NEW_DISCORD_MS) flags.push("new_discord_account");
      if (!named && characters.length && /\b(in[- ]?game|character|ign)\b/i.test(text)) flags.push("name_mismatch");

      store.recordHashes(claimId, hashes);
      const outcome = decide({ verdict, flags });
      store.updateClaim(claimId, { status: outcome.status, verdict, flags: outcome.flags || [], itch_username: itch, character_id: character.id, character_name: character.name });
      log(`claim ${claimId} ${claim.discord_id}: ${outcome.status}${outcome.flags?.length ? ` [${outcome.flags.join(",")}]` : ""}`);
      if (outcome.status === "approved") return grant(claimId);
      if (outcome.status === "needs_review") return say(claim.channel_id, COPY.review);
      return say(claim.channel_id, outcome.reply);
    } catch (e) {
      // Infrastructure failure (game API down): leave it for the moderator.
      log(`claim ${claimId} check failed: ${e.message}`);
      store.updateClaim(claimId, { status: "needs_review", note: `Automatic check failed: ${e.message}` });
      return say(claim.channel_id, COPY.review);
    } finally {
      running.delete(claimId);
    }
  }

  async function grant(claimId, { notify = true } = {}) {
    const claim = store.transitionClaim(claimId, ["approved"], "granting", now());
    if (!claim) return null;
    try {
      if (claim.campaign.endsWith(":test")) {
        // Tester dry run: everything but the payment.
        const result = { status: "dry_run", characterName: claim.character_name };
        store.updateClaim(claimId, { status: "granted", grant_result: result });
        if (notify) await say(claim.channel_id, COPY.testPassed(claim.character_name || "your character"));
        return result;
      }
      const result = await game.grant({ campaign: claim.campaign, discordId: claim.discord_id, claimRef: `keir-inbox:${claim.id}`, characterId: claim.character_id || undefined });
      store.updateClaim(claimId, { status: "granted", grant_result: result, character_name: result.characterName || claim.character_name });
      if (notify) await say(claim.channel_id, result.status === "already_granted" ? COPY.already : COPY.granted(result));
      return result;
    } catch (e) {
      log(`grant claim ${claimId}: ${e.message}`);
      if (e.status === 404) {
        store.updateClaim(claimId, { status: "not_linked", note: e.message });
        if (notify) await say(claim.channel_id, COPY.notLinked);
      } else {
        store.updateClaim(claimId, { status: "failed", note: e.message });
        if (notify) await say(claim.channel_id, COPY.failed);
      }
      return null;
    }
  }

  // ── staff actions from the ops inbox ──
  async function approve(claimId, by) {
    const claim = store.transitionClaim(claimId, ["needs_review", "failed", "incomplete", "not_linked"], "approved", now());
    if (!claim) return { ok: false, error: "Claim is not awaiting a decision" };
    store.updateClaim(claimId, { reviewed_by: by });
    const result = await grant(claimId);
    return { ok: Boolean(result), claim: store.claim(claimId) };
  }

  async function reject(claimId, by, message) {
    const claim = store.transitionClaim(claimId, ["needs_review", "failed", "incomplete", "not_linked", "collecting"], "rejected", now());
    if (!claim) return { ok: false, error: "Claim can no longer be rejected" };
    store.updateClaim(claimId, { reviewed_by: by, note: message || null });
    if (message) await say(claim.channel_id, message);
    return { ok: true, claim: store.claim(claimId) };
  }

  async function recheck(claimId) {
    const claim = store.transitionClaim(claimId, ["needs_review", "incomplete", "not_linked", "failed"], "collecting", now());
    if (!claim) return { ok: false, error: "Claim cannot be rechecked now" };
    await evaluate(claimId);
    return { ok: true, claim: store.claim(claimId) };
  }

  /** After a restart: finish whatever was in flight. Grants are idempotent in the game. */
  function recover() {
    for (const c of store.claimsByStatus(["collecting"])) schedule(c.id, 1000);
    for (const c of store.claimsByStatus(["checking"])) if (now() - c.updated_at > STALE_MS || !running.has(c.id)) { store.transitionClaim(c.id, ["checking"], "collecting", now()); schedule(c.id, 1000); }
    for (const c of store.claimsByStatus(["granting"])) { store.transitionClaim(c.id, ["granting"], "approved", now()); grant(c.id).catch((e) => log(e.message)); }
    for (const c of store.claimsByStatus(["approved"])) grant(c.id).catch((e) => log(e.message));
  }

  return { onMessage, evaluate, grant, approve, reject, recheck, recover, FLAG_TEXT };
}

module.exports = { createClaims, decide, discordCreatedAt, FLAG_TEXT, COPY };
