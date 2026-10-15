//! Persistence and adapters for the shadow and later the runtime.
//!
//! - `ledger`: a read-only projection of the Node operator's `ledger.json`.
//! - `events`: the Node event sink (`events.db`), read-only.
//! - `db`: the harness's own SQLite (`harness.db`): shadow runs, labels,
//!   decision comparisons. One writer.
//! - `project`: ledger snapshot to task graph and work records.
//! - `mcp`: a minimal JSON-RPC client for the local MCP servers, read token only.

pub mod attempts;
pub mod db;
pub mod events;
pub mod ledger;
pub mod mcp;
pub mod project;
