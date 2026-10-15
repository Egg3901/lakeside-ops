"use strict";

function downsample(arr, maxPoints) {
  if (!Array.isArray(arr) || arr.length <= maxPoints) return arr;
  const step = arr.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

/** Build the public MCP payload. Long-horizon evidence is deliberately copied
 * verbatim: its full cardinality and exact missing-turn lists are audit data,
 * not a display timeline that may be sampled. */
function buildExperimentReportResponse(report, maxPoints) {
  return {
    runId: report.runId || String(report._id),
    turn: report.turn,
    seatsTimeline: downsample(report.seatsTimeline, maxPoints),
    partyOrgTimeline: downsample(report.partyOrgTimeline, maxPoints),
    corporationsTimeline: downsample(report.corporationsTimeline, maxPoints),
    finalMetrics: report.finalMetrics,
    ...(report.longHorizonTelemetry !== undefined
      ? { longHorizonTelemetry: report.longHorizonTelemetry }
      : {}),
    collectedAt: report.collectedAt,
  };
}

module.exports = { buildExperimentReportResponse, downsample };
