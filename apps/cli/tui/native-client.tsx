import type { Snapshot } from "../native/contracts";

type Bridge = { url: string; token: string };
export function nativeBridge(): Bridge {
  const value = JSON.parse(process.env.LAKESIDE_NATIVE_BRIDGE || "null");
  if (!value || typeof value.url !== "string" || typeof value.token !== "string") throw new Error("Native bridge is unavailable");
  const url = new URL(value.url);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password) throw new Error("Native bridge must use authenticated loopback transport");
  return value;
}
export async function nativeRequest(bridge: Bridge, endpoint: string, body?: object, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`${bridge.url}${endpoint}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${bridge.token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]) });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value?.error === "string" ? value.error : `Bridge returned ${response.status}`);
  return value;
}
export async function nativeSnapshot(bridge: Bridge, signal: AbortSignal): Promise<Snapshot> {
  const value = await nativeRequest(bridge, "/state", undefined, signal);
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("entries" in value) || !Array.isArray(value.entries) || !("permissions" in value) || !Array.isArray(value.permissions)) throw new Error("Invalid native bridge snapshot");
  return value as Snapshot;
}
