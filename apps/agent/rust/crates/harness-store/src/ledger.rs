//! Read-only projection of `/var/lib/keir-operator/ledger.json`. Only the
//! fields the shadow needs; unknown fields are ignored so the Node side can
//! keep evolving. Never written.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ReleaseEvidence { pub at: i64, pub development: bool, pub staging: bool, pub main: bool, pub turn_worker: bool }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Job {
    pub id: String,
    pub kind: String,
    pub state: String,
    pub role: String,
    pub ticket: Option<u32>,
    pub channel_name: Option<String>,
    pub at: i64,
    pub updated_at: i64,
    pub started_at: Option<i64>,
    pub coding_parent: Option<String>,
    pub pull_requests: Vec<String>,
    pub release: Vec<ReleaseEvidence>,
    pub merged: bool,
    pub observed_player_at: i64,
    pub last_player_at: i64,
    pub effects_started: u32,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub summary: String,
    pub finished_at: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Action {
    pub id: String,
    pub job_id: String,
    pub kind: String,
    pub state: String,
    pub at: i64,
    pub approved_at: Option<i64>,
    pub approved_by: Option<String>,
    pub approval_message: Option<String>,
    pub night_pass: bool,
    pub action: Option<String>,
    pub to: Option<String>,
    pub number: Option<u64>,
    pub head: Option<String>,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Decision { pub id: String, pub job_id: String, pub action_id: Option<String>, pub state: String, pub at: i64, pub answered_at: Option<i64>, pub answer: Option<String> }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CardItem { pub name: String, pub stage: String, pub blocked: bool }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StatusCard { pub ticket: u32, pub items: Vec<CardItem>, pub at: i64 }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AuditEntry { pub at: i64, pub kind: String, pub job: Option<String>, pub ticket: Option<u32>, pub detail: Value }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Snapshot {
    pub jobs: BTreeMap<String, Job>,
    pub actions: Vec<Action>,
    pub decisions: Vec<Decision>,
    pub status_cards: Vec<StatusCard>,
    pub audit: Vec<AuditEntry>,
    pub support_owner: Option<String>,
    pub support_tickets: BTreeMap<u32, String>,
    pub monologue: BTreeMap<u32, (i64, u32)>,
}

fn i64_of(v: &Value) -> i64 {
    match v { Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)).unwrap_or(0), Value::String(s) => chrono::DateTime::parse_from_rfc3339(s).map(|d| d.timestamp_millis()).unwrap_or(0), _ => 0 }
}
fn str_of(v: &Value) -> Option<String> { v.as_str().map(|s| s.to_string()) }
fn ticket_of_name(name: &str) -> Option<u32> {
    let rest = name.strip_prefix("ticket-")?;
    rest.rsplit('-').next()?.parse().ok()
}

pub fn parse(text: &str) -> anyhow::Result<Snapshot> {
    let v: Value = serde_json::from_str(text)?;
    let mut s = Snapshot::default();
    if let Some(jobs) = v.get("jobs").and_then(Value::as_object) {
        for (id, j) in jobs {
            let channel_name = j.pointer("/source/channelName").and_then(Value::as_str).map(String::from);
            let ticket = j.get("ticket").and_then(Value::as_u64).map(|n| n as u32).or_else(|| channel_name.as_deref().and_then(ticket_of_name));
            let release = j.get("releaseEvidence").and_then(Value::as_object).map(|m| m.values().map(|r| ReleaseEvidence {
                at: r.get("at").map(i64_of).unwrap_or(0),
                development: r.get("development").and_then(Value::as_bool).unwrap_or(false),
                staging: r.get("staging").and_then(Value::as_bool).unwrap_or(false),
                main: r.get("main").and_then(Value::as_bool).unwrap_or(false),
                turn_worker: r.get("turnWorker").and_then(Value::as_bool).unwrap_or(false),
            }).collect()).unwrap_or_default();
            let effects = j.get("effects").and_then(Value::as_object);
            let merged = effects.map(|m| m.iter().any(|(k, e)| k.starts_with("merge:") && e.get("state").and_then(Value::as_str) == Some("done"))).unwrap_or(false);
            let effects_started = effects.map(|m| m.values().filter(|e| e.get("state").and_then(Value::as_str) == Some("started")).count() as u32).unwrap_or(0);
            let finished_at = j.get("history").and_then(Value::as_array).and_then(|h| h.iter().rev().find(|e| e.get("kind").and_then(Value::as_str) == Some("finish")).and_then(|e| e.get("at")).map(i64_of));
            s.jobs.insert(id.clone(), Job {
                id: id.clone(),
                kind: str_of(&j["kind"]).unwrap_or_default(),
                state: str_of(&j["state"]).unwrap_or_default(),
                role: str_of(&j["role"]).unwrap_or_default(),
                ticket,
                channel_name,
                at: j.get("at").map(i64_of).unwrap_or(0),
                updated_at: j.get("updatedAt").map(i64_of).unwrap_or(0),
                started_at: j.get("startedAt").map(i64_of).filter(|x| *x > 0),
                coding_parent: j.get("codingParent").and_then(Value::as_str).map(String::from),
                pull_requests: j.get("pullRequests").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default(),
                release,
                merged,
                observed_player_at: j.get("observedPlayerAt").map(i64_of).unwrap_or(0),
                last_player_at: j.get("lastPlayerAt").map(i64_of).unwrap_or(0),
                effects_started,
                provider: j.pointer("/provider/runner").and_then(Value::as_str).map(String::from),
                model: j.pointer("/provider/model").and_then(Value::as_str).map(String::from),
                summary: str_of(&j["summary"]).unwrap_or_default(),
                finished_at,
            });
        }
    }
    if let Some(actions) = v.get("actions").and_then(Value::as_object) {
        for (id, a) in actions {
            let args = a.get("args").cloned().unwrap_or(Value::Null);
            s.actions.push(Action {
                id: id.clone(),
                job_id: str_of(&a["jobId"]).unwrap_or_default(),
                kind: str_of(&a["kind"]).unwrap_or_default(),
                state: str_of(&a["state"]).unwrap_or_default(),
                at: a.get("at").map(i64_of).unwrap_or(0),
                approved_at: a.get("approvedAt").map(i64_of).filter(|x| *x > 0),
                approved_by: str_of(&a["approvedBy"]),
                approval_message: str_of(&a["approvalMessage"]),
                night_pass: a.get("nightPass").and_then(Value::as_bool).unwrap_or(false),
                action: str_of(&args["action"]),
                to: str_of(&args["to"]),
                number: args.get("number").and_then(Value::as_u64),
                head: str_of(&args["head"]),
                summary: str_of(&args["summary"]),
            });
        }
    }
    if let Some(decisions) = v.get("decisions").and_then(Value::as_object) {
        for (id, d) in decisions {
            s.decisions.push(Decision { id: id.clone(), job_id: str_of(&d["jobId"]).unwrap_or_default(), action_id: str_of(&d["actionId"]), state: str_of(&d["state"]).unwrap_or_default(), at: d.get("at").map(i64_of).unwrap_or(0), answered_at: d.get("answeredAt").map(i64_of).filter(|x| *x > 0), answer: str_of(&d["answer"]) });
        }
    }
    if let Some(cards) = v.get("statusCards").and_then(Value::as_object) {
        for (t, c) in cards {
            let Ok(ticket) = t.parse::<u32>() else { continue };
            let items = c.get("items").and_then(Value::as_array).map(|a| a.iter().map(|i| CardItem { name: str_of(&i["name"]).unwrap_or_default(), stage: str_of(&i["stage"]).unwrap_or_default(), blocked: i.get("blocked").and_then(Value::as_bool).unwrap_or(false) }).collect()).unwrap_or_default();
            s.status_cards.push(StatusCard { ticket, items, at: c.get("at").map(i64_of).unwrap_or(0) });
        }
    }
    if let Some(audit) = v.get("audit").and_then(Value::as_array) {
        for a in audit {
            s.audit.push(AuditEntry { at: a.get("at").map(i64_of).unwrap_or(0), kind: str_of(&a["kind"]).unwrap_or_default(), job: str_of(&a["job"]), ticket: a.get("ticket").and_then(Value::as_u64).map(|n| n as u32), detail: a.clone() });
        }
    }
    if let Some(so) = v.get("supportOwner") {
        s.support_owner = str_of(&so["owner"]);
        if let Some(t) = so.get("tickets").and_then(Value::as_object) {
            for (k, who) in t { if let (Ok(n), Some(w)) = (k.parse::<u32>(), who.as_str()) { s.support_tickets.insert(n, w.to_string()); } }
        }
    }
    if let Some(m) = v.get("monologue").and_then(Value::as_object) {
        for (k, r) in m { if let Ok(n) = k.parse::<u32>() { s.monologue.insert(n, (r.get("humanAt").map(i64_of).unwrap_or(0), r.get("count").and_then(Value::as_u64).unwrap_or(0) as u32)); } }
    }
    Ok(s)
}

pub fn load(path: &Path) -> anyhow::Result<Snapshot> { parse(&std::fs::read_to_string(path)?) }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn projects_the_fields_the_shadow_needs() {
        let s = parse(r#"{"version":1,"jobs":{"j1":{"id":"j1","kind":"ticket","state":"done","role":"support","ticket":1514,"at":1,"updatedAt":2,
          "pullRequests":["https://github.com/x/pull/9"],"releaseEvidence":{"a":{"at":5,"development":true,"staging":true,"main":true,"turnWorker":false}},
          "effects":{"merge:9:abc":{"state":"done"},"x":{"state":"started"}},"history":[{"kind":"finish","at":"2026-10-14T00:50:01.732Z"}]},
          "j2":{"id":"j2","kind":"coding","state":"running","codingParent":"j1","source":{"channelName":"ticket-bug-simonella-1522"},"at":3}},
          "actions":{"a1":{"jobId":"j1","kind":"github","state":"approved","at":7,"approvedAt":8,"approvedBy":"o","args":{"action":"promote","to":"main","head":"e5"}}},
          "decisions":{"d1":{"jobId":"j1","actionId":"a1","state":"approve","at":7,"answeredAt":8}},
          "statusCards":{"1514":{"items":[{"name":"X","stage":"main","blocked":false}],"at":9}},
          "audit":[{"at":1,"kind":"created","job":"j1"}],"supportOwner":{"owner":"keir","tickets":{"1514":"keir"}}}"#).unwrap();
        let j = &s.jobs["j1"];
        assert_eq!(j.ticket, Some(1514)); assert!(j.merged); assert_eq!(j.effects_started, 1); assert_eq!(j.release[0].main, true);
        assert!(j.finished_at.unwrap() > 1_700_000_000_000);
        assert_eq!(s.jobs["j2"].ticket, Some(1522), "ticket from the channel name");
        assert_eq!(s.actions[0].to.as_deref(), Some("main")); assert_eq!(s.actions[0].approved_at, Some(8));
        assert_eq!(s.status_cards[0].items[0].stage, "main");
        assert_eq!(s.support_tickets[&1514], "keir");
    }
}
