#!/usr/bin/env node
"use strict";
const input = process.argv.slice(2);
require("../commands").main(input[0] === "code" ? input.slice(1) : input).catch(error => { console.error(error.message); process.exitCode = 1; });
