"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { origin, sameOrigin } = require("./policy");
test("desktop pins each installation to one origin", () => {
  assert.equal(origin("https://keir.example.com:8443/"), "https://keir.example.com:8443");
  assert.equal(origin("http://127.0.0.1:9724"), "http://127.0.0.1:9724");
  for (const value of ["http://example.com", "https://user:pass@example.com", "https://example.com/path", "file:///etc/passwd", "javascript:alert(1)"]) assert.throws(() => origin(value));
  assert.equal(sameOrigin("https://keir.example.com/app", "https://keir.example.com"), true);
  assert.equal(sameOrigin("https://keir.example.com.evil.invalid", "https://keir.example.com"), false);
});
