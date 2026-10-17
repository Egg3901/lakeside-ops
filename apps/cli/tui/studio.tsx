/** @jsxImportSource @opentui/solid */
import { For, Show } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { ink, Rail } from "./brand";

type Studio = { state: string; detail?: string; origin?: string; checkedAt?: string; tickets?: any[] | null; kanban?: any; agents?: any[] | null; errors?: string[] };

// One line per row, cut to the panel width: wrapped rows left stale glyphs behind.
const fit = (text: string, width = 88) => text.length > width ? `${text.slice(0, width - 1)}…` : text;

function Lane(props: { title: string; items: any[]; color: any; onPick: (item: any) => void; width?: number }) {
  return <Show when={props.items.length > 0}>
    <box flexShrink={0}>
      <text height={1} flexShrink={0} fg={props.color}><b>{props.title}</b></text>
      <For each={props.items}>{item =>
        <box height={1} flexShrink={0} overflow="hidden"><text fg={ink.text} wrapMode="none" onMouseDown={() => props.onPick(item)}>{fit(`  #${item.id} ${item.title}${item.owner ? `  ${item.owner}` : ""}`, props.width || 88)}</text></box>}
      </For>
    </box>
  </Show>;
}

/** Open tickets and the kanban queue from the Keir VPS. Clicking fills a prompt. */
export function StudioPanel(props: { studio: () => Studio | undefined; onPrompt: (text: string) => void; refresh: () => void; compact?: boolean }) {
  const s = () => props.studio();
  const dims = useTerminalDimensions();
  // Fit rows to the space actually available; long rows were clipped at the edge.
  const width = () => Math.max(40, Math.min(dims().width - (props.compact ? 34 : 16), 120));
  const cap = (n: number) => props.compact ? Math.min(n, 3) : dims().height >= 50 ? n : Math.max(2, n - 2);
  return <box gap={1} flexShrink={0}>
    <Rail title="Studio" right={s()?.state === "connected" ? "click a row to work on it" : "/studio"} />
    <Show when={s()?.state === "connected"} fallback={<text fg={ink.muted} onMouseDown={props.refresh}>{s()?.detail || "Loading studio panels..."}</text>}>
      <Show when={(s()?.tickets || []).length > 0} fallback={<text fg={ink.muted}>{s()?.tickets ? "No open tickets." : "Tickets unavailable."}</text>}>
        <box flexShrink={0}>
          <text height={1} flexShrink={0} fg={ink.amber}><b>Open tickets</b></text>
          <For each={(s()?.tickets || []).slice(0, cap(6))}>{ticket =>
            <box height={1} flexShrink={0} overflow="hidden"><text fg={ink.text} wrapMode="none" onMouseDown={() => props.onPrompt(`Look at support ticket #${ticket.number} ("${ticket.title}") with vps_read support support_get. Summarize what the player reported, what is already known, and the next investigation step. Do not post to the player or change the ticket.`)}>
              {fit(`#${ticket.number} ${ticket.title}  ${ticket.category}`, width())}
            </text></box>}
          </For>
        </box>
      </Show>
      <Show when={s()?.kanban} fallback={<text fg={ink.muted}>Kanban unavailable.</text>}>
        <Lane title={`Needs owner (${s()?.kanban?.counts?.needs_owner ?? 0})`} items={props.compact ? [] : (s()?.kanban?.needsOwner || []).slice(0, cap(4))} width={width()} color={ink.red} onPick={item => props.onPrompt(`Read kanban item #${item.id} with vps_read ops-knowledge kanban_get and tell me the decision it needs, with options.`)} />
        <Lane title={`Now (${s()?.kanban?.counts?.now ?? 0})`} items={(s()?.kanban?.now || []).slice(0, cap(4))} width={width()} color={ink.primary} onPick={item => props.onPrompt(`Read kanban item #${item.id} with vps_read ops-knowledge kanban_get and summarize its state and next move.`)} />
        <Lane title={`Next (${s()?.kanban?.counts?.next ?? 0})`} items={props.compact ? [] : (s()?.kanban?.next || []).slice(0, cap(3))} width={width()} color={ink.blue} onPick={item => props.onPrompt(`Read kanban item #${item.id} with vps_read ops-knowledge kanban_get and propose how to start it.`)} />
      </Show>
      <Show when={!props.compact && (s()?.agents || []).length > 0}>
        <box flexShrink={0}>
          <text height={1} flexShrink={0} fg={ink.green}><b>Agents on the VPS</b></text>
          <For each={(s()?.agents || []).slice(0, cap(6))}>{agent =>
            <box height={1} flexShrink={0} overflow="hidden"><text fg={agent.attention ? ink.amber : ink.text} wrapMode="none" onMouseDown={() => props.onPrompt(`Check Paseo agent ${agent.id} ("${agent.title}") with vps_read paseo get_agent_status and get_agent_activity. Summarize what it is doing, whether it needs me, and what to do next. Do not send it prompts.`)}>
              {fit(`  ${agent.status === "running" ? "▶" : agent.attention ? "!" : "·"} ${agent.title}  ${agent.provider}${agent.model ? `/${agent.model}` : ""}${agent.attention ? `  ${agent.attention}` : ""}`, width())}
            </text></box>}
          </For>
        </box>
      </Show>
      <Show when={(s()?.errors || []).length > 0}><text fg={ink.amber}>{(s()?.errors || []).join(" · ")}</text></Show>
    </Show>
  </box>;
}

export function showStudio(api: TuiPluginApi, props: { studio: () => Studio | undefined; onPrompt: (text: string) => void; refresh: () => void }) {
  api.ui.dialog.replace(() => <api.ui.Dialog size="large" onClose={() => api.ui.dialog.clear()}>
    <box paddingLeft={2} paddingRight={2} paddingBottom={1}><StudioPanel {...props} onPrompt={text => { api.ui.dialog.clear(); props.onPrompt(text); }} /></box>
  </api.ui.Dialog>);
}
