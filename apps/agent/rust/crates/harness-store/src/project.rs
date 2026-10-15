//! Ledger snapshot to task graph and work records. Same identities as
//! `workrecord.js`: `ticket:N` for anything on a ticket, `request:<root>`
//! for owner and developer requests, coding children under their parent.

use crate::ledger::{Job, Snapshot};
use harness_core::status::ReleaseFacts;
use harness_core::tasks::{AttemptState, TaskGraph, TaskKind};
use std::collections::BTreeMap;

pub fn root_job<'a>(job: &'a Job, jobs: &'a BTreeMap<String, Job>) -> &'a Job {
    let mut cur = job;
    let mut seen = std::collections::HashSet::new();
    while let Some(p) = cur.coding_parent.as_deref() {
        if !seen.insert(cur.id.clone()) { break; }
        match jobs.get(p) { Some(j) => cur = j, None => break }
    }
    cur
}

pub fn work_id(job: &Job, jobs: &BTreeMap<String, Job>) -> String {
    let root = root_job(job, jobs);
    match job.ticket.or(root.ticket) { Some(t) => format!("ticket:{t}"), None => format!("request:{}", root.id) }
}

fn attempt_state(s: &str) -> AttemptState {
    match s { "running" => AttemptState::Running, "queued" => AttemptState::Queued, "waiting" | "deferred" => AttemptState::Waiting, "blocked" => AttemptState::Blocked, "done" => AttemptState::Done, "cancelled" => AttemptState::Cancelled, "dismissed" => AttemptState::Dismissed, _ => AttemptState::Queued }
}

fn kind_of(s: &str) -> TaskKind {
    match s { "ticket" => TaskKind::Ticket, "coding" => TaskKind::Coding, "conversation" => TaskKind::Conversation, "probe" => TaskKind::Probe, "notice" => TaskKind::Notice, "candidate" => TaskKind::Candidate, _ => TaskKind::Request }
}

pub fn graph_of(snapshot: &Snapshot) -> TaskGraph {
    let mut g = TaskGraph::default();
    for job in snapshot.jobs.values() {
        let wid = work_id(job, &snapshot.jobs);
        let root = root_job(job, &snapshot.jobs);
        let t = g.add_task(wid.clone(), if wid.starts_with("ticket:") { TaskKind::Ticket } else { kind_of(&root.kind) }, job.at.min(root.at));
        t.ticket = job.ticket.or(root.ticket);
        t.project = Some("a-house-divided".into());
        if t.created_at == 0 || job.at < t.created_at { t.created_at = job.at; }
        t.updated_at = t.updated_at.max(job.updated_at);
        let a = g.add_attempt(&wid, job.id.clone(), attempt_state(&job.state), job.started_at).expect("task exists");
        a.provider = job.provider.clone(); a.model = job.model.clone();
        a.effects_in_flight = job.effects_started;
        if job.kind == "coding" { a.provider.get_or_insert_with(|| "muse".into()); }
    }
    g
}

/// Release facts for a ticket across every job that worked it. Conservative:
/// `live_verified` needs the turn worker when the ticket shipped a fix, so a
/// web-only fix on main reads as `deployed-web`, never `live` here. The shadow
/// reports where Node claimed more than these facts support.
pub fn ticket_facts(snapshot: &Snapshot, ticket: u32) -> ReleaseFacts {
    let jobs: Vec<&Job> = snapshot.jobs.values().filter(|j| j.ticket == Some(ticket)).collect();
    let prs = jobs.iter().any(|j| !j.pull_requests.is_empty());
    let merged = jobs.iter().any(|j| j.merged);
    let rel = |f: fn(&crate::ledger::ReleaseEvidence) -> bool| jobs.iter().any(|j| j.release.iter().any(f));
    let dev = merged || rel(|r| r.development);
    let staging = rel(|r| r.staging);
    let main = rel(|r| r.main);
    let worker = rel(|r| r.turn_worker);
    ReleaseFacts { prepared: prs || dev, in_pr: prs || dev, ci_green: dev, on_development: dev, on_staging: staging, on_main: main, web_deployed: main, worker_deployed: worker, live_verified: worker }
}

pub fn ticket_numbers(snapshot: &Snapshot) -> Vec<u32> {
    let mut v: Vec<u32> = snapshot.jobs.values().filter_map(|j| j.ticket).collect();
    v.sort_unstable(); v.dedup(); v
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ledger::parse;

    #[test]
    fn jobs_become_attempts_on_one_task_per_ticket() {
        let s = parse(r#"{"version":1,"jobs":{
          "t":{"id":"t","kind":"ticket","state":"waiting","ticket":1522,"at":10,"updatedAt":50},
          "c":{"id":"c","kind":"coding","state":"done","codingParent":"t","at":20,"updatedAt":30},
          "q":{"id":"q","kind":"conversation","state":"done","source":{"channelName":"ticket-bug-x-1522"},"at":25,"updatedAt":26},
          "o":{"id":"o","kind":"command","state":"running","role":"owner","at":5,"updatedAt":6}}}"#).unwrap();
        let g = graph_of(&s);
        assert_eq!(g.tasks.len(), 2);
        assert_eq!(g.attempts.values().filter(|a| a.task_id == "ticket:1522").count(), 3);
        assert_eq!(g.task_state("ticket:1522"), harness_core::tasks::TaskState::Waiting);
        assert_eq!(g.task_state("request:o"), harness_core::tasks::TaskState::Active);
        assert_eq!(ticket_numbers(&s), vec![1522]);
    }
}
