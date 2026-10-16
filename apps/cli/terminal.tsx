/** @jsxImportSource @opentui/solid */
import { createEffect, createSignal, For, Show } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import type { TuiPluginApi, TuiPromptRef } from "@opencode-ai/plugin/tui";
import { loadPeers, inspectPeer } from "./peers.mjs";
import { createPeerMonitor } from "./peer-monitor.mjs";
import { ink, Brand } from "./tui/brand";
import { PeerPanel, showHandoffs } from "./tui/agents";
import { SessionActions, showWorkbench } from "./tui/workbench";
import { NativeSession } from "./tui/native";
import { Preview } from "./tui/preview";
import path from "node:path";
export default {
  id: "lakeside.code.terminal",
  async tui(api: TuiPluginApi, options: { name?: string; backend?: string } | undefined) {
    const name = options?.name || "Lakeside Code";
    for (const id of ["internal:home-tips", "internal:sidebar-context", "internal:sidebar-lsp", "internal:sidebar-mcp", "internal:sidebar-footer"]) await api.plugins.deactivate(id);
    createEffect(() => {
      const route = api.route.current;
      const session = route.name === "session" ? api.state.session.get(route.params?.sessionID as string) : undefined;
      api.renderer.setTerminalTitle(session?.title ? `${name} | ${session.title.slice(0, 60)}` : name);
    });
    const [peers, setPeers] = createSignal<Awaited<ReturnType<typeof inspectPeer>>[]>([]);
    const [peerError, setPeerError] = createSignal("");
    let prompt: TuiPromptRef | undefined;
    let stopped = false, refreshing = false;
    const controller = new AbortController();
    const monitor = createPeerMonitor();
    async function refresh() {
      if (stopped || refreshing) return;
      refreshing = true;
      try { const configured = loadPeers(); setPeers(await monitor.refresh(configured, { signal: controller.signal })); setPeerError(""); }
      catch { setPeerError("Peer configuration could not be loaded. Local coding is available."); }
      finally { refreshing = false; }
    }
    void refresh();
    const poll = setInterval(refresh, 10000);
    api.lifecycle.onDispose(() => { stopped = true; clearInterval(poll); controller.abort(); });
    await api.theme.install(path.join(import.meta.dir, "midnight.json"));
    api.theme.set("midnight");
    api.route.register([{ name: "lakeside.preview", render: () => <Preview api={api} name={name} /> }, { name: "lakeside.native", render: () => <NativeSession api={api} name={name} /> }]);
    if (options?.backend && options.backend !== "api") createEffect(() => {
      if (api.route.current.name !== "lakeside.native") api.route.navigate("lakeside.native");
    });
    const fillPrompt = (text: string) => {
      api.ui.dialog.clear();
      if (prompt?.current.input.trim()) {
        api.ui.toast({ variant: "warning", message: "Send or clear your draft before choosing a workflow action." }); return;
      }
      queueMicrotask(() => { prompt?.set({ input: text, parts: [] }); prompt?.focus(); });
    };
    const shortcuts = [
      { label: "Inspect project", slash: "inspect-project", prompt: "Inspect this project, read its instructions and explain its architecture." },
      { label: "Review changes", slash: "review-changes", prompt: "Review the current diff for bugs and missing validation." },
    ];
    api.command?.register(() => [
      { title: "Load and manage projects", value: "lakeside.projects", category: "Lakeside Code", slash: { name: "projects" }, onSelect: () => fillPrompt("List registered and loaded local projects with project_list. Load only the projects needed for my task using project_load. Multiple projects can stay loaded; keep their instructions and working directories separate.") },
      { title: "Reconnect VPS and agents", value: "lakeside.reconnect", category: "Lakeside Code", slash: { name: "reconnect" }, onSelect: () => { void refresh(); } },
      { title: "Validate changes", value: "lakeside.validate-changes", category: "Lakeside Code", slash: { name: "validate-changes" }, onSelect: () => fillPrompt("Read project instructions and run the smallest relevant permitted checks for the current diff. Record exact outcomes and remaining validation gaps.") },
      ...shortcuts.map(action => ({ title: action.label, value: `lakeside.${action.slash}`, category: "Lakeside Code", slash: { name: action.slash }, onSelect: () => fillPrompt(action.prompt) })),
      { title: "Lakeside Code: live workbench", value: "lakeside.workbench", category: "Lakeside Code", slash: { name: "workbench" }, onSelect: () => showWorkbench(api) },
      { title: "Lakeside Code: connections", value: "lakeside.connections", category: "Lakeside Code", slash: { name: "connections" }, onSelect: () => showWorkbench(api, "connections") },
      { title: "Lakeside Code: visual preview", value: "lakeside.preview", category: "Lakeside Code", slash: { name: "preview" }, onSelect: () => { api.ui.dialog.clear(); api.route.navigate("lakeside.preview"); } },
      { title: "Lakeside Code: connected agents", value: "lakeside.agents", category: "Lakeside Code", slash: { name: "agents" }, onSelect: () => { api.ui.dialog.replace(() => <api.ui.Dialog size="large" onClose={() => api.ui.dialog.clear()}><box padding={2}><PeerPanel api={api} peers={peers} error={peerError} refresh={refresh} /></box></api.ui.Dialog>); } },
      { title: "Lakeside Code: delegated work", value: "lakeside.handoffs", category: "Lakeside Code", slash: { name: "handoffs" }, onSelect: () => showHandoffs(api) },
    ]);
    api.slots.register({ order: -100, slots: {
      home_logo() { const dimensions = useTerminalDimensions(); return <Brand name={name} compact={dimensions().height < 32} />; },
      session_prompt(_ctx, props) { return <box gap={1}><box flexDirection="row" justifyContent="space-between"><text fg={ink.primary}><b>▲ {name}</b></text><text fg={ink.muted} onMouseDown={() => showWorkbench(api)}>/workbench · changes, commands, connections</text></box><api.ui.Prompt sessionID={props.session_id} visible={props.visible} disabled={props.disabled} onSubmit={props.on_submit} ref={value => { prompt = value; props.ref?.(value); }} /></box>; },
      sidebar_title(_ctx, props) { return <box gap={1}><Brand name={name} compact /><text fg={ink.text}>{props.title}</text><text fg={ink.muted}>{path.basename(api.state.path.directory)}<span style={{ fg: ink.primary }}>{api.state.vcs?.branch ? `  ⎇ ${api.state.vcs.branch}` : ""}</span></text></box>; },
      sidebar_footer() { return <text fg={ink.dim}>Local coding · /workbench</text>; },
      home_prompt(_ctx, props) { return <api.ui.Prompt ref={value => { prompt = value; props.ref?.(value); }} placeholders={{ normal: ["What are we building?", "Inspect this project and find the next useful change", "Review my changes before I commit"] }} />; },
      home_bottom() {
        const dimensions = useTerminalDimensions();
        return <box width="100%" maxWidth={90} paddingTop={1}>
          <box flexDirection="row" gap={3}><text fg={ink.primary} onMouseDown={() => api.keymap.dispatchCommand("session.list")}>Resume session</text><text fg={ink.primary} onMouseDown={() => showWorkbench(api)}>Workbench</text><For each={shortcuts}>{action => <text fg={ink.primary} onMouseDown={() => fillPrompt(action.prompt)}>{action.label}</text>}</For></box>
          <Show when={dimensions().height >= 38 && (peers().length > 0 || peerError())}><box paddingTop={2}><PeerPanel api={api} peers={peers} error={peerError} refresh={refresh} /></box></Show>
        </box>;
      },
      home_footer() { return <box paddingLeft={2} paddingRight={2} paddingBottom={1} flexDirection="row" justifyContent="space-between"><text fg={ink.muted}>{path.basename(api.state.path.directory)}<span style={{ fg: ink.primary }}>{api.state.vcs?.branch ? `  ⎇ ${api.state.vcs.branch}` : ""}</span></text><Show when={peers().length > 0 || peerError()}><text fg={ink.primary} onMouseDown={() => api.command?.trigger("lakeside.agents")}>/agents</text></Show></box>; },
      sidebar_content() { return <box gap={2}><SessionActions api={api} fill={fillPrompt} /><Show when={peers().length > 0 || peerError()}><PeerPanel api={api} peers={peers} error={peerError} refresh={refresh} /></Show></box>; },
    } });
  },
};
