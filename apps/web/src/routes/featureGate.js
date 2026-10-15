"use strict";

/**
 * Feature-flag helpers for route handlers (HTTP or Express-style).
 */

const { isEnabled } = require("../services/featureFlags");

function featureDisabledResponse(res, feature) {
  if (isEnabled(feature)) return false;
  if (typeof res.writeHead === "function") {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Feature disabled");
  } else if (typeof res.status === "function") {
    res.status(404).type("text").send("Feature disabled");
  }
  return true;
}

function assertFeature(feature) {
  return (req, res, next) => {
    if (featureDisabledResponse(res, feature)) return;
    if (typeof next === "function") next();
  };
}

module.exports = { featureDisabledResponse, assertFeature, isEnabled };
