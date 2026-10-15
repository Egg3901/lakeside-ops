//! One attempt end to end: admission, loopback session, spawn, stream,
//! trace, result. The attempt record and every trace event are appended to
//! `harness.db` as they happen, so a crash leaves a readable partial trace.

use crate::admission::{admit, HostSlot};
use crate::backend::ToolBackend;
use crate::loopback::{LoopbackServer, ToolCallRecord};
use crate::spawn::{prepare, SpawnSpec};
use crate::trace::{classify, quota_hold, usage_of, TraceEvent, TraceKind, Usage};
use harness_core::routing::Route;
use harness_store::attempts::AttemptStore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

pub struct RunSpec {
    pub task_id: String,
    pub attempt_id: String,
    pub route: Route,
    pub brief: String,
    pub prompt: String,
    pub images: Vec<PathBuf>,
    pub cwd: PathBuf,
    pub scratch: PathBuf,
    pub max_turns: u32,
    pub timeout_secs: u64,
    pub writable_workspace: bool,
    pub backend: Arc<dyn ToolBackend>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Outcome {
    pub attempt_id: String,
    pub provider_label: String,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub quota_hold: Option<String>,
    pub result: Option<Value>,
    pub final_text: String,
    pub usage: Usage,
    pub tool_calls: Vec<ToolCallRecord>,
    pub events: usize,
    pub duration_ms: u64,
    pub stderr_tail: String,
    /// Claude's final `result` event subtype (success, error_max_turns, ...), when the provider reports one.
    pub result_subtype: Option<String>,
}

pub async fn run_attempt(spec: RunSpec, store: Option<&AttemptStore>) -> anyhow::Result<Outcome> {
    let _slot: HostSlot = admit(None)?;
    let server = LoopbackServer::start().await?;
    let (url, token) = server.open(spec.backend.clone());
    let tool_names: Vec<String> = spec.backend.tools().into_iter().map(|t| t.name).collect();
    let started = std::time::Instant::now();
    let started_at = chrono::Utc::now().timestamp_millis();
    let prepared = prepare(&SpawnSpec { route: &spec.route, brief: &spec.brief, prompt: &spec.prompt, mcp_url: &url, tool_names: &tool_names, images: &spec.images, cwd: &spec.cwd, scratch: &spec.scratch, max_turns: spec.max_turns, timeout_secs: spec.timeout_secs, writable_workspace: spec.writable_workspace })?;
    if let Some(s) = store { s.start_attempt(&spec.task_id, &spec.attempt_id, &spec.route, &prepared.label, started_at).await?; }
    let mut command = prepared.command;
    let mut child = command.spawn()?;
    if let (Some(mut stdin), Some(text)) = (child.stdin.take(), prepared.stdin) {
        tokio::spawn(async move { let _ = stdin.write_all(text.as_bytes()).await; let _ = stdin.shutdown().await; });
    }
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");
    let provider = prepared.provider;
    let stderr_task = tokio::spawn(async move {
        let mut buf = String::new();
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(l)) = lines.next_line().await { buf.push_str(&l); buf.push('\n'); if buf.len() > 16_000 { buf.drain(..buf.len() - 12_000); } }
        buf
    });
    let mut events: Vec<TraceEvent> = Vec::new();
    let mut lines = BufReader::new(stdout).lines();
    let mut seq = 0i64;
    let mut final_text = String::new();
    let mut raw_tail = String::new();
    while let Ok(Some(line)) = lines.next_line().await {
        if let Some(ev) = classify(provider, &line) {
            if ev.kind == TraceKind::AssistantText || ev.kind == TraceKind::Result { if let Some(t) = &ev.text { if !t.is_empty() { final_text = t.clone(); } } }
            if let Some(s) = store { seq += 1; let _ = s.append_event(&spec.attempt_id, seq, chrono::Utc::now().timestamp_millis(), &serde_json::to_string(&ev.kind)?.trim_matches('"').to_string(), &json!({ "text": ev.text, "tool": ev.tool, "payload": ev.payload })).await; }
            events.push(ev);
        } else if !line.trim().is_empty() { raw_tail = line.chars().take(4000).collect(); }
    }
    let status = child.wait().await?;
    let stderr_text = stderr_task.await.unwrap_or_default();
    let exit_code = status.code();
    let timed_out = exit_code == Some(124) || exit_code == Some(137);
    if final_text.is_empty() {
        if provider == harness_core::routing::Provider::Codex { if let Ok(t) = std::fs::read_to_string(spec.scratch.join("last.txt")) { final_text = t.trim().to_string(); } }
        if final_text.is_empty() { final_text = raw_tail.clone(); }
    }
    let tool_calls = server.close(&token);
    let usage = usage_of(provider, &events);
    let quota = quota_hold(&stderr_text, &events);
    let result = spec.backend.result();
    let result_subtype = events.iter().rev().find(|e| e.kind == TraceKind::Result).and_then(|e| e.payload.get("subtype").and_then(serde_json::Value::as_str).map(String::from));
    let outcome = Outcome { attempt_id: spec.attempt_id.clone(), provider_label: prepared.label, exit_code, timed_out, quota_hold: quota, result, final_text, usage, tool_calls, events: events.len(), duration_ms: started.elapsed().as_millis() as u64, stderr_tail: stderr_text.chars().rev().take(1500).collect::<String>().chars().rev().collect(), result_subtype };
    if let Some(s) = store { s.finish_attempt(&spec.attempt_id, &outcome).await?; }
    Ok(outcome)
}
