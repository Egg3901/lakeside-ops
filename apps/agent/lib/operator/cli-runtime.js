"use strict";
const fs = require("node:fs");
const path = require("node:path");
// Source checkouts and immutable operator releases use the same CLI runtime.
const packaged = path.join(__dirname, "../../cli-runtime");
const root = fs.existsSync(packaged) ? packaged : path.join(__dirname, "../../../cli");
module.exports = name => require(path.join(root, "headless", name));
module.exports.root = root;
