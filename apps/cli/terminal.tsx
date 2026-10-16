/** @jsxImportSource @opentui/solid */
import { createSignal, For, Show } from "solid-js";
import { useTerminalDimensions, useKeyboard } from "@opentui/solid";
import type { TuiPluginApi, TuiPromptRef } from "@opencode-ai/plugin/tui";
import { loadPeers, inspectPeer, peerTask } from "./peers.mjs";
import path from "node:path";

const ink = { cyan: "#77E5D2", blue: "#83A7F6", amber: "#E5BA7C", text: "#DDE7ED", muted: "#8595A4", dim: "#435565", bg: "#0C1219", panel: "#111C26", line: "#233443", green: "#A7D9AC" };
const mark = [
  "              ▄▄                    ",
  "          ▄██████▄                  ",
  "      ▄████▀  ▀████▄     ▄▄         ",
  "  ▄████▀        ▀████▄██████▄       ",
  "▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
  "  ░░░░░░▒▒▒▒▒▒▒▒▓▓▓▓▓▓▒▒▒▒░░░░░░  ",
];

function Eyebrow(props: { children: any; color?: string }) {
  return <text fg={props.color || ink.muted}>{props.children}</text>;
}

function Brand(props: { name: string; compact?: boolean }) {
  return <box alignItems="center" gap={1}>
    <Show when={!props.compact}><box><For each={mark}>{(line, i) => <text fg={i() < 5 ? ink.cyan : ink.dim}>{line}</text>}</For></box></Show>
    <text fg={ink.text}><b>{props.name.toUpperCase().split("").join(" ")}</b></text>
    <Show when={!props.compact}><text fg={ink.muted}>Your code. Your machines. One place to build.</text></Show>
  </box>;
}

function Rail(props: { title: string; right?: string; color?: string }) {
  return <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
    <text fg={props.color || ink.cyan}><b>{props.title}</b></text>
    <text fg={ink.muted}>{props.right || ""}</text>
  </box>;
}

function AgentRow(props: { name: string; machine: string; state: string; detail?: string; color?: string; onSelect?: () => void }) {
  return <box paddingBottom={1} onMouseDown={props.onSelect}>
    <box flexDirection="row" justifyContent="space-between"><text fg={ink.text}><span style={{ fg: props.color || ink.cyan }}>● </span><b>{props.name}</b></text><text fg={props.color || ink.cyan}>{props.state}</text></box>
    <text fg={ink.muted}>{props.machine}</text>
    <Show when={props.detail}><text fg={ink.muted}>{props.detail}</text></Show>
  </box>;
}

function PeerPanel(props: { peers: () => any[]; error: () => string; api: TuiPluginApi; session?: string }) {
  const local = () => props.session ? props.api.state.session.status(props.session)?.type || "idle" : "ready";
  return <box gap={1}>
    <Rail title="AGENT NETWORK" />
    <AgentRow name="Lakeside Code" machine="This machine · current workspace" state={local()} />
    <Show when={props.error()}><text fg={ink.amber}>{props.error()}</text></Show>
    <Show when={!props.peers().length && !props.error()}><text fg={ink.muted}>No peers configured. Local coding is ready.</text></Show>
    <For each={props.peers()}>{peer => <AgentRow name={peer.name} machine={`${peer.kind} · configured peer`} state={peer.state} detail={peer.state === "connected" ? `${peer.tasks.length} visible tasks · click to inspect` : "Unavailable · local work continues"} color={peer.state === "connected" ? ink.green : ink.amber} onSelect={() => showPeer(props.api, peer)} />}</For>
  </box>;
}

function showPeer(api: TuiPluginApi, peer: any) {
  api.ui.dialog.replace(() => <api.ui.DialogSelect title={`${peer.name} · ${peer.state}`} options={peer.tasks.map((task: any) => ({ title: task.title || task.id, value: task.id, description: task.summary || task.state, footer: task.state }))} onSelect={async (row: any) => {
    try {
      const configured = loadPeers().find(item => item.id === peer.id);
      if (!configured) throw new Error("Peer is no longer configured");
      const result = await peerTask(configured, row.value, { signal: api.lifecycle.signal });
      api.ui.dialog.replace(() => <api.ui.Dialog size="large" onClose={() => api.ui.dialog.clear()}><box padding={2} gap={1}><Rail title={peer.name} right={result.state || "session"} /><scrollbox height={20}><text fg={ink.text}>{result.summary || JSON.stringify(result, null, 2)}</text></scrollbox></box></api.ui.Dialog>);
    } catch (error) { api.ui.toast({ variant: "error", message: error instanceof Error ? error.message : "Could not load peer task" }); }
  }} />);
}

function Preview(props: { api: TuiPluginApi; name: string }) {
  const dimensions = useTerminalDimensions();
  const wide = () => dimensions().width >= 110;
  const [scene, setScene] = createSignal("build");
  useKeyboard(key => {
    const target = ({ "1": "build", "2": "review", "3": "checks" } as Record<string, string>)[key.name];
    if (target) { key.preventDefault(); setScene(target); }
    if (key.name === "escape") { key.preventDefault(); props.api.route.navigate("home"); }
  });
  const select = (value: string) => setScene(value);
  const title = () => scene() === "review" ? "A second pair of eyes, one workspace." : scene() === "checks" ? "Every check has a result." : "Make the loading state feel instant.";
  return <box width="100%" height="100%" backgroundColor={ink.bg} paddingLeft={3} paddingRight={3} paddingTop={1}>
    <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
      <text fg={ink.cyan}><b>◈  {props.name.toUpperCase()}</b><span style={{ fg: ink.muted }}>  /  workspace</span></text>
      <text fg={ink.amber}>DESIGN PREVIEW · simulated activity</text>
    </box>
    <box flexDirection="row" gap={2} paddingBottom={1}>
      <text fg={ink.text}>example-app</text><text fg={ink.dim}>/</text><text fg={ink.cyan}>feat/instant-loading</text><text fg={ink.muted}>  local workspace</text>
    </box>
    <box flexDirection="row" gap={3} flexGrow={1} minHeight={0}>
      <box flexGrow={1} minWidth={0}>
        <box flexDirection="row" gap={3} paddingBottom={1}>
          <For each={["build", "review", "checks"]}>{tab => <text fg={scene() === tab ? ink.cyan : ink.muted} onMouseDown={() => select(tab)}><b>{scene() === tab ? "▰ " : "  "}{tab.toUpperCase()}</b></text>}</For>
        </box>
        <scrollbox flexGrow={1}>
          <box paddingTop={1} paddingBottom={1}><Eyebrow>YOU</Eyebrow><text fg={ink.text}><b>{title()}</b></text></box>
          <box paddingTop={1} gap={1}>
            <Eyebrow color={ink.cyan}>LAKESIDE CODE</Eyebrow>
            <text fg={ink.text}>{scene() === "review" ? "The remote review caught a stale request overwriting fresh results. Here is the fix, against the exact commit it reviewed." : scene() === "checks" ? "The focused checks are complete. The changed behavior is verified; the full suite has not run." : "I’ll preserve the existing results while the next request loads, then check keyboard navigation and the empty state."}</text>
          </box>
          <box paddingTop={2} paddingBottom={1}>
            <Rail title="↳  Inspect" right="2 files read" />
            <text fg={ink.muted}>src/search/results.tsx   src/search/results.test.tsx</text>
          </box>
          <box backgroundColor={ink.panel} padding={1}>
            <Rail title="src/search/results.tsx" right="+6  -2" color={ink.text} />
            <text fg={ink.dim}>  42   async function refresh(query: string) {"{"}</text>
            <text fg="#E5A2A5" backgroundColor="#302126">- 43     setResults([])</text>
            <text fg={ink.green} backgroundColor="#162A27">+ 43     const request = ++latestRequest.current</text>
            <text fg={ink.green} backgroundColor="#162A27">+ 44     setRefreshing(true)</text>
            <text fg={ink.dim}>  45     const next = await search(query)</text>
            <text fg={ink.green} backgroundColor="#162A27">+ 46     if (request !== latestRequest.current) return</text>
            <text fg={ink.dim}>  47     setResults(next)</text>
            <text fg={ink.green} backgroundColor="#162A27">+ 48     setRefreshing(false)</text>
          </box>
          <box paddingTop={1} gap={1}>
            <text fg={ink.green}>✓  Search behavior       12 passed</text>
            <text fg={ink.green}>✓  Keyboard navigation    4 passed</text>
            <text fg={ink.amber}>○  Full test suite        not run</text>
          </box>
          <Show when={scene() === "review"}><box paddingTop={1}><text fg={ink.blue}>↗  VPS reviewer returned 1 finding against a91c2e4</text><text fg={ink.muted}>Request identity must guard both result and loading updates.</text></box></Show>
        </scrollbox>
        <box backgroundColor={ink.panel} padding={1} marginTop={1}>
          <text fg={ink.text}><span style={{ fg: ink.cyan }}>❯ </span>Describe what you want to build…</text>
          <box flexDirection="row" justifyContent="space-between" paddingTop={1}><text fg={ink.muted}>Preview · no model calls or project edits</text><text fg={ink.cyan} onMouseDown={() => props.api.route.navigate("home")}>Open workspace ↗</text></box>
        </box>
      </box>
      <Show when={wide()}>
        <box width={33} backgroundColor={ink.panel} padding={2} flexShrink={0} gap={1}>
          <Rail title="IN THE LOOP" right="DEMO" />
          <AgentRow name="Lakeside Code" machine="PC · example-app" state={scene() === "checks" ? "verified" : "editing"} detail="Implementing the loading behavior" />
          <AgentRow name="Keir" machine="VPS · separate worktree" state={scene() === "review" ? "returned" : "reviewing"} detail="Reviewing commit a91c2e4" color={ink.blue} />
          <AgentRow name="Local reviewer" machine="PC · separate session" state="idle" detail="No task assigned" color={ink.muted} />
          <box paddingTop={1}><Rail title="CHANGESET" /><text fg={ink.text}>2 files changed</text><text fg={ink.green}>+24 additions <span style={{ fg: "#E5A2A5" }}> -8 deletions</span></text></box>
          <box paddingTop={1}><Rail title="NEXT MOVE" color={ink.amber} /><text fg={ink.text}>Inspect the diff.</text><text fg={ink.muted}>Commit after review.</text><text fg={ink.muted}>Publishing has not started.</text></box>
          <box flexGrow={1} /><text fg={ink.dim}>All activity on this screen is a design fixture.</text>
        </box>
      </Show>
    </box>
    <box flexDirection="row" justifyContent="space-between" paddingTop={1} paddingBottom={1}>
      <text fg={ink.muted}>1 build · 2 review · 3 checks · esc workspace</text><text fg={ink.cyan} onMouseDown={() => props.api.route.navigate("home")}>Back to coding</text>
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
    api.command?.register(() => [
      { title: "Lakeside Code: visual preview", value: "lakeside.preview", category: "Lakeside Code", slash: { name: "preview" }, onSelect: () => { api.ui.dialog.clear(); api.route.navigate("lakeside.preview"); } },
      { title: "Lakeside Code: connected agents", value: "lakeside.agents", category: "Lakeside Code", slash: { name: "agents" }, onSelect: () => { api.ui.dialog.replace(() => <api.ui.Dialog size="large" onClose={() => api.ui.dialog.clear()}><box padding={2}><PeerPanel api={api} peers={peers} error={peerError} /></box></api.ui.Dialog>); } },
    ]);
    api.slots.register({ order: -100, slots: {
      home_logo() { const dimensions = useTerminalDimensions(); return <Brand name={name} compact={dimensions().height < 32} />; },
      home_prompt(_ctx, props) { return <api.ui.Prompt ref={value => { prompt = value; props.ref?.(value); }} right={<text fg={ink.cyan}>LOCAL FIRST</text>} placeholders={{ normal: ["What are we building?", "Inspect this project and find the next useful change", "Review my changes before I commit"] }} />; },
      home_bottom() {
        const actions = [{ label: "01  EXPLORE", prompt: "Inspect this project, read its instructions and explain its architecture." }, { label: "02  BUILD", prompt: "Help me implement " }, { label: "03  REVIEW", prompt: "Review the current diff for bugs and missing validation." }];
        const dimensions = useTerminalDimensions();
        return <box width="100%" maxWidth={90} paddingTop={1} gap={1}>
          <box flexDirection="row" justifyContent="space-between"><For each={actions}>{action => <text fg={ink.muted} onMouseDown={() => { prompt?.set({ input: action.prompt, parts: [] }); prompt?.focus(); }}>{action.label}</text>}</For></box>
          <Show when={dimensions().height >= 38}><box paddingTop={2}><PeerPanel api={api} peers={peers} error={peerError} /></box></Show>
        </box>;
      },
      home_footer() { return <box paddingLeft={2} paddingRight={2} paddingBottom={1} flexDirection="row" justifyContent="space-between"><text fg={ink.muted}>{path.basename(api.state.path.directory)}<span style={{ fg: ink.cyan }}>{api.state.vcs?.branch ? `  ⎇ ${api.state.vcs.branch}` : ""}</span></text><text fg={ink.muted}>/agents  ·  /preview  ·  OpenCode {api.app.version}</text></box>; },
      sidebar_title(_ctx, props) { return <box gap={1}><text fg={ink.cyan}><b>◈  {name.toUpperCase()}</b></text><text fg={ink.text}>{props.title}</text></box>; },
      sidebar_content(_ctx, props) { return <PeerPanel api={api} peers={peers} error={peerError} session={props.session_id} />; },
      session_prompt_right() { return <text fg={ink.cyan}>LOCAL FIRST</text>; },
    } });
  },
};
