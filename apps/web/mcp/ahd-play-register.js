// One-time: insert two authorized test-account users directly (mirrors
// src/app/api/auth/register/route.ts insert shape). Gameplay itself goes
// through the real cookie API; this only creates the login rows because the
// public register endpoint is gated by maintenance mode + Turnstile.
// Run:  node ahd-play-register.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("/root/projects/AHDGame/node_modules/bcryptjs");
const { MongoClient } = require("mongodb");

const uri = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8")
  .match(/MONGODB_URI=(.*)/)[1].trim();

function pw() { return crypto.randomBytes(18).toString("base64url"); }

const ACCOUNTS = [
  { email: "dale.brennan@lakesidegames.net",       username: "dalebrennan",       password: pw() },
  { email: "rupert.pemberton@lakesidegames.net",   username: "rupertpemberton",   password: pw() },
];

function lakesideAccountFields(source) {
  return { lakesideAccount: true, lakesideCreatedAt: new Date(), lakesideAccountSource: source };
}

(async () => {
  const c = await MongoClient.connect(uri);
  const db = c.db();
  const cfg = (await db.collection("config").findOne({})) || {};
  console.log("maintenanceMode:", JSON.stringify(cfg.maintenanceMode), "testMode:", cfg.testMode);
  const users = db.collection("users");
  const out = [];
  for (const a of ACCOUNTS) {
    const existing = await users.findOne({ $or: [{ email: a.email }, { username: a.username }] });
    if (existing) { console.log("exists, skipping:", a.username, String(existing._id)); out.push({ ...a, _id: String(existing._id), created: false }); continue; }
    const hashedPassword = await bcrypt.hash(a.password, 12);
    const r = await users.insertOne({
      email: a.email.toLowerCase(),
      username: a.username.toLowerCase(),
      displayName: a.username,
      password: hashedPassword,
      role: "player",
      isAdmin: false,
      hasCompletedSetup: false,
      registrationIp: "127.0.0.1",
      lastKnownIp: "127.0.0.1",
      registrationFingerprint: null,
      lastFingerprint: null,
      fingerprintHistory: [],
      registrationFingerprintComponents: null,
      lastFingerprintComponents: null,
      trackingId: crypto.randomUUID(),
      deviceKey: null,
      lastDevice: "server",
      referralCount: 0,
      activeCharacterId: null,
      activeCharacterCount: 0,
      ...lakesideAccountFields("ahd"),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log("created:", a.username, String(r.insertedId));
    out.push({ ...a, _id: String(r.insertedId), created: true });
  }
  await c.close();
  fs.writeFileSync(path.join(__dirname, "ahd-play.credentials.json"), JSON.stringify(out, null, 2));
  console.log("\ncredentials written to ahd-play.credentials.json");
  for (const a of out) console.log(`  ${a.username}  ${a.email}  ${a.password}`);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
