/** @jsxImportSource @opentui/solid */
import { createSignal, For, Show } from "solid-js";
import { useTerminalDimensions, useKeyboard } from "@opentui/solid";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { ink, Rail, Eyebrow } from "./brand";
import { AgentRow } from "./agents";
export function Preview(props: { api: TuiPluginApi; name: string }) {
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
      <text fg={ink.primary}><b>▲ {props.name}</b></text>
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

