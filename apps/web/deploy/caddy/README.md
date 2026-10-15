# Public ticket receipt route

The current v4 Ops service does not serve the player capability path `/t/<token>`.
The v3.16 receipt service on loopback port 9759 does. Keep the public receipt
path routed there until v4 implements the same capability handler.

Import `ops-public-ticket-receipts.caddy` inside the public Ops site block,
before its `route /*` catch-all. The production Caddyfile contains credentials
and stays outside this repository. When deploying this snippet, validate the
complete Caddyfile and reload Caddy, then check that a known receipt returns
HTTP 200 through `https://ops.lakesidegames.net/t/<token>` and that an invalid
token returns HTTP 404.
