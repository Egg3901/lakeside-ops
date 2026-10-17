/** @jsxImportSource @opentui/solid */
import { createSignal, For, Show } from "solid-js";
type Color = any;
const midnight = { primary: "#8BB4E0", blue: "#7894AF", amber: "#D8BA8E", text: "#DDE5EF", muted: "#8B9AA9", dim: "#607B96", bg: "#0E141C", panel: "#151F2B", green: "#A4C9AE", red: "#E5A2A5" };
const [palette, setPalette] = createSignal<Record<keyof typeof midnight, Color>>(midnight);
// Reactive: components read ink.* inside JSX, so a theme change repaints them.
export const ink = Object.fromEntries(Object.keys(midnight).map(key => [key, undefined])) as Record<keyof typeof midnight, Color>;
for (const key of Object.keys(midnight) as (keyof typeof midnight)[]) Object.defineProperty(ink, key, { get: () => palette()[key], enumerable: true });
/** Follow the active OpenCode theme. */
export function syncInk(theme: { primary: Color; secondary: Color; warning: Color; text: Color; textMuted: Color; border: Color; background: Color; backgroundPanel: Color; success: Color; error: Color }) {
  setPalette({ primary: theme.primary, blue: theme.secondary, amber: theme.warning, text: theme.text, muted: theme.textMuted, dim: theme.border,
    bg: theme.background, panel: theme.backgroundPanel, green: theme.success, red: theme.error });
}
const mark = [
  "              ▄▄                    ",
  "          ▄██████▄                  ",
  "      ▄████▀  ▀████▄     ▄▄         ",
  "  ▄████▀        ▀████▄██████▄       ",
  "▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
  "        ──────────────────          ",
];

export function Eyebrow(props: { children: any; color?: string }) {
  return <text fg={props.color || ink.muted}>{props.children}</text>;
}

export function Brand(props: { name: string; compact?: boolean }) {
  return <box alignItems="center" gap={1} flexShrink={0} height={props.compact ? 3 : mark.length + 2}>
    <Show when={!props.compact} fallback={<text height={1} flexShrink={0} fg={ink.primary}><b> ▲  ▰ </b><span style={{ fg: ink.dim }}>━━━━━━</span></text>}><box height={mark.length} flexShrink={0}><For each={mark}>{(line, i) => <text height={1} flexShrink={0} fg={i() < 5 ? ink.primary : ink.dim}>{line}</text>}</For></box></Show>
    <text fg={ink.text}><b>{props.name.toUpperCase().split("").join(" ")}</b></text>
  </box>;
}

export function Rail(props: { title: string; right?: string; color?: string }) {
  return <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
    <text fg={props.color || ink.primary}><b>{props.title}</b></text>
    <text fg={ink.muted}>{props.right || ""}</text>
  </box>;
}

