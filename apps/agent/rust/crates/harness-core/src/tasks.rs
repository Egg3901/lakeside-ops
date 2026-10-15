//! The durable task graph: one canonical task per ticket or request,
//! attempts under it, leases, typed waits with deadlines, parent/child
//! delegation with depth and fan-out limits, cancellation that cascades,
//! and restart recovery that never re-runs an uncertain external effect.
//!
//! Pure in-memory model. The store persists it; the shadow projects the
//! Node ledger onto it (same ids as `workrecord.js`: `ticket:N` and
//! `request:<root job>`).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskKind { Ticket, Request, Coding, Conversation, Probe, Notice, Candidate, Research, Review, Docs, Vision, ReleaseCheck }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskState { Queued, Active, Waiting, Blocked, Deferred, Terminal }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AttemptState { Queued, Running, Waiting, Blocked, Done, Cancelled, Dismissed, Uncertain }

impl AttemptState {
    pub fn terminal(self) -> bool { matches!(self, AttemptState::Done | AttemptState::Cancelled | AttemptState::Dismissed) }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub kind: TaskKind,
    pub project: Option<String>,
    pub parent: Option<String>,
    pub ticket: Option<u32>,
    pub requester: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deadline: Option<i64>,
    pub cancelled: bool,
    pub depth: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attempt {
    pub id: String,
    pub task_id: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub state: AttemptState,
    pub started_at: Option<i64>,
    pub ended_at: Option<i64>,
    /// An external write began and its outcome is not yet known.
    pub effects_in_flight: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lease { pub task_id: String, pub holder: String, pub until: i64 }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WaitKind { Ci, Deploy, Turn, Decision, Timer, Child }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WaitState { Pending, Satisfied, TimedOut, Cancelled, Superseded }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Wait {
    pub id: String,
    pub task_id: String,
    pub kind: WaitKind,
    pub correlation: String,
    pub deadline: i64,
    pub state: WaitState,
    pub created_at: i64,
    pub ended_at: Option<i64>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum GraphError {
    #[error("unknown task {0}")] UnknownTask(String),
    #[error("task {0} already has a live lease held by {1}")] Leased(String, String),
    #[error("a wait needs a positive deadline")] NoDeadline,
    #[error("delegation depth {0} exceeds the limit {1}")] TooDeep(u32, u32),
    #[error("task {0} already has {1} children; fan-out limit is {2}")] FanOut(String, usize, u32),
    #[error("task {0} is cancelled")] Cancelled(String),
}

#[derive(Debug, Clone, Copy)]
pub struct Limits { pub max_depth: u32, pub max_fanout: u32 }
impl Default for Limits { fn default() -> Self { Limits { max_depth: 2, max_fanout: 4 } } }

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct TaskGraph {
    pub tasks: BTreeMap<String, Task>,
    pub attempts: BTreeMap<String, Attempt>,
    pub leases: BTreeMap<String, Lease>,
    pub waits: BTreeMap<String, Wait>,
    counter: u64,
}

impl TaskGraph {
    fn next_id(&mut self, prefix: &str) -> String { self.counter += 1; format!("{prefix}{}", self.counter) }

    pub fn add_task(&mut self, id: impl Into<String>, kind: TaskKind, now: i64) -> &mut Task {
        let id = id.into();
        self.tasks.entry(id.clone()).or_insert(Task { id, kind, project: None, parent: None, ticket: None, requester: None, created_at: now, updated_at: now, deadline: None, cancelled: false, depth: 0 })
    }

    /// A child inherits its parent's project and ticket and sits one level
    /// deeper; depth and fan-out are hard limits, not defaults.
    pub fn add_child(&mut self, parent_id: &str, id: impl Into<String>, kind: TaskKind, now: i64, limits: Limits) -> Result<&mut Task, GraphError> {
        let parent = self.tasks.get(parent_id).ok_or_else(|| GraphError::UnknownTask(parent_id.into()))?.clone();
        if parent.cancelled { return Err(GraphError::Cancelled(parent_id.into())); }
        if parent.depth + 1 > limits.max_depth { return Err(GraphError::TooDeep(parent.depth + 1, limits.max_depth)); }
        let siblings = self.tasks.values().filter(|t| t.parent.as_deref() == Some(parent_id) && !t.cancelled).count();
        if siblings as u32 >= limits.max_fanout { return Err(GraphError::FanOut(parent_id.into(), siblings, limits.max_fanout)); }
        let id = id.into();
        let child = Task { id: id.clone(), kind, project: parent.project.clone(), parent: Some(parent_id.into()), ticket: parent.ticket, requester: parent.requester.clone(), created_at: now, updated_at: now, deadline: parent.deadline, cancelled: false, depth: parent.depth + 1 };
        self.tasks.insert(id.clone(), child);
        Ok(self.tasks.get_mut(&id).expect("inserted"))
    }

    pub fn add_attempt(&mut self, task_id: &str, id: impl Into<String>, state: AttemptState, started_at: Option<i64>) -> Result<&mut Attempt, GraphError> {
        if !self.tasks.contains_key(task_id) { return Err(GraphError::UnknownTask(task_id.into())); }
        let id = id.into();
        self.attempts.insert(id.clone(), Attempt { id: id.clone(), task_id: task_id.into(), provider: None, model: None, state, started_at, ended_at: None, effects_in_flight: 0 });
        Ok(self.attempts.get_mut(&id).expect("inserted"))
    }

    /// One writer per task. A lease past its `until` is dead and may be taken.
    pub fn lease(&mut self, task_id: &str, holder: &str, ttl_ms: i64, now: i64) -> Result<&Lease, GraphError> {
        if !self.tasks.contains_key(task_id) { return Err(GraphError::UnknownTask(task_id.into())); }
        if let Some(l) = self.leases.get(task_id) {
            if l.until > now && l.holder != holder { return Err(GraphError::Leased(task_id.into(), l.holder.clone())); }
        }
        self.leases.insert(task_id.into(), Lease { task_id: task_id.into(), holder: holder.into(), until: now + ttl_ms });
        Ok(self.leases.get(task_id).expect("inserted"))
    }
    pub fn release(&mut self, task_id: &str, holder: &str) { if self.leases.get(task_id).map(|l| l.holder == holder).unwrap_or(false) { self.leases.remove(task_id); } }

    /// Every wait has a deadline. Re-arming the same correlation returns the
    /// existing pending wait; a new CI head supersedes the old CI wait.
    pub fn arm_wait(&mut self, task_id: &str, kind: WaitKind, correlation: &str, deadline_ms: i64, now: i64) -> Result<String, GraphError> {
        if !self.tasks.contains_key(task_id) { return Err(GraphError::UnknownTask(task_id.into())); }
        if deadline_ms <= 0 { return Err(GraphError::NoDeadline); }
        let mut existing = None;
        let mut supersede = Vec::new();
        for w in self.waits.values() {
            if w.task_id != task_id || w.state != WaitState::Pending { continue; }
            if w.correlation == correlation { existing = Some(w.id.clone()); }
            else if kind == WaitKind::Ci && w.kind == WaitKind::Ci && w.correlation.split('@').next() == correlation.split('@').next() { supersede.push(w.id.clone()); }
        }
        if let Some(id) = existing { return Ok(id); }
        for id in supersede { if let Some(w) = self.waits.get_mut(&id) { w.state = WaitState::Superseded; w.ended_at = Some(now); } }
        let id = self.next_id("w");
        self.waits.insert(id.clone(), Wait { id: id.clone(), task_id: task_id.into(), kind, correlation: correlation.into(), deadline: now + deadline_ms, state: WaitState::Pending, created_at: now, ended_at: None });
        Ok(id)
    }

    pub fn observe(&mut self, correlation: &str, now: i64) -> Vec<String> {
        let mut advanced = Vec::new();
        for w in self.waits.values_mut() {
            if w.correlation == correlation && w.state == WaitState::Pending { w.state = WaitState::Satisfied; w.ended_at = Some(now); advanced.push(w.task_id.clone()); }
        }
        advanced
    }

    /// Deadline sweep: a hung dependency becomes a visible timed-out wait.
    pub fn sweep(&mut self, now: i64) -> Vec<String> {
        let mut out = Vec::new();
        for w in self.waits.values_mut() {
            if w.state == WaitState::Pending && w.deadline <= now { w.state = WaitState::TimedOut; w.ended_at = Some(now); out.push(w.id.clone()); }
        }
        out
    }

    /// Cancel a task and every descendant: admission stops, pending waits
    /// end, running attempts are asked to stop. An attempt with an external
    /// write in flight is marked uncertain, never silently dropped.
    pub fn cancel(&mut self, task_id: &str, now: i64) -> Vec<String> {
        let mut stack = vec![task_id.to_string()];
        let mut touched = Vec::new();
        while let Some(id) = stack.pop() {
            if let Some(t) = self.tasks.get_mut(&id) { t.cancelled = true; t.updated_at = now; } else { continue; }
            touched.push(id.clone());
            for w in self.waits.values_mut() { if w.task_id == id && w.state == WaitState::Pending { w.state = WaitState::Cancelled; w.ended_at = Some(now); } }
            for a in self.attempts.values_mut() {
                if a.task_id != id || a.state.terminal() { continue; }
                a.state = if a.effects_in_flight > 0 { AttemptState::Uncertain } else { AttemptState::Cancelled };
                a.ended_at = Some(now);
            }
            self.leases.remove(&id);
            stack.extend(self.tasks.values().filter(|t| t.parent.as_deref() == Some(id.as_str())).map(|t| t.id.clone()));
        }
        touched
    }

    /// After a process death: running attempts with an effect in flight are
    /// uncertain (inspect the receipt before any retry); the rest re-queue.
    pub fn recover(&mut self, now: i64) -> (Vec<String>, Vec<String>) {
        let (mut uncertain, mut requeued) = (Vec::new(), Vec::new());
        for a in self.attempts.values_mut() {
            if a.state != AttemptState::Running { continue; }
            if a.effects_in_flight > 0 { a.state = AttemptState::Uncertain; uncertain.push(a.id.clone()); }
            else { a.state = AttemptState::Queued; requeued.push(a.id.clone()); }
            a.ended_at = Some(now);
        }
        self.leases.clear();
        (uncertain, requeued)
    }

    /// Record state as `workrecord.js` derives it from attempts.
    pub fn task_state(&self, task_id: &str) -> TaskState {
        let states: Vec<AttemptState> = self.attempts.values().filter(|a| a.task_id == task_id).map(|a| a.state).collect();
        if states.is_empty() { return TaskState::Queued; }
        if states.iter().all(|s| s.terminal()) { return TaskState::Terminal; }
        if states.contains(&AttemptState::Running) { return TaskState::Active; }
        if states.contains(&AttemptState::Queued) { return TaskState::Queued; }
        if states.contains(&AttemptState::Blocked) || states.contains(&AttemptState::Uncertain) { return TaskState::Blocked; }
        TaskState::Waiting
    }

    pub fn children(&self, task_id: &str) -> Vec<&Task> { self.tasks.values().filter(|t| t.parent.as_deref() == Some(task_id)).collect() }
    pub fn pending_waits(&self, task_id: &str) -> Vec<&Wait> { self.waits.values().filter(|w| w.task_id == task_id && w.state == WaitState::Pending).collect() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leases_are_exclusive_until_they_expire() {
        let mut g = TaskGraph::default();
        g.add_task("ticket:1", TaskKind::Ticket, 0);
        g.lease("ticket:1", "rust", 1000, 0).unwrap();
        assert_eq!(g.lease("ticket:1", "node", 1000, 500).unwrap_err(), GraphError::Leased("ticket:1".into(), "rust".into()));
        assert!(g.lease("ticket:1", "node", 1000, 1500).is_ok(), "a dead lease may be taken");
    }

    #[test]
    fn delegation_limits_and_cascading_cancel() {
        let mut g = TaskGraph::default();
        g.add_task("ticket:1", TaskKind::Ticket, 0).ticket = Some(1);
        let limits = Limits { max_depth: 1, max_fanout: 2 };
        g.add_child("ticket:1", "c1", TaskKind::Coding, 0, limits).unwrap();
        g.add_child("ticket:1", "c2", TaskKind::Review, 0, limits).unwrap();
        assert!(matches!(g.add_child("ticket:1", "c3", TaskKind::Coding, 0, limits), Err(GraphError::FanOut(..))));
        assert!(matches!(g.add_child("c1", "cc", TaskKind::Coding, 0, limits), Err(GraphError::TooDeep(2, 1))));
        assert_eq!(g.tasks["c1"].ticket, Some(1), "children inherit the ticket");
        g.add_attempt("c1", "a1", AttemptState::Running, Some(0)).unwrap().effects_in_flight = 1;
        g.add_attempt("c2", "a2", AttemptState::Running, Some(0)).unwrap();
        g.arm_wait("c2", WaitKind::Ci, "ci:repo#1@abc", 1000, 0).unwrap();
        let touched = g.cancel("ticket:1", 10);
        assert_eq!(touched.len(), 3);
        assert_eq!(g.attempts["a1"].state, AttemptState::Uncertain, "an in-flight external write is never dropped");
        assert_eq!(g.attempts["a2"].state, AttemptState::Cancelled);
        assert!(g.waits.values().all(|w| w.state == WaitState::Cancelled));
    }

    #[test]
    fn waits_always_end() {
        let mut g = TaskGraph::default();
        g.add_task("t", TaskKind::Request, 0);
        assert_eq!(g.arm_wait("t", WaitKind::Ci, "ci:r#1@a", 0, 0).unwrap_err(), GraphError::NoDeadline);
        let w1 = g.arm_wait("t", WaitKind::Ci, "ci:r#1@a", 100, 0).unwrap();
        assert_eq!(g.arm_wait("t", WaitKind::Ci, "ci:r#1@a", 100, 0).unwrap(), w1, "same correlation reuses the wait");
        let w2 = g.arm_wait("t", WaitKind::Ci, "ci:r#1@b", 100, 0).unwrap();
        assert_eq!(g.waits[&w1].state, WaitState::Superseded);
        assert_eq!(g.sweep(200), vec![w2.clone()]);
        assert_eq!(g.waits[&w2].state, WaitState::TimedOut);
    }

    #[test]
    fn restart_recovery_marks_uncertain_effects() {
        let mut g = TaskGraph::default();
        g.add_task("t", TaskKind::Ticket, 0);
        g.add_attempt("t", "a", AttemptState::Running, Some(0)).unwrap().effects_in_flight = 1;
        g.add_attempt("t", "b", AttemptState::Running, Some(0)).unwrap();
        g.lease("t", "x", 1000, 0).unwrap();
        let (u, r) = g.recover(5);
        assert_eq!(u, vec!["a"]); assert_eq!(r, vec!["b"]);
        assert!(g.leases.is_empty());
        assert_eq!(g.attempts["a"].state, AttemptState::Uncertain);
        // As workrecord.js: a queued attempt makes the record queued; the
        // uncertain one stays visible on its attempt and in the open-task list.
        assert_eq!(g.task_state("t"), TaskState::Queued);
    }
}
