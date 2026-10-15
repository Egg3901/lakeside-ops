//! The Keir 4.0 runner.
//!
//! Subscriptions only (owner, 2026-10-14): every model is a CLI that owns
//! its own loop. The harness owns everything else: the tools (served over a
//! per-attempt loopback MCP endpoint with an unguessable path), the prompt,
//! resource admission, the timeout, the trace and the structured result.
//!
//! - `backend`: what the tools do. `NodeProxy` forwards to the live Node
//!   operator's toolserver so ticket policy stays where it is today;
//!   `Workspace` serves read, search, shell, read-only MCP and `finish` for
//!   general Lakeside work under a capability grant.
//! - `loopback`: the MCP endpoint.
//! - `spawn`: the exact CLI invocations per provider, mirroring the Node
//!   operator's, with built-in tools off.
//! - `trace`: provider stream lines to normalized events.
//! - `admission`: memory floor and host worker slots shared with
//!   `/root/bin/provider-agent-run.sh`.
//! - `run`: one attempt end to end.

pub mod admission;
pub mod backend;
pub mod loopback;
pub mod run;
pub mod spawn;
pub mod trace;
