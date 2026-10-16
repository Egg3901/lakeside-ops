#!/usr/bin/env node
"use strict";
const input = process.argv.slice(2);
if (input[0] === "code") require("../commands").main(input.slice(1)).catch(error => { console.error(error.message); process.exitCode = 1; });
else console.log("Lakeside Code\nUsage: lakeside code [project] [OpenCode options]\n       lakeside code doctor | peers | handoffs\n       lakeside code --preview");
