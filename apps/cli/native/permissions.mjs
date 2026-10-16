// @ts-check
import crypto from "node:crypto";
/** @typedef {import('@agentclientprotocol/sdk').RequestPermissionRequest} Request */
/** @typedef {import('@agentclientprotocol/sdk').RequestPermissionResponse} Response */
export class PermissionBroker {
  /** @type {Map<string, {request: Request, finish: (response: Response) => void}>} */
  pending = new Map();
  /** @param {Request} request @param {AbortSignal} signal @param {() => void} changed @returns {Promise<Response>} */
  ask(request, signal, changed) {
    if (signal.aborted) return Promise.resolve({ outcome: { outcome: "cancelled" } });
    const id = crypto.randomUUID();
    return new Promise(resolve => {
      const abort = () => finish({ outcome: { outcome: "cancelled" } });
      /** @param {Response} response */
      const finish = response => { this.pending.delete(id); signal.removeEventListener("abort", abort); changed(); resolve(response); };
      this.pending.set(id, { request, finish });
      signal.addEventListener("abort", abort, { once: true });
      changed();
    });
  }
  /** @param {string} id @param {string | null} option */
  select(id, option) {
    const pending = this.pending.get(id);
    if (!pending) throw new Error("Permission request is no longer pending");
    if (option !== null && !pending.request.options.some(value => value.optionId === option)) throw new Error("Unknown permission option");
    pending.finish({ outcome: option === null ? { outcome: "cancelled" } : { outcome: "selected", optionId: option } });
  }
  cancelAll() { for (const pending of [...this.pending.values()]) pending.finish({ outcome: { outcome: "cancelled" } }); }
  snapshot() { return [...this.pending].map(([id, value]) => ({ id, request: value.request })); }
}
