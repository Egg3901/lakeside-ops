import type { RequestPermissionRequest, NewSessionResponse } from "@agentclientprotocol/sdk";
export type RunState = "starting" | "idle" | "running" | "permission" | "completed" | "cancelled" | "failed" | "uncertain";
export type Entry = { id: string; role: "user" | "assistant" | "tool" | "notice"; text: string; status?: string };
export type NativeRun = {
  version: 1; id: string; backend: string; directory: string; createdAt: string; updatedAt: string;
  state: RunState; sessionId?: string; model?: string; stopReason?: string; error?: string;
  entries: Entry[];
};
export type Permission = { id: string; request: RequestPermissionRequest };
export type Snapshot = NativeRun & { connected: boolean; permissions: Permission[]; configOptions?: NewSessionResponse["configOptions"] };
