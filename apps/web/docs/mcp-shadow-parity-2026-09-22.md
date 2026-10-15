# MCP shadow parity inventory

Checked against listeners and systemd on 2026-09-22.

| Service | Rust canonical | Node shadow | Listener result |
|---|---:|---:|---|
| Discord | 9727 | 19727 | Rust healthy; Node retired |
| Community | 9729 | 19729 | both healthy; comparison shadow retained |
| Gamestate | 9730 | 19730 | Rust healthy; no Node listener |
| Engine | 9731 | 19731 | Rust healthy; Node retired |
| World simulation | 9732 | 19732 | both healthy; Rust delegates to Node |
| Security | 9733 | 19733 | Rust healthy; Node retired |
| Railway | 9734 | 19734 | Rust healthy; Node retired |
| Support | 9735 | 19735 | both healthy |
| Turn diagnostics | 9736 | 19736 | Rust healthy; Node retired |
| Report publishing | 9738 | 19738 | both healthy; Rust delegates to Node |

The 97xx listeners are `/usr/local/bin/lakeside-mcp` under `lsr-mcp@*.service`.
The 197xx listeners are Node processes under the legacy `ahd-*-mcp.service`
units. Gamestate is already Rust-only even though the legacy unit still exists
in an inactive state.

## Retirement result

Listener health is not tool parity. Before disabling a Node unit, compare the
credentialed `tools/list` result and one read-only representative call on both
ports. Record missing tools, input-schema differences, auth behavior, timeout
behavior, and the exact rollback command. Disable one unit at a time and watch
the Rust service plus agent error logs for at least one normal operating cycle.

After parity and health checks, the redundant Discord, Engine, Security,
Railway, and Turn Diagnostics Node units were disabled and stopped. Their Rust
services remained healthy on the canonical ports. Community was also made
Rust-only at the service layer. World simulation, Support, and Report
Publishing remain deliberate Node dependencies because their Rust canonical
front doors still delegate work to those processes.

The disabled units remain installed as the rollback mechanism; none should be
re-enabled as an always-on standby. Rollback is an explicit operator action:
`systemctl enable --now <unit>` after confirming why the Rust service failed.
