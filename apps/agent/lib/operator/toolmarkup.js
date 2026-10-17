"use strict";
// Some API models (DeepSeek v4-pro, 2026-10-17) occasionally print their tool
// calls as text instead of calling the tool. That text is never an answer.
const MARKUP = /<\/?(?:tool_calls?|invoke|function_calls)\b|<parameter name=|<\｜tool▁calls|<｜DSML｜|\bmcp__keir__[a-z_]+["']?>/i;
const leaked = (text) => MARKUP.test(String(text || ""));
module.exports = { leaked };
