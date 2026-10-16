/** @jsxImportSource @opentui/solid */
import { createSignal, For, Show } from "solid-js";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { ink, Rail } from "./brand";

type View = "changes" | "commands" | "connections";

function sessionID(api: TuiPluginApi): string | undefined {
  const route = api.route.current;
  return route.name === "session" ? route.params?.sessionID as string : undefined;
}

function CommandHistory(props: { api: TuiPluginApi }) {
  const commands = () => {
    const id = sessionID(props.api);
    if (!id) return [];
    return props.api.state.session.messages(id).flatMap(message => props.api.state.part(message.id)).filter(part => part.type === "tool" && part.tool === "bash");
  };
  return <box gap={1}>
    <text fg={ink.muted}>Recorded shell operations in this session. A successful command does not establish that all checks passed.</text>
    <Show when={commands().length} fallback={<text fg={ink.muted}>No recorded commands in this session.</text>}>
      <For each={commands()}>{part => {
        if (part.type !== "tool") return null;
        return <box backgroundColor={ink.panel} padding={1}>
          <Rail title={String(part.state.input?.command || part.tool)} right={part.state.status} />
          <Show when={part.state.status === "completed"}><text fg={ink.text}>{part.state.status === "completed" ? part.state.output.slice(-12000) : ""}</text></Show>
          <Show when={part.state.status === "error"}><text fg={ink.amber}>{part.state.status === "error" ? part.state.error : ""}</text></Show>
        </box>;
      }}</For>
    </Show>
  </box>;
}

function Connections(props: { api: TuiPluginApi }) {
  return <box gap={1}>
    <Rail title="MCP connections" />
    <Show when={props.api.state.mcp().length} fallback={<text fg={ink.amber}>No MCP servers configured. Agent peers are separate from MCP tools.</text>}>
      <For each={props.api.state.mcp()}>{server => <box><text fg={server.status === "connected" ? ink.green : ink.amber}>{server.name} · {server.status}</text><Show when={server.error}><text fg={ink.muted}>{server.error}</text></Show></box>}</For>
    </Show>
    <text fg={ink.primary} onMouseDown={() => { props.api.ui.dialog.clear(); props.api.keymap.dispatchCommand("mcp.list"); }}>Manage configured MCPs</text>
    <text fg={ink.muted}>Add a server: lakeside code mcp add --id support --url HTTPS_URL --token-env VARIABLE</text>
    <text fg={ink.muted}>Enable work updates separately: lakeside code workflow enable github|kanban|tickets</text>
  </box>;
}

export function showWorkbench(api: TuiPluginApi, initial: View = "changes") {
  api.ui.dialog.replace(() => {
    const [view, setView] = createSignal<View>(initial);
    const dimensions = useTerminalDimensions();
    useKeyboard(key => {
      const target = ({ "1": "changes", "2": "commands", "3": "connections" } as Record<string, View>)[key.name];
      if (target) { key.preventDefault(); setView(target); }
    });
    const [files, setFiles] = createSignal<{ file: string; additions: number; deletions: number; patch?: string }[]>([]);
    const [error, setError] = createSignal("");
    const [loading, setLoading] = createSignal(true);
    void api.client.vcs.diff({ mode: "git" }).then(result => {
      if (result.error) throw new Error("Repository diff unavailable");
      setFiles(result.data || []);
    }).catch(() => setError("Could not read repository changes. Check that this directory is a Git repository.")).finally(() => setLoading(false));
    return <api.ui.Dialog size="xlarge" onClose={() => api.ui.dialog.clear()}><box padding={2} gap={1}>
      <Rail title="▲ Lakeside workbench" right={api.state.vcs?.branch || "workspace"} />
      <box flexDirection="row" gap={3}><For each={["changes", "commands", "connections"] as View[]}>{(tab, index) => <text fg={view() === tab ? ink.primary : ink.muted} onMouseDown={() => setView(tab)}><b>{index() + 1} {tab}</b></text>}</For></box>
      <scrollbox height={Math.max(6, Math.min(22, dimensions().height - 12))}>
        <Show when={view() === "changes"}>
          <text fg={ink.muted}>Current repository diff, including changes outside this session. Read only.</text>
          <Show when={loading()}><text fg={ink.muted}>Reading changes...</text></Show>
          <Show when={error()}><text fg={ink.amber}>{error()}</text></Show>
          <Show when={!loading() && !error() && !files().length}><text fg={ink.muted}>No changes in the current repository diff.</text></Show>
          <For each={files()}>{file => <box paddingTop={1}><Rail title={file.file} right={`+${file.additions}  -${file.deletions}`} /><text fg={ink.text}>{file.patch || "Patch unavailable"}</text></box>}</For>
        </Show>
        <Show when={view() === "commands"}><CommandHistory api={api} /></Show>
        <Show when={view() === "connections"}><Connections api={api} /></Show>
      </scrollbox>
    </box></api.ui.Dialog>;
  });
}

export function SessionActions(props: { api: TuiPluginApi; fill: (text: string) => void }) {
  return <box gap={1}>
    <Rail title="Workspace" />
    <text fg={ink.primary} onMouseDown={() => showWorkbench(props.api)}>Changes · live diff</text>
    <text fg={ink.primary} onMouseDown={() => showWorkbench(props.api, "commands")}>Commands · output</text>
    <text fg={ink.primary} onMouseDown={() => props.fill("Review the current repository diff for bugs. Read the project instructions, inspect actual changes, and give file references and missing validation.")}>Review changes</text>
    <text fg={ink.primary} onMouseDown={() => props.fill("Read project instructions and choose the smallest relevant validation for the current changes. Run permitted checks, record exact outcomes and failures, and do not claim broader coverage.")}>Validate changes</text>
    <text fg={ink.primary} onMouseDown={() => props.api.keymap.dispatchCommand("session.list")}>Resume session</text>
    <text fg={ink.primary} onMouseDown={() => showWorkbench(props.api, "connections")}>Connections · {props.api.state.mcp().filter(server => server.status === "connected").length}/{props.api.state.mcp().length} MCPs</text>
  </box>;
}
