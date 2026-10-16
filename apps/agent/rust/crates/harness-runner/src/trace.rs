//! Provider stream lines to normalized trace events. Claude's `stream-json`
//! and Codex's `--json` are structured; Muse's `--json` and Antigravity's
//! single JSON result are kept raw with best-effort classification. Nothing
//! is thrown away: the raw line rides along in `payload`.

use harness_core::routing::Provider;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TraceKind { System, AssistantText, Thinking, ToolUse, ToolResult, Result, RateLimit, Error, Other }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceEvent { pub kind: TraceKind, pub text: Option<String>, pub tool: Option<String>, pub payload: Value }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Usage { pub input_tokens: Option<u64>, pub output_tokens: Option<u64>, pub cache_read_tokens: Option<u64>, pub cache_creation_input_tokens: Option<u64>, pub cache_creation: Option<Value>, pub num_turns: Option<u64> }

pub fn classify(provider: Provider, line: &str) -> Option<TraceEvent> {
    let line = line.trim();
    if line.is_empty() { return None; }
    let Ok(v) = serde_json::from_str::<Value>(line) else {
        return Some(TraceEvent { kind: TraceKind::Other, text: Some(line.chars().take(2000).collect()), tool: None, payload: Value::Null });
    };
    let ev = |kind, text: Option<String>, tool: Option<String>| Some(TraceEvent { kind, text, tool, payload: v.clone() });
    match provider {
        Provider::Claude => match v.get("type").and_then(Value::as_str) {
            Some("system") => ev(TraceKind::System, None, None),
            Some("rate_limit_event") => ev(TraceKind::RateLimit, v.get("rate_limit_info").map(|r| r.to_string()), None),
            Some("assistant") => {
                let content = v.pointer("/message/content").and_then(Value::as_array).cloned().unwrap_or_default();
                if let Some(t) = content.iter().find(|c| c.get("type").and_then(Value::as_str) == Some("tool_use")) {
                    return ev(TraceKind::ToolUse, t.get("input").map(|i| i.to_string()), t.get("name").and_then(Value::as_str).map(|s| s.trim_start_matches("mcp__harness__").to_string()));
                }
                if let Some(t) = content.iter().find(|c| c.get("type").and_then(Value::as_str) == Some("thinking")) { return ev(TraceKind::Thinking, t.get("thinking").and_then(Value::as_str).map(String::from), None); }
                let text: Vec<&str> = content.iter().filter_map(|c| c.get("text").and_then(Value::as_str)).collect();
                ev(TraceKind::AssistantText, Some(text.join("\n")), None)
            }
            Some("user") => ev(TraceKind::ToolResult, None, None),
            Some("result") => ev(TraceKind::Result, v.get("result").and_then(Value::as_str).map(String::from), None),
            _ => ev(TraceKind::Other, None, None),
        },
        Provider::Codex => match v.get("type").and_then(Value::as_str) {
            Some("item.completed") | Some("item.started") => {
                let item = v.get("item").cloned().unwrap_or(Value::Null);
                match item.get("type").and_then(Value::as_str) {
                    Some("agent_message") => ev(TraceKind::AssistantText, item.get("text").and_then(Value::as_str).map(String::from), None),
                    Some("reasoning") => ev(TraceKind::Thinking, item.get("text").and_then(Value::as_str).map(String::from), None),
                    Some("mcp_tool_call") => ev(TraceKind::ToolUse, item.get("arguments").map(|a| a.to_string()), item.get("tool").and_then(Value::as_str).map(String::from)),
                    Some("error") => ev(TraceKind::Error, item.get("message").and_then(Value::as_str).map(String::from), None),
                    _ => ev(TraceKind::Other, None, None),
                }
            }
            Some("turn.completed") => ev(TraceKind::Result, None, None),
            Some("error") => ev(TraceKind::Error, v.get("message").and_then(Value::as_str).map(String::from), None),
            _ => ev(TraceKind::Other, None, None),
        },
        Provider::Muse => {
            // Muse `exec --json`: records with payload_type; the answer is the
            // run terminal text, deltas stream it, task lifecycle carries tools.
            let pt = v.get("payload_type").and_then(Value::as_str).unwrap_or("");
            let p = v.get("payload").cloned().unwrap_or(Value::Null);
            match pt {
                "run.terminal.completed" | "run.terminal.failed" => ev(if pt.ends_with("failed") { TraceKind::Error } else { TraceKind::Result }, p.get("text").and_then(Value::as_str).map(String::from), None),
                "run.output.delta" => ev(TraceKind::Other, p.get("text").and_then(Value::as_str).map(String::from), None),
                _ if pt.starts_with("tool.") || pt.contains("tool_call") => ev(TraceKind::ToolUse, None, p.pointer("/event/tool").or(p.get("tool")).and_then(Value::as_str).map(String::from)),
                _ if pt.starts_with("task.lifecycle") => ev(TraceKind::System, None, None),
                _ => ev(TraceKind::Other, None, None),
            }
        }
        _ => {
            if v.get("tool").is_some() || v.get("tool_name").is_some() { return ev(TraceKind::ToolUse, None, v.get("tool").or(v.get("tool_name")).and_then(Value::as_str).map(String::from)); }
            if v.get("error").is_some() { return ev(TraceKind::Error, v.get("error").map(|e| e.to_string()), None); }
            if let Some(t) = v.get("text").or(v.get("response")).or(v.get("content")).and_then(Value::as_str) { return ev(TraceKind::AssistantText, Some(t.to_string()), None); }
            ev(TraceKind::Other, None, None)
        }
    }
}

pub fn usage_of(provider: Provider, events: &[TraceEvent]) -> Usage {
    let mut u = Usage::default();
    for e in events.iter().rev() {
        if e.kind != TraceKind::Result && !(provider == Provider::Antigravity && e.payload.get("usage").is_some()) { continue; }
        let p = &e.payload;
        match provider {
            Provider::Claude => {
                u.input_tokens = p.pointer("/usage/input_tokens").and_then(Value::as_u64);
                u.output_tokens = p.pointer("/usage/output_tokens").and_then(Value::as_u64);
                u.cache_read_tokens = p.pointer("/usage/cache_read_input_tokens").and_then(Value::as_u64);
                u.cache_creation_input_tokens = p.pointer("/usage/cache_creation_input_tokens").and_then(Value::as_u64);
                u.cache_creation = p.pointer("/usage/cache_creation").cloned();
                u.num_turns = p.get("num_turns").and_then(Value::as_u64);
            }
            Provider::Codex => {
                u.input_tokens = p.pointer("/usage/input_tokens").and_then(Value::as_u64);
                u.output_tokens = p.pointer("/usage/output_tokens").and_then(Value::as_u64);
                u.cache_read_tokens = p.pointer("/usage/cached_input_tokens").and_then(Value::as_u64);
            }
            Provider::Antigravity => {
                u.input_tokens = p.pointer("/usage/input_tokens").and_then(Value::as_u64);
                u.output_tokens = p.pointer("/usage/output_tokens").and_then(Value::as_u64);
                u.cache_read_tokens = p.pointer("/usage/cache_read_tokens").and_then(Value::as_u64);
                u.num_turns = p.get("num_turns").and_then(Value::as_u64);
            }
            _ => {}
        }
        break;
    }
    u
}

/// Quota exhaustion as the Node operator detects it (Muse 429 "usage window
/// resets at", Claude rate_limit_event with a reset time, Codex usage limit).
pub fn quota_hold(stderr: &str, events: &[TraceEvent]) -> Option<String> {
    let re = regex::Regex::new(r"(?i)usage (?:window|limit)[^.\n]{0,80}(?:resets?|reset at|until)[^.\n]{0,60}|429[^\n]{0,80}|rate.?limit(?:ed)?[^\n]{0,80}exceeded").ok()?;
    if let Some(m) = re.find(stderr) { return Some(m.as_str().to_string()); }
    for e in events { if e.kind == TraceKind::RateLimit { if let Some(t) = &e.text { if t.contains("resets") || t.contains("blocked") { return Some(t.clone()); } } } }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cache_creation_and_gemini_usage_survive_normalization() {
        let e = classify(Provider::Claude, r#"{"type":"result","usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":100,"cache_creation_input_tokens":30,"cache_creation":{"ephemeral_5m_input_tokens":10,"ephemeral_1h_input_tokens":20}}}"#).unwrap();
        let u = usage_of(Provider::Claude, &[e]);
        assert_eq!(u.cache_creation_input_tokens, Some(30));
        assert_eq!(u.cache_creation.unwrap()["ephemeral_1h_input_tokens"], 20);
        let e = classify(Provider::Antigravity, r#"{"status":"SUCCESS","response":"ok","num_turns":2,"usage":{"input_tokens":40,"output_tokens":5,"cache_read_tokens":30}}"#).unwrap();
        let u = usage_of(Provider::Antigravity, &[e]);
        assert_eq!(u.input_tokens, Some(40)); assert_eq!(u.output_tokens, Some(5)); assert_eq!(u.cache_read_tokens, Some(30));
        let e = classify(Provider::Codex, r#"{"type":"turn.completed","usage":{"input_tokens":40,"output_tokens":5,"cached_input_tokens":30}}"#).unwrap();
        let u = usage_of(Provider::Codex, &[e]);
        assert_eq!(u.input_tokens, Some(40)); assert_eq!(u.cache_read_tokens, Some(30));
    }
    #[test]
    fn claude_stream_json_is_classified() {
        let e = classify(Provider::Claude, r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__harness__read_file","input":{"path":"a"}}]}}"#).unwrap();
        assert_eq!(e.kind, TraceKind::ToolUse); assert_eq!(e.tool.as_deref(), Some("read_file"));
        let e = classify(Provider::Claude, r#"{"type":"result","subtype":"success","result":"done","num_turns":3,"usage":{"input_tokens":10,"output_tokens":5}}"#).unwrap();
        assert_eq!(e.kind, TraceKind::Result);
        let u = usage_of(Provider::Claude, &[e]);
        assert_eq!(u.num_turns, Some(3)); assert_eq!(u.input_tokens, Some(10));
        let m = classify(Provider::Muse, r#"{"payload_type":"run.terminal.completed","payload":{"kind":"run_terminal","terminal":"completed","text":"{\"1\": \"100 /100\"}"}}"#).unwrap();
        assert_eq!(m.kind, TraceKind::Result); assert!(m.text.as_deref().unwrap().contains("100 /100"));
        let e = classify(Provider::Codex, r#"{"type":"item.completed","item":{"type":"mcp_tool_call","server":"harness","tool":"search","arguments":{"pattern":"x"}}}"#).unwrap();
        assert_eq!(e.kind, TraceKind::ToolUse); assert_eq!(e.tool.as_deref(), Some("search"));
        assert!(quota_hold("Error: usage window resets at 2026-10-14T06:00Z", &[]).is_some());
        assert!(quota_hold("all good", &[]).is_none());
        assert_eq!(classify(Provider::Muse, "plain text line").unwrap().kind, TraceKind::Other);
    }
}
