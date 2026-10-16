import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
import fs from "node:fs";
import path from "node:path";
let directory = process.cwd(), cancel;
const record = method => { if (process.env.LAKESIDE_FAKE_LOG) fs.appendFileSync(process.env.LAKESIDE_FAKE_LOG, method + "\n"); };
const configOptions = [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "fixture-model", options: [{ value: "fixture-model", name: "Fixture" }] }];
const app = acp.agent({ name: "native-fixture" })
  .onRequest("initialize", () => ({ protocolVersion: 1, agentCapabilities: { loadSession: true, mcpCapabilities: { http: true } } }))
  .onRequest("session/new", ({ params }) => { directory = params.cwd; record("new"); return { sessionId: "native_fixture", configOptions }; })
  .onRequest("session/load", ({ params }) => { directory = params.cwd; record("load"); return { configOptions }; })
  .onRequest("session/set_config_option", ({ params }) => { record(`model:${params.value}`); return { configOptions }; })
  .onNotification("session/cancel", () => { record("cancel"); cancel?.(); })
  .onRequest("session/prompt", async ({ params, client }) => {
    record("prompt");
    const text = params.prompt.filter(part => part.type === "text").map(part => part.text).join("\n").split("Owner's current request:\n").at(-1);
    if (text === "disconnect") { process.exit(0); }
    if (text === "wait") { await new Promise(resolve => { cancel = resolve; }); return { stopReason: "cancelled" }; }
    await client.notify("session/update", { sessionId: params.sessionId, update: { sessionUpdate: "tool_call", toolCallId: "fixture-tool", title: "Edit fixture", kind: "edit", status: "pending" } });
    const permission = await client.request("session/request_permission", { sessionId: params.sessionId, toolCall: { toolCallId: "fixture-tool", title: "Edit fixture", kind: "edit" }, options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }, { optionId: "deny", name: "Reject once", kind: "reject_once" }] });
    if (permission.outcome.outcome === "selected" && permission.outcome.optionId === "allow") {
      await client.request("fs/write_text_file", { sessionId: params.sessionId, path: path.join(directory, "native-result.txt"), content: "Native fixture edited this file\n" });
      await client.notify("session/update", { sessionId: params.sessionId, update: { sessionUpdate: "tool_call_update", toolCallId: "fixture-tool", status: "completed", content: [{ type: "content", content: { type: "text", text: "Fixture file written" } }] } });
      await client.notify("session/update", { sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Native fixture complete" } } });
    }
    return { stopReason: "end_turn" };
  });
app.connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
