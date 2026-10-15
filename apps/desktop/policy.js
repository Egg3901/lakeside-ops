"use strict";
function origin(value) {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Enter an HTTPS server address. Local development may use loopback HTTP.");
  return url.origin;
}
function sameOrigin(value, expected) { try { return new URL(value).origin === expected; } catch { return false; } }
module.exports = { origin, sameOrigin };
