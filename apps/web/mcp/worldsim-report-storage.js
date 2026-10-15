"use strict";

const REPORTS = "simExperimentReports";
const CHUNKS = "simExperimentReportChunks";
const TIMELINES = ["seatsTimeline", "partyOrgTimeline", "corporationsTimeline"];
const FIELDS = [...TIMELINES, ...["approval", "macro"].flatMap(section =>
  [`longHorizonTelemetry.${section}.points`, `longHorizonTelemetry.${section}.series`])];

function sampleExpression(field, max) {
  return { $let: { vars: { rows: { $cond: [{ $isArray: `$${field}` }, `$${field}`, []] } }, in:
    { $cond: [{ $lte: [{ $size: "$$rows" }, max] }, "$$rows", { $map: {
      input: { $range: [0, max] }, as: "index", in: { $arrayElemAt: ["$$rows",
        { $floor: { $multiply: ["$$index", { $divide: [{ $size: "$$rows" }, max] }] } }] },
    } }] } } };
}

async function metadata(db, runId, max) {
  const rows = await db.collection(REPORTS).aggregate([
    { $match: { _id: runId } },
    { $project: { _id: 1, turn: 1, finalMetrics: 1, collectedAt: 1, timelineStorage: 1,
      longHorizonTelemetry: 1, "runConfig.source.requestedCommit": 1,
      "runConfig.source.executedCommit": 1, "runConfig.source.collectorCommit": 1,
      ...Object.fromEntries(TIMELINES.map(field => [field, sampleExpression(field, max)])),
    } },
  ]).toArray();
  return rows[0] || null;
}

function validateHeaders(manifest, headers) {
  if (![1, 2].includes(manifest.version) || typeof manifest.generation !== "string" ||
      !Number.isSafeInteger(manifest.chunkCount) || manifest.chunkCount < 0 ||
      headers.length !== manifest.chunkCount) throw new Error("Incomplete experiment report generation");
  const expected = manifest.version === 2 ? manifest.fields :
    [...new Set([...TIMELINES, ...headers.map(row => row.field)])].map(path => ({ path }));
  if (!Array.isArray(expected) || new Set(expected.map(row => row.path)).size !== expected.length ||
      expected.some(row => !FIELDS.includes(row.path)) ||
      headers.some(row => !expected.some(entry => entry.path === row.field)))
    throw new Error("Invalid experiment report field manifest");
  const result = new Map();
  for (const entry of expected) {
    const rows = headers.filter(row => row.field === entry.path);
    if (rows.some((row, index) => row.sequence !== index || !Number.isSafeInteger(row.pointCount) || row.pointCount < 0))
      throw new Error("Non-contiguous experiment report chunks");
    const total = rows.reduce((sum, row) => sum + row.pointCount, 0);
    if (!Number.isSafeInteger(total) || (manifest.version === 2 &&
        (entry.pointCount !== total || entry.chunkCount !== rows.length)))
      throw new Error("Incomplete experiment report field");
    result.set(entry.path, { rows, total });
  }
  return result;
}

async function headers(db, report) {
  const rows = await db.collection(CHUNKS).aggregate([
    { $match: { runId: report._id, generation: report.timelineStorage.generation } },
    { $project: { _id: 0, field: 1, sequence: 1, pointCount: { $size: "$points" } } },
    { $sort: { field: 1, sequence: 1 } },
  ]).toArray();
  return validateHeaders(report.timelineStorage, rows);
}

function selections(field, descriptor, indexes) {
  const plans = [];
  let offset = 0;
  for (const row of descriptor.rows) {
    const local = indexes.filter(index => index >= offset && index < offset + row.pointCount).map(index => index - offset);
    if (local.length) plans.push({ field, sequence: row.sequence, indexes: local });
    offset += row.pointCount;
  }
  return plans;
}

async function readSelected(db, report, plans) {
  if (!plans.length) return new Map();
  const rows = await db.collection(CHUNKS).aggregate([
    { $match: { runId: report._id, generation: report.timelineStorage.generation,
      $or: plans.map(({ field, sequence }) => ({ field, sequence })) } },
    { $project: { _id: 0, field: 1, sequence: 1, points: { $switch: {
      branches: plans.map(plan => ({
        case: { $and: [{ $eq: ["$field", plan.field] }, { $eq: ["$sequence", plan.sequence] }] },
        then: { $map: { input: plan.indexes, as: "index", in: { $arrayElemAt: ["$points", "$$index"] } } },
      })), default: [],
    } } } },
    { $sort: { field: 1, sequence: 1 } },
  ]).toArray();
  if (rows.length !== plans.length) throw new Error("Experiment report generation changed during retrieval");
  const result = new Map();
  for (const row of rows) {
    const plan = plans.find(entry => entry.field === row.field && entry.sequence === row.sequence);
    if (!plan || row.points.length !== plan.indexes.length) throw new Error("Incomplete experiment report selection");
    const points = result.get(row.field) || [];
    points.push(...row.points);
    result.set(row.field, points);
  }
  return result;
}

function requireLimit(limit, minimum, maximum) {
  if (!Number.isSafeInteger(limit) || limit < minimum || limit > maximum) throw new Error("Invalid experiment report retrieval limit");
}

async function readWorldsimExperimentReport(db, runId, maxPoints = 500) {
  requireLimit(maxPoints, 10, 5000);
  const report = await metadata(db, runId, maxPoints);
  if (!report?.timelineStorage) return report;
  const descriptors = await headers(db, report);
  const plans = [];
  for (const field of TIMELINES) {
    const descriptor = descriptors.get(field) || { rows: [], total: 0 };
    const indexes = Array.from({ length: Math.min(descriptor.total, maxPoints) }, (_, index) =>
      descriptor.total <= maxPoints ? index : Math.floor(index * (descriptor.total / maxPoints)));
    plans.push(...selections(field, descriptor, indexes));
  }
  // Series coverage and exact missing-turn lists remain unsampled. Point
  // evidence is retrieved separately in pages, never an implied empty array.
  for (const section of ["approval", "macro"]) {
    const descriptor = descriptors.get(`longHorizonTelemetry.${section}.series`);
    if (descriptor && descriptor.total <= 1000)
      plans.push(...selections(`longHorizonTelemetry.${section}.series`, descriptor,
        Array.from({ length: descriptor.total }, (_, index) => index)));
  }
  const selected = await readSelected(db, report, plans);
  for (const field of TIMELINES) report[field] = selected.get(field) || [];
  for (const section of ["approval", "macro"]) {
    if (!report.longHorizonTelemetry?.[section]) continue;
    const target = report.longHorizonTelemetry[section];
    for (const field of ["points", "series"]) {
      const path = `longHorizonTelemetry.${section}.${field}`;
      const descriptor = descriptors.get(path);
      if (!descriptor) continue;
      if (selected.has(path)) target[field] = selected.get(path);
      else if (descriptor.total > 0) delete target[field];
      target[`${field}Count`] = descriptor.total;
    }
    target.retrieval = { tool: "sim_experiment_telemetry", section, generation: report.timelineStorage.generation };
  }
  if (report.longHorizonTelemetry && report.runConfig?.source)
    report.longHorizonTelemetry.source = report.runConfig.source;
  return report;
}

async function readWorldsimTelemetryPage(db, runId, section, field = "points", offset = 0, limit = 50, generation) {
  requireLimit(limit, 1, 100);
  if (!["approval", "macro"].includes(section) || !["points", "series"].includes(field) ||
      !Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid telemetry page selection");
  const report = await metadata(db, runId, 10);
  if (!report) return null;
  if (generation && report.timelineStorage?.generation !== generation) throw new Error("Experiment report generation changed; restart pagination");
  const path = `longHorizonTelemetry.${section}.${field}`;
  let total, points;
  if (report.timelineStorage) {
    const descriptor = (await headers(db, report)).get(path);
    if (!descriptor) {
      const inline = report.longHorizonTelemetry?.[section]?.[field] || [];
      total = inline.length; points = inline.slice(offset, offset + limit);
    } else {
      total = descriptor.total;
      const indexes = Array.from({ length: Math.min(limit, Math.max(0, total - offset)) }, (_, index) => offset + index);
      points = (await readSelected(db, report, selections(path, descriptor, indexes))).get(path) || [];
    }
  } else {
    const inline = report.longHorizonTelemetry?.[section]?.[field] || [];
    total = inline.length; points = inline.slice(offset, offset + limit);
  }
  return { runId, section, field, generation: report.timelineStorage?.generation || null,
    offset, total, points, nextOffset: offset + points.length < total ? offset + points.length : null,
    source: report.runConfig?.source || null };
}

module.exports = { readWorldsimExperimentReport, readWorldsimTelemetryPage, validateHeaders };
