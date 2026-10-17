/** @jsxImportSource @opentui/solid */
import { For, Show } from "solid-js";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { ink, Rail } from "./brand";

type Studio = { state: string; detail?: string; origin?: string; checkedAt?: string; tickets?: any[] | null; kanban?: any; errors?: string[] };

// One line per row, cut to the panel width: wrapped rows left stale glyphs behind.
const fit = (text: string, width = 88) => text.length > width ? `${text.slice(0, width - 1)}…` : text;

function Lane(props: { title: string; items: any[]; color: any; onPick: (item: any) => void; width?: number }) {
  return <Show when={props.items.length > 0}>
    <box flexShrink={0}>
      <text height={1} flexShrink={0} fg={props.color}><b>{props.title}</b></text>
      <For each={props.items}>{item =>
        <box height={1} flexShrink={0} overflow="hidden"><text fg={ink.text} wrapMode="none" onMouseDown={() => props.onPick(item)}>{fit(`  #${item.id} ${item.title}${item.owner ? `  ${item.owner}` : ""}`, props.width)}</text></box>}
      </For>
    </box>
  </Show>;
}

/** Open tickets and the kanban queue from the Keir VPS. Clicking fills a prompt. */
export function StudioPanel(props: { studio: () => Studio | undefined; onPrompt: (text: string) => void; refresh: () => void; compact?: boolean }) {
  const s = () => props.studio();
  return <box gap={1} flexShrink={0}>
    <Rail title="Studio" right={s()?.state === "connected" ? `${s()?.origin} · click to work` : "/studio"} />
    <Show when={s()?.state === "connected"} fallback={<text fg={ink.muted} onMouseDown={props.refresh}>{s()?.detail || "Loading studio panels..."}</text>}>
      <Show when={(s()?.tickets || []).length > 0} fallback={<text fg={ink.muted}>{s()?.tickets ? "No open tickets." : "Tickets unavailable."}</text>}>
        <box flexShrink={0}>
          <text height={1} flexShrink={0} fg={ink.amber}><b>Open tickets</b></text>
          <For each={(s()?.tickets || []).slice(0, props.compact ? 4 : 8)}>{ticket =>
            <box height={1} flexShrink={0} overflow="hidden"><text fg={ink.text} wrapMode="none" onMouseDown={() => props.onPrompt(`Look at support ticket #${ticket.number} ("${ticket.title}") with vps_read support support_get. Summarize what the player reported, what is already known, and the next investigation step. Do not post to the player or change the ticket.`)}>
              {fit(`#${ticket.number} ${ticket.title}  ${ticket.category}`, props.compact ? 72 : 100)}
            </text></box>}
          </For>
        </box>
      </Show>
      <Show when={s()?.kanban} fallback={<text fg={ink.muted}>Kanban unavailable.</text>}>
        <Lane title={`Needs owner (${s()?.kanban?.counts?.needs_owner ?? 0})`} items={props.compact ? [] : s()?.kanban?.needsOwner || []} color={ink.red} onPick={item => props.onPrompt(`Read kanban item #${item.id} with vps_read ops-knowledge kanban_get and tell me the decision it needs, with options.`)} />
        <Lane title={`Now (${s()?.kanban?.counts?.now ?? 0})`} items={(s()?.kanban?.now || []).slice(0, props.compact ? 3 : 5)} color={ink.primary} onPick={item => props.onPrompt(`Read kanban item #${item.id} with vps_read ops-knowledge kanban_get and summarize its state and next move.`)} />
        <Lane title={`Next (${s()?.kanban?.counts?.next ?? 0})`} items={props.compact ? [] : s()?.kanban?.next || []} color={ink.blue} onPick={item => props.onPrompt(`Read kanban item #${item.id} with vps_read ops-knowledge kanban_get and propose how to start it.`)} />
      </Show>
      <Show when={(s()?.errors || []).length > 0}><text fg={ink.amber}>{(s()?.errors || []).join(" · ")}</text></Show>
    </Show>
  </box>;
}

export function showStudio(api: TuiPluginApi, props: { studio: () => Studio | undefined; onPrompt: (text: string) => void; refresh: () => void }) {
  api.ui.dialog.replace(() => <api.ui.Dialog size="xlarge" onClose={() => api.ui.dialog.clear()}>
    <box padding={2}><StudioPanel {...props} onPrompt={text => { api.ui.dialog.clear(); props.onPrompt(text); }} /></box>
  </api.ui.Dialog>);
}
