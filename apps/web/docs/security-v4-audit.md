# v4 browser injection audit

Reviewed production JavaScript for `innerHTML`, `eval`, and `new Function` on 2026-09-23.

## Changes made

- Command palette entries now use DOM nodes and `textContent`; navigation accepts only root-relative paths or HTTPS URLs.
- Sidebar labels and URLs are escaped, links are restricted to root-relative paths or HTTPS, and game accent colors accept only hex values.
- Agents, community voice, ideas, search, and status pages no longer fall back to raw `innerHTML` when the trusted HTML helper is unavailable.
- The shared DOM helper no longer offers an unused HTML attribute shortcut.

## Remaining review

`innerHTML` still appears in legacy page scripts, especially `code-page.js`, `server.js`, `docs-app/server.js`, `scheduler-page.js`, and `tmux-terminal-page.js`. Most sites build fixed markup or escape dynamic text, but this source scan alone does not prove every data path safe. Before a public generic release, migrate these scripts to the shared trusted HTML helper or DOM construction, with focused tests for data received over HTTP and WebSocket.

No production `eval()` or `new Function()` call was found in the JavaScript source scan. This review did not audit third-party dependencies or browser bundles.
