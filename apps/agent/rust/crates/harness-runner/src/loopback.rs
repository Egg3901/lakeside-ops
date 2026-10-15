//! The per-attempt loopback MCP endpoint. Streamable HTTP, JSON responses,
//! bound to 127.0.0.1 on an ephemeral port. Each session has an unguessable
//! 48-hex path and one backend; nothing else is reachable through it.

use crate::backend::{ToolBackend, ToolResult};
use axum::{extract::{Path, State}, http::StatusCode, routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallRecord { pub at: i64, pub tool: String, pub args: Value, pub is_error: bool, pub chars: usize, pub ms: u64 }

pub struct Session { pub backend: Arc<dyn ToolBackend>, pub calls: Mutex<Vec<ToolCallRecord>> }

#[derive(Clone)]
struct AppState { sessions: Arc<Mutex<HashMap<String, Arc<Session>>>> }

pub struct LoopbackServer { addr: SocketAddr, state: AppState, _task: tokio::task::JoinHandle<()> }

impl LoopbackServer {
    pub async fn start() -> anyhow::Result<Self> {
        let state = AppState { sessions: Arc::new(Mutex::new(HashMap::new())) };
        let app = Router::new().route("/mcp/{token}", post(handle)).with_state(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;
        let task = tokio::spawn(async move { let _ = axum::serve(listener, app).await; });
        Ok(LoopbackServer { addr, state, _task: task })
    }

    pub fn open(&self, backend: Arc<dyn ToolBackend>) -> (String, String) {
        let token = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())[..48].to_string();
        self.state.sessions.lock().expect("sessions").insert(token.clone(), Arc::new(Session { backend, calls: Mutex::new(Vec::new()) }));
        (format!("http://{}/mcp/{}", self.addr, token), token)
    }

    pub fn close(&self, token: &str) -> Vec<ToolCallRecord> {
        self.state.sessions.lock().expect("sessions").remove(token).map(|s| s.calls.lock().expect("calls").clone()).unwrap_or_default()
    }

    pub fn calls(&self, token: &str) -> Vec<ToolCallRecord> {
        self.state.sessions.lock().expect("sessions").get(token).map(|s| s.calls.lock().expect("calls").clone()).unwrap_or_default()
    }
}

async fn handle(State(state): State<AppState>, Path(token): Path<String>, body: axum::body::Bytes) -> (StatusCode, Json<Value>) {
    let session = { state.sessions.lock().expect("sessions").get(&token).cloned() };
    let Some(session) = session else { return (StatusCode::NOT_FOUND, Json(json!({ "error": "unknown session" }))) };
    let Ok(msg) = serde_json::from_slice::<Value>(&body) else { return (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid json" }))) };
    let Some(id) = msg.get("id").cloned() else { return (StatusCode::ACCEPTED, Json(Value::Null)) };
    let ok = |result: Value| (StatusCode::OK, Json(json!({ "jsonrpc": "2.0", "id": id, "result": result })));
    match msg.get("method").and_then(Value::as_str).unwrap_or("") {
        "initialize" => ok(json!({ "protocolVersion": msg.pointer("/params/protocolVersion").cloned().unwrap_or(json!("2025-06-18")), "capabilities": { "tools": {} }, "serverInfo": { "name": "harness", "version": "4.0.0" } })),
        "ping" => ok(json!({})),
        "tools/list" => ok(json!({ "tools": session.backend.tools() })),
        "tools/call" => {
            let name = msg.pointer("/params/name").and_then(Value::as_str).unwrap_or("").to_string();
            let args = msg.pointer("/params/arguments").cloned().unwrap_or(json!({}));
            let started = std::time::Instant::now();
            let result: ToolResult = if session.backend.tools().iter().any(|t| t.name == name) { session.backend.call(&name, args.clone()).await } else { ToolResult::error(format!("tool {name} is not available in this task")) };
            let chars: usize = result.content.iter().filter_map(|c| c.get("text").and_then(Value::as_str)).map(|s| s.len()).sum();
            session.calls.lock().expect("calls").push(ToolCallRecord { at: chrono::Utc::now().timestamp_millis(), tool: name, args: redact_args(args), is_error: result.is_error, chars, ms: started.elapsed().as_millis() as u64 });
            ok(json!({ "content": result.content, "isError": result.is_error }))
        }
        _ => (StatusCode::OK, Json(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "method not found" } }))),
    }
}

fn redact_args(mut v: Value) -> Value {
    if let Some(obj) = v.as_object_mut() {
        for (k, val) in obj.iter_mut() {
            if k.to_lowercase().contains("token") || k.to_lowercase().contains("secret") || k.to_lowercase().contains("password") { *val = json!("[redacted]"); }
            if let Some(s) = val.as_str() { if s.len() > 2000 { *val = json!(format!("{}… [{} chars]", &s[..s.char_indices().nth(2000).map(|(i, _)| i).unwrap_or(s.len())], s.len())); } }
        }
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::{ToolSpec, BoxFut};
    struct Echo;
    impl ToolBackend for Echo {
        fn tools(&self) -> Vec<ToolSpec> { vec![ToolSpec { name: "echo".into(), description: "echo".into(), input_schema: json!({ "type": "object" }) }] }
        fn call<'a>(&'a self, _name: &'a str, args: Value) -> BoxFut<'a, ToolResult> { Box::pin(async move { ToolResult::json(&args) }) }
    }

    #[tokio::test]
    async fn serves_mcp_methods_and_records_calls() {
        let server = LoopbackServer::start().await.unwrap();
        let (url, token) = server.open(Arc::new(Echo));
        let http = reqwest::Client::new();
        let rpc = |method: &str, params: Value| json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
        let v: Value = http.post(&url).json(&rpc("initialize", json!({}))).send().await.unwrap().json().await.unwrap();
        assert_eq!(v["result"]["serverInfo"]["name"], "harness");
        let v: Value = http.post(&url).json(&rpc("tools/list", json!({}))).send().await.unwrap().json().await.unwrap();
        assert_eq!(v["result"]["tools"][0]["name"], "echo");
        let v: Value = http.post(&url).json(&rpc("tools/call", json!({ "name": "echo", "arguments": { "x": 1, "token": "abc" } }))).send().await.unwrap().json().await.unwrap();
        assert!(v["result"]["content"][0]["text"].as_str().unwrap().contains("\"x\":1"));
        let v: Value = http.post(&url).json(&rpc("tools/call", json!({ "name": "nope", "arguments": {} }))).send().await.unwrap().json().await.unwrap();
        assert_eq!(v["result"]["isError"], true);
        let bad = http.post(url.replace(&token, &"0".repeat(48))).json(&rpc("ping", json!({}))).send().await.unwrap();
        assert_eq!(bad.status(), 404);
        let calls = server.close(&token);
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].args["token"], "[redacted]");
    }
}
