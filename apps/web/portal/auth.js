"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");
const scrypt = promisify(crypto.scrypt);
const digest = token => crypto.createHash("sha256").update(token).digest("hex");
async function passwordHash(password) {
  if (typeof password !== "string" || password.length < 12) throw new Error("Use a password of at least 12 characters");
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt:${salt}:${(await scrypt(password, salt, 32)).toString("hex")}`;
}
async function passwordMatches(password, hash) {
  const parts = /^scrypt:([a-f0-9]{32}):([a-f0-9]{64})$/.exec(hash || "");
  if (!parts || typeof password !== "string" || password.length > 1024) return false;
  const actual = await scrypt(password, parts[1], 32);
  return crypto.timingSafeEqual(actual, Buffer.from(parts[2], "hex"));
}
function sessions(file, now = Date.now) {
  let rows = {};
  try { rows = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
  function save() {
    rows = Object.fromEntries(Object.entries(rows).filter(([, r]) => r.expires > now()));
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(rows), { mode: 0o600 }); fs.renameSync(`${file}.tmp`, file);
  }
  return {
    create() { const token = crypto.randomBytes(32).toString("base64url"); rows[digest(token)] = { expires: now() + 7 * 86400000 }; save(); return token; },
    has(token) { return typeof token === "string" && token.length === 43 && rows[digest(token)]?.expires > now(); },
    remove(token) { if (token) delete rows[digest(token)]; save(); },
  };
}
module.exports = { passwordHash, passwordMatches, sessions };
