"use strict";

class TtlCache {
  constructor(ttlMs, maxEntries = 100) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  get(key, build) {
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && now - hit.at < this.ttlMs) return hit.value;
    const value = build();
    this.entries.set(key, { at: now, value });
    if (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
    return value;
  }

  clear(key) {
    if (key === undefined) this.entries.clear();
    else this.entries.delete(key);
  }
}

// Fast non-crypto content hash for change-detection on the capture poll.
// The pane is append-mostly, so hashing the tail + total length catches every
// change the client cares about at a fraction of SHA-1's cost over tens of KB.
// This is a change token (echoed back via ?v=), not a security digest.
function fingerprintOutput(output) {
  const text = String(output || "");
  const len = text.length;
  // FNV-1a over the last 4 KB — cheap, good distribution, no allocations.
  const tail = len > 4096 ? text.slice(len - 4096) : text;
  let hash = 0x811c9dc5;
  for (let i = 0; i < tail.length; i++) {
    hash ^= tail.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (len.toString(36) + ":" + (hash >>> 0).toString(36)).slice(0, 12);
}

function compactUnchangedSnapshot(snapshot, clientVersion) {
  if (!clientVersion || clientVersion !== snapshot.version) return snapshot;
  const { output, transcript, userAttachments, ...metadata } = snapshot;
  return { ...metadata, unchanged: true };
}

module.exports = { TtlCache, compactUnchangedSnapshot, fingerprintOutput };
