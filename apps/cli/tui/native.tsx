/** @jsxImportSource @opentui/solid */
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import type { TextareaRenderable } from "@opentui/core";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { Snapshot } from "../native/contracts";
import { ink, Brand, Rail } from "./brand";
import { nativeBridge, nativeRequest, nativeSnapshot } from "./native-client";
import { showNativePermission } from "./native-permission";
import { showWorkbench } from "./workbench";

export function NativeSession(props: { api: TuiPluginApi; name: string }) {
  const bridge = nativeBridge(), dimensions = useTerminalDimensions();
  const [snapshot, setSnapshot] = createSignal<Snapshot>();
  const [error, setError] = createSignal("");
  const [connectionError, setConnectionError] = createSignal("");
  const [sending, setSending] = createSignal(false);
  let input: TextareaRenderable | undefined, pendingID: string | undefined, prompted = "", polling = false;
  const controller = new AbortController();
  const busy = () => sending() || ["starting", "running", "permission"].includes(snapshot()?.state || "starting");
  async function refresh() {
    if (polling || controller.signal.aborted) return;
    polling = true;
    try { setSnapshot(await nativeSnapshot(bridge, controller.signal)); setConnectionError(""); }
    catch (error) { if (!controller.signal.aborted) setConnectionError(error instanceof Error ? error.message : "Native bridge disconnected"); }
    finally { polling = false; }
  }
  void refresh();
  const timer = setInterval(refresh, 500);
  onCleanup(() => { clearInterval(timer); controller.abort(); });
  createEffect(() => {
    const permission = snapshot()?.permissions[0];
    if (permission && permission.id !== prompted && !props.api.ui.dialog.open) { prompted = permission.id; showNativePermission(props.api, permission); }
  });
  async function submit() {
    if (!input || busy() || !snapshot()?.connected || props.api.ui.dialog.open) return;
    const text = input.plainText.trim();
    if (!text) return;
    if (text === "/workbench") { input.clear(); showWorkbench(props.api); return; }
    if (text === "/connections") { input.clear(); props.api.ui.toast({ variant: "info", message: "Configured MCP endpoints are forwarded to the native agent. Inspect MCP status using that backend's tools; the API engine's MCP status is separate." }); return; }
    pendingID ||= crypto.randomUUID();
    setSending(true);
    try { await nativeRequest(bridge, "/prompt", { text, id: pendingID }, controller.signal); input.clear(); pendingID = undefined; setError(""); await refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : "Submission outcome is uncertain; the draft and request id were preserved."); }
    finally { setSending(false); }
  }
  async function cancel() {
    try { await nativeRequest(bridge, "/cancel", {}, controller.signal); await refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : "Cancellation outcome is uncertain"); }
  }
  useKeyboard(key => {
    if (key.name === "escape" && busy() && !props.api.ui.dialog.open) { key.preventDefault(); void cancel(); }
  });
  return <box width="100%" height="100%" backgroundColor={ink.bg} padding={2} gap={1}>
    <box flexDirection="row" justifyContent="space-between"><text fg={ink.primary}><b>▲ {props.name}</b></text><text fg={ink.muted}>Native · {snapshot()?.backend || "connecting"} · {snapshot()?.state === "completed" ? "turn finished" : snapshot()?.state || "starting"}</text></box>
    <box flexDirection="row" flexGrow={1} minHeight={0} gap={3}>
      <scrollbox flexGrow={1} stickyScroll stickyStart="bottom" minWidth={0}>
        <Show when={!snapshot()?.entries.length}><box paddingTop={2} gap={1}><text fg={ink.text}><b>Your project. Your workflow.</b></text><text fg={ink.muted}>Inspect, edit, validate and review using the selected native agent.</text></box></Show>
        <For each={snapshot()?.entries || []}>{entry => <box paddingTop={1} paddingBottom={1} gap={1} backgroundColor={entry.role === "tool" ? ink.panel : undefined}><text fg={entry.role === "user" ? ink.muted : ink.primary}><b>{entry.role === "assistant" ? props.name : entry.role === "user" ? "You" : entry.role === "tool" ? `Tool · ${entry.status || "reported"}` : "Plan"}</b></text><text fg={ink.text}>{entry.text}</text></box>}</For>
      </scrollbox>
      <Show when={dimensions().width >= 110}><box width={28} gap={2}><Brand name={props.name} compact /><box><Rail title="Execution" /><text fg={ink.text}>{snapshot()?.backend || "Starting native backend"}</text><text fg={ink.muted}>{snapshot()?.model || "Backend's configured model"}</text></box><box><Rail title="Task record" /><text fg={ink.muted}>{snapshot()?.id || "Creating record"}</text><text fg={ink.primary} onMouseDown={() => showWorkbench(props.api)}>Changes · live diff</text><text fg={ink.muted}>No automatic fallback or replay</text></box></box></Show>
    </box>
    <Show when={connectionError() || error() || snapshot()?.error}><text fg={ink.amber}>{connectionError() || error() || snapshot()?.error}</text></Show>
    <box backgroundColor={ink.panel} padding={1} gap={1}>
      <textarea ref={value => { input = value; }} focused={!props.api.ui.dialog.open && !busy() && snapshot()?.connected} minHeight={1} maxHeight={5} width="100%" placeholder={busy() ? "Agent working. Esc requests cancellation." : "What are we building?"} textColor={ink.text} focusedTextColor={ink.text} backgroundColor={ink.panel} focusedBackgroundColor={ink.panel} cursorColor={ink.primary} keyBindings={[{ name: "return", action: "submit" }]} onSubmit={() => void submit()} />
      <box flexDirection="row" justifyContent="space-between"><text fg={ink.muted}>Enter send · Esc interrupt · /workbench</text><text fg={ink.primary} onMouseDown={() => busy() ? void cancel() : void submit()}>{busy() ? "Interrupt" : "Send"}</text></box>
    </box>
  </box>;
}
