/** @jsxImportSource @opentui/solid */
import { createSignal, For, Show } from "solid-js";
import { useTerminalDimensions, useKeyboard } from "@opentui/solid";
import type { TuiPluginApi, TuiPromptRef } from "@opencode-ai/plugin/tui";
import { loadPeers, inspectPeer, peerTask, listHandoffs, reconcileHandoff } from "./peers.mjs";
import path from "node:path";

const ink = { primary: "#8BB4E0", blue: "#7894AF", amber: "#D8BA8E", text: "#DDE5EF", muted: "#8B9AA9", dim: "#607B96", bg: "#0E141C", panel: "#151F2B", green: "#A4C9AE" };
const mark = [
  "              ▄▄                    ",
  "          ▄██████▄                  ",
  "      ▄████▀  ▀████▄     ▄▄         ",
  "  ▄████▀        ▀████▄██████▄       ",
  "▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
  "        ──────────────────          ",
];

function Eyebrow(props: { children: any; color?: string }) {
  return <text fg={props.color || ink.muted}>{props.children}</text>;
}

function Brand(props: { name: string; compact?: boolean }) {
  return <box alignItems="center" gap={1}>
    <Show when={!props.compact}><box><For each={mark}>{(line, i) => <text fg={i() < 5 ? ink.primary : ink.dim}>{line}</text>}</For></box></Show>
    <text fg={ink.text}><b>{props.name.toUpperCase().split("").join(" ")}</b></text>
  </box>;
}

function Rail(props: { title: string; right?: string; color?: string }) {
  return <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
    <text fg={props.color || ink.primary}><b>{props.title}</b></text>
    <text fg={ink.muted}>{props.right || ""}</text>
  </box>;
}

function AgentRow(props: { name: string; machine: string; state: string; detail?: string; color?: string; onSelect?: () => void }) {
  return <box paddingBottom={1} onMouseDown={props.onSelect}>
    <box flexDirection="row" justifyContent="space-between"><text fg={ink.text}><span style={{ fg: props.color || ink.primary }}>● </span><b>{props.name}</b></text><text fg={props.color || ink.primary}>{props.state}</text></box>
    <text fg={ink.muted}>{props.machine}</text>
    <Show when={props.detail}><text fg={ink.muted}>{props.detail}</text></Show>
  </box>;
}

function PeerPanel(props: { peers: () => any[]; error: () => string; api: TuiPluginApi }) {
  return <box gap={1}>
    <Rail title="Agents" />
    <Show when={props.error()}><text fg={ink.amber}>{props.error()}</text></Show>
    <Show when={!props.peers().length && !props.error()}><text fg={ink.muted}>No agents connected. Configure a peer to inspect or delegate work.</text></Show>
    <For each={props.peers()}>{peer => <AgentRow name={peer.name} machine={peer.kind === "keir" ? "Remote" : "OpenCode"} state={peer.state} detail={peer.state === "connected" ? `${peer.tasks.length} ${peer.tasks.length === 1 ? "task" : "tasks"} · inspect` : "Connection unavailable · inspect"} color={peer.state === "connected" ? ink.green : ink.amber} onSelect={() => showPeer(props.api, peer)} />}</For>
  </box>;
}

function showPeer(api: TuiPluginApi, peer: any) {
  if (peer.state !== "connected") { api.ui.toast({ variant: "warning", title: peer.name, message: peer.error || "Connection unavailable. Check the peer connection and credentials." }); return; }
  if (!peer.tasks.length) { api.ui.toast({ variant: "info", title: peer.name, message: "Connected. No tasks to inspect." }); return; }
  api.ui.dialog.replace(() => <api.ui.DialogSelect title={`${peer.name} · ${peer.state}`} options={peer.tasks.map((task: any) => ({ title: task.title || task.id, value: task.id, description: task.summary || task.state, footer: task.state }))} onSelect={async (row: any) => {
    try {
      const configured = loadPeers().find(item => item.id === peer.id);
      if (!configured) throw new Error("Peer is no longer configured");
      const result = await peerTask(configured, row.value, { signal: api.lifecycle.signal });
      api.ui.dialog.replace(() => <api.ui.Dialog size="large" onClose={() => api.ui.dialog.clear()}><box padding={2} gap={1}><Rail title={peer.name} right={result.state || "session"} /><scrollbox height={20}><text fg={ink.text}>{result.summary || result.messages?.flatMap((message: any) => message.info?.role === "assistant" ? (message.parts || []).filter((part: any) => part.type === "text").map((part: any) => part.text) : []).join("\n\n") || "No result yet."}</text></scrollbox></box></api.ui.Dialog>);
    } catch (error) { api.ui.toast({ variant: "error", message: error instanceof Error ? error.message : "Could not load peer task" }); }
  }} />);
}

function showHandoffs(api: TuiPluginApi) {
  const receipts = listHandoffs();
  if (!receipts.length) { api.ui.toast({ variant: "info", message: "No delegated work yet." }); return; }
  api.ui.dialog.replace(() => <api.ui.DialogSelect title="Delegated work" options={receipts.map(receipt => ({ title: receipt.spec.goal, value: receipt.id, description: `${receipt.peer} · ${receipt.spec.branch}`, footer: receipt.state }))} onSelect={async row => {
    try {
      const receipt = receipts.find(receipt => receipt.id === row.value);
      const peer = loadPeers().find(peer => peer.id === receipt.peer);
      if (!peer) throw new Error("The original peer is no longer configured");
      const current = await reconcileHandoff(peer, receipt.id, { signal: api.lifecycle.signal });
      const text = [current.spec.goal, `${current.spec.repository} · ${current.spec.branch}`, `Base: ${current.spec.base}`, `Status: ${current.remoteState || current.state}`, current.summary || current.error || (current.taskId ? `Remote task: ${current.taskId}` : "Dispatch is uncertain. Inspect the original peer before retrying.")].join("\n\n");
      api.ui.dialog.replace(() => <api.ui.Dialog size="large" onClose={() => api.ui.dialog.clear()}><box padding={2} gap={1}><Rail title={current.peer} right={current.state} /><scrollbox height={18}><text fg={ink.text}>{text}</text></scrollbox></box></api.ui.Dialog>);
    } catch (error) { api.ui.toast({ variant: "error", message: error instanceof Error ? error.message : "Could not refresh delegated work" }); }
  }} />);
}

function Preview(props: { api: TuiPluginApi; name: string }) {
  const dimensions = useTerminalDimensions();
  const wide = () => dimensions().width >= 110;
  const [scene, setScene] = createSignal("changes");
  useKeyboard(key => {
    const target = ({ "1": "changes", "2": "review", "3": "checks" } as Record<string, string>)[key.name];
    if (target) { key.preventDefault(); setScene(target); }
    if (key.name === "escape") { key.preventDefault(); props.api.route.navigate("home"); }
  });
  return <box width="100%" height="100%" backgroundColor={ink.bg} paddingLeft={3} paddingRight={3} paddingTop={1}>
    <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
      <text fg={ink.primary}><b>{props.name}</b></text>
      <text fg={ink.amber}>Preview · sample data</text>
    </box>
    <box flexDirection="row" gap={2} paddingBottom={1}>
      <text fg={ink.text}>example-app</text><text fg={ink.primary}>⎇ feat/instant-loading</text>
    </box>
    <box flexDirection="row" gap={3} flexGrow={1} minHeight={0}>
      <box flexGrow={1} minWidth={0}>
        <scrollbox flexGrow={1}>
          <box paddingTop={1} paddingBottom={2} gap={1}>
            <Eyebrow>You</Eyebrow>
            <text fg={ink.text}><b>Keep search results visible while the next request loads.</b></text>
          </box>
          <box paddingBottom={2} gap={1}>
            <Eyebrow color={ink.primary}>{props.name}</Eyebrow>
            <text fg={ink.text}>The previous results now stay visible during refresh. A request guard keeps a late response from replacing newer results.</text>
          </box>
          <box flexDirection="row" gap={3} paddingBottom={1}>
            <For each={["changes", "review", "checks"]}>{tab => <text fg={scene() === tab ? ink.primary : ink.muted} onMouseDown={() => setScene(tab)}><b>{scene() === tab ? "▰ " : "  "}{tab[0].toUpperCase() + tab.slice(1)}</b></text>}</For>
          </box>
          <Show when={scene() === "changes"}>
            <box backgroundColor={ink.panel} padding={1}>
              <Rail title="src/search/results.tsx" right="+4  -1" color={ink.text} />
              <text fg={ink.muted}>  42   async function refresh(query: string) {"{"}</text>
              <text fg="#E5A2A5" backgroundColor="#302126">- 43     setResults([])</text>
              <text fg={ink.green} backgroundColor="#162A27">+ 43     const request = ++latestRequest.current</text>
              <text fg={ink.green} backgroundColor="#162A27">+ 44     setRefreshing(true)</text>
              <text fg={ink.muted}>  45     const next = await search(query)</text>
              <text fg={ink.green} backgroundColor="#162A27">+ 46     if (request !== latestRequest.current) return</text>
              <text fg={ink.muted}>  47     setResults(next)</text>
              <text fg={ink.green} backgroundColor="#162A27">+ 48     setRefreshing(false)</text>
            </box>
            <box paddingTop={1}><text fg={ink.green}>✓ 16 focused checks passed<span style={{ fg: ink.muted }}> · full suite not run</span></text></box>
          </Show>
          <Show when={scene() === "review"}>
            <box gap={1} backgroundColor={ink.panel} padding={1}>
              <Rail title="Keir's review" right="a91c2e4" color={ink.text} />
              <text fg={ink.amber}>1 finding · resolved</text>
              <text fg={ink.text}><b>Late requests could replace newer results.</b></text>
              <text fg={ink.muted}>src/search/results.tsx:46</text>
              <text fg={ink.text}>The request identity check now guards both the result and loading updates. The regression check passes.</text>
            </box>
          </Show>
          <Show when={scene() === "checks"}>
            <box gap={1} backgroundColor={ink.panel} padding={1}>
              <Rail title="Focused checks" right="16 passed" color={ink.text} />
              <text fg={ink.muted}>npm test -- search/results.test.tsx</text>
              <text fg={ink.green}>✓ Search behavior        12 passed</text>
              <text fg={ink.green}>✓ Keyboard navigation     4 passed</text>
              <text fg={ink.muted}>Includes the stale-response regression.</text>
              <text fg={ink.amber}>Full suite not run.</text>
            </box>
          </Show>
          <Show when={!wide()}><box paddingTop={2}><text fg={ink.muted}>Keir · VPS · review returned for a91c2e4</text></box></Show>
        </scrollbox>
      </box>
      <Show when={wide()}>
        <box width={29} paddingLeft={2} paddingTop={1} flexShrink={0}>
          <Rail title="Delegated review" color={ink.muted} />
          <AgentRow name="Keir" machine="VPS · a91c2e4" state="returned" detail="1 finding resolved" color={ink.blue} onSelect={() => setScene("review")} />
        </box>
      </Show>
    </box>
    <box flexDirection="row" justifyContent="space-between" paddingTop={1} paddingBottom={1}>
      <text fg={ink.muted}>1 changes · 2 review · 3 checks</text><text fg={ink.primary} onMouseDown={() => props.api.route.navigate("home")}>esc close preview</text>
    </box>
  </box>;
}

export default {
  id: "lakeside.code.terminal",
  async tui(api: TuiPluginApi, options: any) {
    const name = options?.name || "Lakeside Code";
    const [peers, setPeers] = createSignal<any[]>([]);
    const [peerError, setPeerError] = createSignal("");
    let prompt: TuiPromptRef | undefined;
    let stopped = false, refreshing = false;
    const controller = new AbortController();
    async function refresh() {
      if (stopped || refreshing) return;
      refreshing = true;
      try { const configured = loadPeers(); setPeers(await Promise.all(configured.map(peer => inspectPeer(peer, { signal: controller.signal })))); setPeerError(""); }
      catch { setPeerError("Peer configuration could not be loaded. Local coding is available."); }
      finally { refreshing = false; }
    }
    void refresh();
    const poll = setInterval(refresh, 10000);
    api.lifecycle.onDispose(() => { stopped = true; clearInterval(poll); controller.abort(); });
    await api.theme.install(path.join(import.meta.dir, "midnight.json"));
    api.theme.set("midnight");
    api.route.register([{ name: "lakeside.preview", render: () => <Preview api={api} name={name} /> }]);
    const fillPrompt = (text: string) => {
      api.ui.dialog.clear();
      if (api.route.current.name !== "home") api.route.navigate("home");
      queueMicrotask(() => { prompt?.set({ input: text, parts: [] }); prompt?.focus(); });
    };
    const shortcuts = [
      { label: "Inspect project", slash: "inspect-project", prompt: "Inspect this project, read its instructions and explain its architecture." },
      { label: "Review changes", slash: "review-changes", prompt: "Review the current diff for bugs and missing validation." },
    ];
    api.command?.register(() => [
      ...shortcuts.map(action => ({ title: action.label, value: `lakeside.${action.slash}`, category: "Lakeside Code", slash: { name: action.slash }, onSelect: () => fillPrompt(action.prompt) })),
      { title: "Lakeside Code: visual preview", value: "lakeside.preview", category: "Lakeside Code", slash: { name: "preview" }, onSelect: () => { api.ui.dialog.clear(); api.route.navigate("lakeside.preview"); } },
      { title: "Lakeside Code: connected agents", value: "lakeside.agents", category: "Lakeside Code", slash: { name: "agents" }, onSelect: () => { api.ui.dialog.replace(() => <api.ui.Dialog size="large" onClose={() => api.ui.dialog.clear()}><box padding={2}><PeerPanel api={api} peers={peers} error={peerError} /></box></api.ui.Dialog>); } },
      { title: "Lakeside Code: delegated work", value: "lakeside.handoffs", category: "Lakeside Code", slash: { name: "handoffs" }, onSelect: () => showHandoffs(api) },
    ]);
    api.slots.register({ order: -100, slots: {
      home_logo() { const dimensions = useTerminalDimensions(); return <Brand name={name} compact={dimensions().height < 32} />; },
      home_prompt(_ctx, props) { return <api.ui.Prompt ref={value => { prompt = value; props.ref?.(value); }} placeholders={{ normal: ["What are we building?", "Inspect this project and find the next useful change", "Review my changes before I commit"] }} />; },
      home_bottom() {
        const dimensions = useTerminalDimensions();
        return <box width="100%" maxWidth={90} paddingTop={1}>
          <box flexDirection="row" gap={3}><For each={shortcuts}>{action => <text fg={ink.primary} onMouseDown={() => fillPrompt(action.prompt)}>{action.label}</text>}</For></box>
          <Show when={dimensions().height >= 38 && (peers().length > 0 || peerError())}><box paddingTop={2}><PeerPanel api={api} peers={peers} error={peerError} /></box></Show>
        </box>;
      },
      home_footer() { return <box paddingLeft={2} paddingRight={2} paddingBottom={1} flexDirection="row" justifyContent="space-between"><text fg={ink.muted}>{path.basename(api.state.path.directory)}<span style={{ fg: ink.primary }}>{api.state.vcs?.branch ? `  ⎇ ${api.state.vcs.branch}` : ""}</span></text><Show when={peers().length > 0 || peerError()}><text fg={ink.primary} onMouseDown={() => api.command?.trigger("lakeside.agents")}>/agents</text></Show></box>; },
      sidebar_content() { return <Show when={peers().length > 0 || peerError()}><PeerPanel api={api} peers={peers} error={peerError} /></Show>; },
    } });
  },
};
