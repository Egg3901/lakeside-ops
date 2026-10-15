//! Completion-time and friction metrics from durable events. Raw
//! observations stay beside aggregates; open tickets are censored, not zero.
//! Small cohorts report counts, never a bare percentage.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TicketTimeline {
    pub ticket: u32,
    pub intake_at: i64,
    /// First delivered finding, question or next step; never the automatic ack.
    pub first_useful_at: Option<i64>,
    pub closed_at: Option<i64>,
    pub decision_requests: Vec<(i64, Option<i64>)>,
    /// Keir posts while a decision was pending and after the first notice.
    pub blocked_reposts: u32,
    pub longest_keir_run: u32,
    pub public_corrections: u32,
    pub leaks_refused: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Summary {
    pub count: usize,
    pub median_ms: Option<i64>,
    pub p90_ms: Option<i64>,
    pub max_ms: Option<i64>,
}

pub fn summarize(mut values: Vec<i64>) -> Summary {
    if values.is_empty() { return Summary::default(); }
    values.sort_unstable();
    let pick = |q: f64| values[((values.len() as f64 - 1.0) * q).round() as usize];
    Summary { count: values.len(), median_ms: Some(pick(0.5)), p90_ms: Some(pick(0.9)), max_ms: values.last().copied() }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Cohort {
    pub tickets: usize,
    pub closed: usize,
    pub open_censored: usize,
    pub first_useful_response: Summary,
    pub time_to_closure: Summary,
    pub decision_latency: Summary,
    pub decisions_unanswered: usize,
    pub blocked_reposts: u32,
    pub longest_keir_run: u32,
    pub public_corrections: u32,
    pub leaks_refused: u32,
    pub oldest_open_age_ms: Option<i64>,
}

pub fn cohort(timelines: &[TicketTimeline], now: i64) -> Cohort {
    let mut c = Cohort { tickets: timelines.len(), ..Default::default() };
    let mut first = Vec::new();
    let mut closure = Vec::new();
    let mut decision = Vec::new();
    for t in timelines {
        if let Some(f) = t.first_useful_at { first.push(f - t.intake_at); }
        match t.closed_at {
            Some(c_at) => { c.closed += 1; closure.push(c_at - t.intake_at); }
            None => { c.open_censored += 1; c.oldest_open_age_ms = Some(c.oldest_open_age_ms.unwrap_or(0).max(now - t.intake_at)); }
        }
        for (asked, answered) in &t.decision_requests {
            match answered { Some(a) => decision.push(a - asked), None => c.decisions_unanswered += 1 }
        }
        c.blocked_reposts += t.blocked_reposts;
        c.longest_keir_run = c.longest_keir_run.max(t.longest_keir_run);
        c.public_corrections += t.public_corrections;
        c.leaks_refused += t.leaks_refused;
    }
    c.first_useful_response = summarize(first);
    c.time_to_closure = summarize(closure);
    c.decision_latency = summarize(decision);
    c
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn open_tickets_are_censored_not_zero() {
        let t = vec![
            TicketTimeline { ticket: 1, intake_at: 0, first_useful_at: Some(60_000), closed_at: Some(3_600_000), ..Default::default() },
            TicketTimeline { ticket: 2, intake_at: 0, first_useful_at: None, closed_at: None, decision_requests: vec![(10, None)], ..Default::default() },
        ];
        let c = cohort(&t, 7_200_000);
        assert_eq!(c.closed, 1); assert_eq!(c.open_censored, 1);
        assert_eq!(c.time_to_closure.count, 1); assert_eq!(c.time_to_closure.median_ms, Some(3_600_000));
        assert_eq!(c.oldest_open_age_ms, Some(7_200_000)); assert_eq!(c.decisions_unanswered, 1);
        assert_eq!(summarize(vec![5, 1, 3]).median_ms, Some(3));
    }
}
