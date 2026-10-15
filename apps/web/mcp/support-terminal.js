"use strict";

const merge = require("./support-tracker");

function actionText(action) {
  if (typeof action === "string") return action.trim();
  if (!action || typeof action !== "object") return "";
  const label = String(
    action.label || action.action || action.title || "",
  ).trim();
  const detail = String(action.detail || action.description || "").trim();
  if (!label) return "";
  return detail ? `${label}: ${detail}` : label;
}

function resolutionTrackerBody(resolution) {
  const parts = [];
  const message = String((resolution && resolution.message) || "").trim();
  if (message) parts.push(`Resolution: ${message}`);
  const actions = Array.isArray(resolution && resolution.actions)
    ? resolution.actions.map(actionText).filter(Boolean)
    : [];
  if (actions.length)
    parts.push(
      `Actions:\n${actions.map((action) => `- ${action}`).join("\n")}`,
    );
  const followUp = String((resolution && resolution.followUp) || "").trim();
  if (followUp) parts.push(`Follow-up: ${followUp}`);
  return parts.join("\n\n").slice(0, merge.LIMITS.trackerBody);
}

function buildTerminalTicketTrackerPlan({
  number,
  title,
  existing,
  resolution,
  by,
  nowMs,
}) {
  const args = {
    // A terminal Discord resolution is evidence of a production-complete
    // support outcome, so keep the tracker in the same terminal state used by
    // the rest of the production workflow.
    status: "done_prod",
    updated_by: by,
  };
  // Do not overwrite a linked tracker's internal diagnosis. A ticket that was
  // never linked still needs a useful body when terminal resolution creates it.
  if (!existing || !existing.trackerItemId) {
    args.body = resolutionTrackerBody(resolution);
  }
  const built = merge.buildTrackerUpsert("ticket", number, title, args, nowMs);
  if (built.error) return built;
  return { trackerItemId: built.id, update: built.update };
}

async function syncTerminalTicketTracker({
  trackerItems,
  tickets,
  ticketKey,
  ticket,
  number,
  resolution,
  by,
  now,
}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const plan = buildTerminalTicketTrackerPlan({
    number,
    title: ticket && ticket.title,
    existing: ticket,
    resolution,
    by,
    nowMs,
  });
  if (plan.error) throw new Error(plan.error);
  await trackerItems.updateOne({ id: plan.trackerItemId }, plan.update, {
    upsert: true,
  });
  await tickets.updateOne(ticketKey, {
    $set: {
      trackerItemId: plan.trackerItemId,
      trackerUpdatedAt: now,
    },
  });
  return { trackerItemId: plan.trackerItemId };
}

module.exports = {
  buildTerminalTicketTrackerPlan,
  syncTerminalTicketTracker,
  resolutionTrackerBody,
};
