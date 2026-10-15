# @egg3901/mcp-server

Streamable HTTP MCP server with bearer authorization, `/healthz`, loopback-only
`/metrics`, request counters, and consistent JSON-RPC errors.

Published to the GitHub Packages npm registry. To install, configure
`@egg3901:registry=https://npm.pkg.github.com` in your project's `.npmrc` and
authenticate with a GitHub token that has `read:packages`, then run
`npm install @egg3901/mcp-server`. The package follows this repository's
visibility until the planned public release.

```js
const { createServer } = require('@egg3901/mcp-server');

createServer({
  name: 'gamestate',
  port: 9730,
  auth: { tokenEnv: 'AHD_MCP_TOKEN' },
  buildServer: () => registerGameTools(), // fresh McpServer per request
});
```

For database-backed scoped tokens, pass `authorize: request => validateToken(request)`.
Return a truthy identity for an authorized request or `null` to deny it.
`buildServer(identity)` must return a fresh `McpServer` per request.
