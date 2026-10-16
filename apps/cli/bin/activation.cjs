#!/usr/bin/env node
"use strict";
const { executeActivation } = require("../headless/runtime");
const { redactSecrets } = require("../headless/text");
const controller = new AbortController();
process.on("SIGTERM", () => controller.abort());
process.on("SIGINT", () => controller.abort());
(async () => {
  let body = "";
  for await (const chunk of process.stdin) {
    body += chunk;
    if (Buffer.byteLength(body) > 2000000) throw new Error("Activation request too large");
  }
  const result = await executeActivation(JSON.parse(body), { signal: controller.signal });
  process.stdout.write(JSON.stringify(result) + "\n");
})().catch(error => {
  process.stdout.write(JSON.stringify({ subtype: "error", is_error: true, result: redactSecrets(error.message) }) + "\n");
  process.exitCode = 1;
});
