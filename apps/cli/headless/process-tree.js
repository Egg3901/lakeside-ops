"use strict";
const fs = require("node:fs");

// Freeze parents before walking children, including children with new process groups.
async function terminateTree(root) {
  if (!root) return;
  if (process.platform !== "linux") { try { process.kill(-root, "SIGKILL"); } catch {} return; }
  const stopped = new Map();
  const identity = pid => {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(") ") + 2).split(" ");
      return { state: fields[0], start: fields[19] };
    } catch { return null; }
  };
  async function freeze(pid) {
    if (stopped.has(pid)) return;
    const before = identity(pid); if (!before) return;
    try { process.kill(pid, "SIGSTOP"); } catch { return; }
    stopped.set(pid, before.start);
    for (let i = 0; i < 25; i++) {
      const current = identity(pid);
      if (!current || /[TtZX]/.test(current.state)) break;
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    let threads; try { threads = fs.readdirSync(`/proc/${pid}/task`); } catch { return; }
    const children = new Set();
    for (const tid of threads) {
      try { for (const value of fs.readFileSync(`/proc/${pid}/task/${tid}/children`, "utf8").trim().split(/\s+/)) if (value) children.add(Number(value)); } catch {}
    }
    for (const child of children) await freeze(child);
  }
  try { await freeze(root); }
  finally {
    for (const [pid, start] of [...stopped].reverse()) {
      if (identity(pid)?.start === start) try { process.kill(pid, "SIGKILL"); } catch {}
    }
    // SIGKILL delivery is asynchronous. Wait briefly for the killed identities
    // to disappear or become zombies before reporting cancellation complete.
    for (let i = 0; i < 100; i++) {
      if (![...stopped].some(([pid, start]) => { const p = identity(pid); return p?.start === start && !/[ZX]/.test(p.state); })) break;
      await new Promise(resolve => setTimeout(resolve, 2));
    }
  }
}

module.exports = { terminateTree };
