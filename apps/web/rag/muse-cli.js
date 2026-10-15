"use strict";

// One headless call to the muse CLI on the owner's subscription. This is the
// only bulk generation lane on the box for the file map: no API key, no
// per-token bill, one process per call. Resolves { ok, text, ms, error } and
// never throws; the caller decides what a failure means.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const MODEL = process.env.RAG_FILE_MAP_MODEL || "muse-spark-1.3-contributor";
const EFFORT = process.env.RAG_FILE_MAP_EFFORT || "minimal";

function museCall(prompt, { timeoutMs = 120000, model = MODEL, effort = EFFORT } = {}) {
  const dir = path.join(os.tmpdir(), "rag-file-map");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = crypto.createHash("sha1").update(prompt).digest("hex").slice(0, 12);
  const file = path.join(dir, `${process.pid}-${stamp}.txt`);
  fs.writeFileSync(file, prompt);
  const started = Date.now();
  return new Promise(resolve => {
    let child;
    try {
      child = spawn("muse", ["exec", "--json", "--model", model, "--reasoning-effort", effort, "--prompt-file", file],
        { cwd: os.tmpdir(), env: { ...process.env, HOME: process.env.HOME || "/root" }, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      try { fs.unlinkSync(file); } catch {}
      return resolve({ ok: false, text: null, ms: 0, error: `spawn failed: ${error.message}` });
    }
    let out = "", err = "";
    child.stdout.on("data", d => { out += d; });
    child.stderr.on("data", d => { err += d; });
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, timeoutMs);
    child.on("error", error => {
      clearTimeout(timer);
      try { fs.unlinkSync(file); } catch {}
      resolve({ ok: false, text: null, ms: Date.now() - started, error: `muse: ${error.message}` });
    });
    child.on("close", code => {
      clearTimeout(timer);
      try { fs.unlinkSync(file); } catch {}
      const ms = Date.now() - started;
      let text = null, terminal = null, error = null;
      for (const line of out.split("\n")) {
        if (!line.startsWith("{")) continue;
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (String(event.payload_type || "").startsWith("run.terminal")) {
          terminal = event.payload?.terminal || event.payload_type;
          if (typeof event.payload?.text === "string") text = event.payload.text;
          if (event.payload?.reason) error = String(event.payload.reason);
        }
      }
      const ok = code === 0 && terminal === "completed" && typeof text === "string" && text.length > 0;
      if (!ok && !error) error = `exit=${code} terminal=${terminal} ${err.trim().split("\n").slice(-2).join(" | ").slice(0, 300)}`;
      resolve({ ok, text, ms, error: ok ? null : error });
    });
  });
}

/** First JSON object or array in model output, tolerating fences and prose. null when there is none. */
function parseJsonLoose(text) {
  const s = String(text || "").replace(/```(?:json)?/gi, "");
  const starts = [s.indexOf("{"), s.indexOf("[")].filter(i => i >= 0);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const closer = s[start] === "{" ? "}" : "]";
  const end = s.lastIndexOf(closer);
  if (end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

module.exports = { museCall, parseJsonLoose, MODEL, EFFORT };
