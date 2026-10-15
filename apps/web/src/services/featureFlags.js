"use strict";

/**
 * Feature flags — reads merged config (YAML + env).
 */

const { getConfig, FEATURE_ENV_MAP } = require("../core/config");

function isEnabled(feature) {
  if (!feature) return false;
  const features = getConfig().features || {};
  if (Object.prototype.hasOwnProperty.call(features, feature)) {
    return !!features[feature];
  }
  return false;
}

function listFlags() {
  const features = getConfig().features || {};
  return { ...features };
}

function requireFeature(feature) {
  return (req, res, next) => {
    if (!isEnabled(feature)) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Feature disabled");
      return;
    }
    if (typeof next === "function") next();
  };
}

module.exports = {
  isEnabled,
  listFlags,
  requireFeature,
  FEATURE_ENV_MAP,
};
