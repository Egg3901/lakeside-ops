"use strict";

// A broker receipt ends an activation, not necessarily its durable task. The
// broker has already checked approvals, saved state and arranged any wakeup.
async function untilAcceptedFinish(run, { completionUrl, signal, timeoutMs, settleCompletion }) {
  if (!completionUrl) return { process: await run(signal) };
  const worker = new AbortController(), observer = new AbortController();
  const abort = () => worker.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const pending = run(worker.signal);
  try {
    const receipt = fetch(completionUrl, { signal: AbortSignal.any([signal, observer.signal, AbortSignal.timeout(timeoutMs)]) })
      .then(async response => {
        if (!response.ok) return null;
        const value = await response.json();
        return value?.version === 1 && typeof value.state === "string" && typeof value.summary === "string" && Number.isFinite(value.acceptedAt) ? value : null;
      }).catch(() => null);
    const first = await Promise.race([
      pending.then(process => ({ process })),
      receipt.then(completion => completion ? { completion } : pending.then(process => ({ process }))),
    ]);
    if (first.completion) {
      if (settleCompletion && !signal.aborted) await settleCompletion();
      worker.abort();
      // Wait for the process tree to stop before exporting its transcript.
      await pending.catch(() => {});
      if (signal.aborted) throw new Error("activation aborted");
    }
    return first;
  } finally {
    observer.abort();
    signal.removeEventListener("abort", abort);
  }
}
module.exports = { untilAcceptedFinish };
