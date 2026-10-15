//! Automatic quality labels on the task, not on every answer. Closure stays
//! the owner's positive metric; recurrence and attribution are separate
//! fields. Labels carry the policy version and evaluation time and are
//! appended, never rewritten. Unknown observation coverage keeps a label
//! provisional: no new report under incomplete observation is weaker evidence.

use serde::{Deserialize, Serialize};

pub const POLICY_VERSION: &str = "2026-10-14.1";
pub const DAY_MS: i64 = 86_400_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Label {
    Open,
    ClosedObserving,
    ClosedNoRecurrence7d,
    ClosedNoRecurrence14d,
    Reopened,
    RecurrenceConfirmed,
    ClosedExternally,
    ExplanationOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LabelEvent {
    pub ticket: u32,
    pub label: Label,
    pub policy_version: String,
    pub evaluated_at: i64,
    pub window_end: Option<i64>,
    pub provisional: bool,
    pub evidence: Vec<String>,
    pub keir_attributed: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TicketFacts {
    pub ticket: u32,
    /// Canonical status: open, triaging, in_progress, blocked, parked, resolved, closed.
    pub status: String,
    pub closed_at: Option<i64>,
    /// A later status history entry reopened the ticket after `closed_at`.
    pub reopened_at: Option<i64>,
    /// Another ticket was linked as a duplicate or matched this defect after closure.
    pub recurrence_report_at: Option<i64>,
    /// Keir published a resolution receipt (not merely a status flip by someone else).
    pub keir_resolution_receipt: bool,
    /// Keir shipped code or a heal for it.
    pub keir_shipped_fix: bool,
    /// Closed by a staff member or an external channel deletion.
    pub closed_externally: bool,
    /// Ingestion covered the whole window since closure.
    pub observation_complete: Option<bool>,
}

pub fn label_ticket(f: &TicketFacts, now: i64) -> LabelEvent {
    let attributed = f.keir_resolution_receipt || f.keir_shipped_fix;
    let base = |label: Label, window_end: Option<i64>, provisional: bool, evidence: Vec<String>| LabelEvent { ticket: f.ticket, label, policy_version: POLICY_VERSION.into(), evaluated_at: now, window_end, provisional, evidence, keir_attributed: attributed };
    let closed = matches!(f.status.as_str(), "resolved" | "closed");
    if !closed || f.closed_at.is_none() {
        return base(Label::Open, None, true, vec![format!("status {}", f.status)]);
    }
    let closed_at = f.closed_at.unwrap_or(now);
    if let Some(r) = f.recurrence_report_at.filter(|r| *r > closed_at) {
        return base(Label::RecurrenceConfirmed, None, false, vec![format!("later matching report at {r}")]);
    }
    if let Some(r) = f.reopened_at.filter(|r| *r > closed_at) {
        return base(Label::Reopened, None, false, vec![format!("reopened at {r}")]);
    }
    if f.closed_externally && !attributed {
        return base(Label::ClosedExternally, Some(closed_at + 14 * DAY_MS), f.observation_complete != Some(true), vec!["closed by staff or channel deletion; no Keir receipt".into()]);
    }
    let age = now - closed_at;
    let coverage_unknown = f.observation_complete != Some(true);
    if age >= 14 * DAY_MS {
        base(Label::ClosedNoRecurrence14d, Some(closed_at + 14 * DAY_MS), coverage_unknown, vec![format!("{} days without recurrence", age / DAY_MS)])
    } else if age >= 7 * DAY_MS {
        base(Label::ClosedNoRecurrence7d, Some(closed_at + 14 * DAY_MS), coverage_unknown, vec![format!("{} days without recurrence", age / DAY_MS)])
    } else {
        base(Label::ClosedObserving, Some(closed_at + 7 * DAY_MS), true, vec![format!("closed {} hours ago; window open", age / 3_600_000)])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn facts(status: &str, closed_at: Option<i64>) -> TicketFacts { TicketFacts { ticket: 1, status: status.into(), closed_at, keir_resolution_receipt: true, ..Default::default() } }

    #[test]
    fn three_days_is_not_a_fourteen_day_success() {
        let l = label_ticket(&facts("resolved", Some(0)), 3 * DAY_MS);
        assert_eq!(l.label, Label::ClosedObserving); assert!(l.provisional);
        let l = label_ticket(&facts("resolved", Some(0)), 8 * DAY_MS);
        assert_eq!(l.label, Label::ClosedNoRecurrence7d); assert!(l.provisional, "coverage unknown stays provisional");
        let mut f = facts("resolved", Some(0)); f.observation_complete = Some(true);
        let l = label_ticket(&f, 15 * DAY_MS);
        assert_eq!(l.label, Label::ClosedNoRecurrence14d); assert!(!l.provisional); assert!(l.keir_attributed);
    }

    #[test]
    fn reopen_and_recurrence_beat_closure_and_external_close_is_not_keir_credit() {
        let mut f = facts("closed", Some(0)); f.reopened_at = Some(DAY_MS);
        assert_eq!(label_ticket(&f, 20 * DAY_MS).label, Label::Reopened);
        f.recurrence_report_at = Some(2 * DAY_MS);
        assert_eq!(label_ticket(&f, 20 * DAY_MS).label, Label::RecurrenceConfirmed);
        let f = TicketFacts { ticket: 2, status: "closed".into(), closed_at: Some(0), closed_externally: true, ..Default::default() };
        let l = label_ticket(&f, DAY_MS);
        assert_eq!(l.label, Label::ClosedExternally); assert!(!l.keir_attributed);
        assert_eq!(label_ticket(&facts("in_progress", None), DAY_MS).label, Label::Open);
    }
}
