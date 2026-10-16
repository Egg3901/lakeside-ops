---
name: terminal-design
description: Design and implement usable terminal interfaces with adaptive layouts, purposeful branding, keyboard navigation and honest live state.
---

# Terminal Design

Inspect the terminal framework's public APIs before building a feature. Reuse working input, permission and process-control behavior. Avoid raw ANSI hacks that fight the renderer or terminal lifecycle.

Build for real constraints:
- Test a compact Windows terminal, an ordinary laptop window and a wide terminal. Resize while running. Keep the composer, active task and recovery controls reachable.
- Use a compact logo when space is tight, rather than removing the identity. Use the approved steel-blue/grey Lakeside visual language when working on Lakeside Code.
- Give the conversation the primary reading area. Show side panels only when their live information helps the task. Avoid permanent empty panels, generic disabled-service noise and duplicated metadata.
- Tie controls to actual actions: inspect a real diff, resume a real session, show actual connection failures or open a recorded command result. Clearly label sample data and keep preview separate from live state.
- Provide discoverable keyboard commands for mouse actions. Preserve existing drafts, scrolling, selection, copy/paste and Ctrl-C behavior. A custom prompt must forward the native session, visibility, disabled, ref and submit contract.
- Use symbols with text labels or fallback output. Check Unicode width, clipping, long paths and wrapped output. Do not rely on color alone.
- Keep transport, state and rendering in separate modules. Read failures are failures, not empty successful results. Never infer passing checks from an idle agent.

Validate the installed package in a real PTY, and native ConPTY on Windows when available. Inspect actual session output in addition to the welcome screen. Check cleanup after cancellation and failed startup. Screenshots should come from the rendered UI and accurately identify prototype or sample states.
