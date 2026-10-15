//! Keir 4.0 shared harness core.
//!
//! Pure domain logic with no I/O: every fact arrives as a value and every
//! decision leaves as a value, so the whole crate is testable without a
//! database, a clock or a network. Phase 2 runs this in shadow against the
//! live Node operator's ledger and event sink and reports where the two
//! disagree. Later phases hand it the tool loop.
//!
//! Plan: ops-knowledge `keir-40-rust-harness-plan-2026-10-14` with the v2
//! audit and v3 transcript amendments. Owner rulings baked in: subscriptions
//! only, no simulation gate, routing seeded from owner directives, player
//! personal data never to a training-tier provider.

pub mod blast;
pub mod metrics;
pub mod outcome;
pub mod routing;
pub mod status;
pub mod tasks;

pub use blast::{classify, promotion_gate, BlastClass, GateVerdict};
pub use outcome::{label_ticket, Label, LabelEvent, POLICY_VERSION};
pub use routing::{resolve_route, Provider, Role, RouteError, RouteRequest};
pub use status::{derive_phase, outcome_claims, release_state, Phase, ReleaseFacts};
pub use tasks::{TaskGraph, TaskKind, TaskState};
