const fs = require("node:fs");

function findings(report) {
  if (report.version !== "2.1.0" || !Array.isArray(report.runs) || !report.runs.length) {
    throw new Error("Missing SARIF analysis runs");
  }
  return report.runs.flatMap(run => {
    if (!Array.isArray(run.results)) throw new Error("Missing SARIF results");
    return run.results.filter(result => result.kind !== "pass" && result.kind !== "notApplicable")
      .map(result => {
        const location = result.locations?.[0]?.physicalLocation;
        if (!result.ruleId || !location?.artifactLocation?.uri) {
          throw new Error("Finding is missing its rule or source location");
        }
        const fingerprints = result.partialFingerprints || {};
        const identity = Object.keys(fingerprints).length
          ? Object.entries(fingerprints).sort(([a], [b]) => a.localeCompare(b))
          : location.region;
        if (!identity) throw new Error("Finding has no stable fingerprint or region");
        return JSON.stringify([result.ruleId, location.artifactLocation.uri, identity, result.message]);
      });
  });
}

function compareFindings(current, baseline) {
  const counts = new Map();
  for (const finding of baseline) counts.set(finding, (counts.get(finding) || 0) + 1);
  const introduced = [];
  for (const finding of current) {
    const remaining = counts.get(finding) || 0;
    if (remaining) counts.set(finding, remaining - 1);
    else introduced.push(finding);
  }
  return introduced;
}

if (require.main === module) {
  const [headPath, basePath] = process.argv.slice(2);
  const current = findings(JSON.parse(fs.readFileSync(headPath, "utf8")));
  const baseline = basePath ? findings(JSON.parse(fs.readFileSync(basePath, "utf8"))) : [];
  const introduced = compareFindings(current, baseline);
  console.log(JSON.stringify({ total: current.length, baseline: baseline.length, blocking: introduced.length, introduced }, null, 2));
  process.exitCode = introduced.length ? 1 : 0;
}

module.exports = { findings, compareFindings };
