"use strict";

/**
 * Thin entry point for the ops dashboard.
 * Loads config, then boots the HTTP server (still in server.js during the
 * modularization migration — routes will move under src/routes/ incrementally).
 */

// Standalone mode never loads studio routes, sensors, Mongo or SSO.
if (process.env.LAKESIDE_MODE === "standalone") {
  require("../portal/server").start();
} else if (!process.env.LAKESIDE_MODE || process.env.LAKESIDE_MODE === "lakeside") {
  const { loadConfig } = require("./core/config");
  loadConfig();
  require("../server.js");
} else {
  throw new Error("LAKESIDE_MODE must be standalone or lakeside");
}
