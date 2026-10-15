//! Tool backends behind the loopback endpoint.

use harness_core::routing::Grant;
use harness_store::mcp::McpClient;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Mutex;

pub type BoxFut<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolSpec { pub name: String, pub description: String, #[serde(rename = "inputSchema")] pub input_schema: Value }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult { pub content: Vec<Value>, #[serde(rename = "isError", default)] pub is_error: bool }

impl ToolResult {
    pub fn text(s: impl Into<String>) -> Self { ToolResult { content: vec![json!({ "type": "text", "text": s.into() })], is_error: false } }
    pub fn json(v: &Value) -> Self { ToolResult::text(v.to_string()) }
    pub fn error(s: impl Into<String>) -> Self { ToolResult { content: vec![json!({ "type": "text", "text": s.into() })], is_error: true } }
}

pub trait ToolBackend: Send + Sync {
    fn tools(&self) -> Vec<ToolSpec>;
    fn call<'a>(&'a self, name: &'a str, args: Value) -> BoxFut<'a, ToolResult>;
    /// The structured result a `finish` call left behind, if the backend has one.
    fn result(&self) -> Option<Value> { None }
}

/// Forwards to a Node operator toolserver session (`/v4/tool-session`).
/// Ticket policy, receipts and the publisher stay in Node; the Rust side
/// gains the loop, the trace and admission.
pub struct NodeProxy { url: String, tools: Vec<ToolSpec>, http: reqwest::Client }

impl NodeProxy {
    pub async fn connect(url: &str) -> anyhow::Result<Self> {
        let http = reqwest::Client::builder().timeout(std::time::Duration::from_secs(600)).build()?;
        let v: Value = http.post(url).json(&json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {} })).send().await?.json().await?;
        let tools = serde_json::from_value(v["result"]["tools"].clone()).unwrap_or_default();
        Ok(NodeProxy { url: url.to_string(), tools, http })
    }
}

impl ToolBackend for NodeProxy {
    fn tools(&self) -> Vec<ToolSpec> { self.tools.clone() }
    fn call<'a>(&'a self, name: &'a str, args: Value) -> BoxFut<'a, ToolResult> {
        Box::pin(async move {
            let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": name, "arguments": args } });
            match self.http.post(&self.url).json(&body).send().await {
                Ok(res) => match res.json::<Value>().await {
                    Ok(v) => serde_json::from_value(v["result"].clone()).unwrap_or_else(|_| ToolResult::error(format!("node toolserver returned no result for {name}"))),
                    Err(e) => ToolResult::error(format!("node toolserver response unreadable: {e}")),
                },
                Err(e) => ToolResult::error(format!("node toolserver unreachable: {e}")),
            }
        })
    }
}

/// General Lakeside work: a bounded toolset over one directory, under a grant.
/// The five irreversible things are refused outright (a push to a permanent
/// branch, a force push, changing what runs the box, leaving the root,
/// deleting broadly); everything else is recorded in the trace.
pub struct Workspace {
    pub root: PathBuf,
    pub grant: Grant,
    pub mcp: Option<(McpClient, Vec<String>)>,
    result: Mutex<Option<Value>>,
    pub notes: Mutex<Vec<String>>,
    read_tools: Option<std::collections::BTreeMap<String, Vec<String>>>,
}

const READ_TOOL_DENY: &str = r"(?i)(save|add|update|apply|send|create|set_|delete|resolve|publish|upload|restart|notify|rollback|scaffold|compensate|run_world|run_election|patch|solve)";
const SHELL_DENY: &str = r"(?i)git\s+push\b.*\b(main|master|staging|development)\b|--force\b|-f\s+origin|git\s+push\s+-f|\bsystemctl\b|\bdocker\b|\brm\s+-rf\s+/|\brm\s+-rf\s+~|\bsudo\b|\bchattr\b|/etc/systemd|\bmongosh\b|\bcurl\b.*-X\s*(POST|PUT|DELETE|PATCH)|\bgh\s+(pr\s+merge|api\s+-X)|\bgit\s+reset\s+--hard\b|\bgit\s+checkout\s+(main|master|staging|development)\b";

impl Workspace {
    pub fn new(root: PathBuf, grant: Grant, mcp: Option<(McpClient, Vec<String>)>) -> Self {
        Workspace { root, grant, mcp, result: Mutex::new(None), notes: Mutex::new(Vec::new()), read_tools: None }
    }

    /// Explicit read tool names for an independent stack. Server credentials
    /// must also enforce read access; names alone do not establish authority.
    pub fn with_read_tools(mut self, tools: std::collections::BTreeMap<String, Vec<String>>) -> Self {
        self.read_tools = Some(tools);
        self
    }

    fn within(&self, rel: &str) -> Result<PathBuf, String> {
        let p = if rel.is_empty() || rel == "." { self.root.clone() } else { self.root.join(rel) };
        let canon = p.canonicalize().map_err(|e| format!("{rel}: {e}"))?;
        let root = self.root.canonicalize().map_err(|e| e.to_string())?;
        if !canon.starts_with(&root) { return Err(format!("{rel} is outside the task root")); }
        Ok(canon)
    }

    fn spec(name: &str, description: &str, props: Value, required: &[&str]) -> ToolSpec {
        ToolSpec { name: name.into(), description: description.into(), input_schema: json!({ "type": "object", "properties": props, "required": required, "additionalProperties": false }) }
    }
}

fn str_arg<'a>(args: &'a Value, k: &str) -> &'a str { args.get(k).and_then(Value::as_str).unwrap_or("") }

impl ToolBackend for Workspace {
    fn tools(&self) -> Vec<ToolSpec> {
        let s = json!({ "type": "string" });
        let mut t = vec![
            Workspace::spec("read_file", "Read a file under the task root (UTF-8, first 200 KB).", json!({ "path": s, "start_line": { "type": "integer" }, "max_lines": { "type": "integer" } }), &["path"]),
            Workspace::spec("list_dir", "List a directory under the task root.", json!({ "path": s }), &[]),
            Workspace::spec("search", "Search file contents under the task root (fixed string or regex, up to 200 hits).", json!({ "pattern": s, "path": s, "regex": { "type": "boolean" } }), &["pattern"]),
            Workspace::spec("note", "Record an intermediate finding in the trace.", json!({ "text": s }), &["text"]),
            Workspace::spec("finish", "End the task with a structured result. Call exactly once.", json!({ "status": { "type": "string", "enum": ["done", "blocked", "failed"] }, "summary": s, "findings": { "type": "array", "items": s }, "sources": { "type": "array", "items": s }, "patch": s, "tests": s, "blockers": { "type": "array", "items": s } }), &["status", "summary"]),
        ];
        if self.grant.sandbox_write {
            t.push(Workspace::spec("write_file", "Create or overwrite a file under the task root with the given content (UTF-8). This is how you edit code: your own client's write tools are off by design, this one is on.", json!({ "path": s, "content": s }), &["path", "content"]));
        }
        if self.grant.tool_exec {
            t.push(Workspace::spec("shell", "Run a shell command inside the task root (bash, 300 s): tests, git diff, formatters. Your own client's shell is off by design; this one is on. Irreversible git and host operations are refused.", json!({ "command": s }), &["command"]));
        }
        if self.mcp.is_some() {
            t.push(Workspace::spec("mcp_read", "Call an allowed read tool on a configured local MCP server. Use the server and tool names from your operating brief.", json!({ "server": s, "tool": s, "args": { "type": "object" } }), &["server", "tool"]));
        }
        t
    }

    fn result(&self) -> Option<Value> { self.result.lock().ok().and_then(|r| r.clone()) }

    fn call<'a>(&'a self, name: &'a str, args: Value) -> BoxFut<'a, ToolResult> {
        Box::pin(async move {
            match name {
                "read_file" => {
                    let path = match self.within(str_arg(&args, "path")) { Ok(p) => p, Err(e) => return ToolResult::error(e) };
                    match std::fs::read(&path) {
                        Ok(bytes) => {
                            let text = String::from_utf8_lossy(&bytes[..bytes.len().min(200_000)]).to_string();
                            let start = args.get("start_line").and_then(Value::as_u64).unwrap_or(1).max(1) as usize;
                            let max = args.get("max_lines").and_then(Value::as_u64).unwrap_or(400) as usize;
                            let lines: Vec<String> = text.lines().enumerate().skip(start - 1).take(max).map(|(i, l)| format!("{}\t{}", i + 1, l)).collect();
                            ToolResult::text(lines.join("\n"))
                        }
                        Err(e) => ToolResult::error(format!("read failed: {e}")),
                    }
                }
                "list_dir" => {
                    let path = match self.within(str_arg(&args, "path")) { Ok(p) => p, Err(e) => return ToolResult::error(e) };
                    match std::fs::read_dir(&path) {
                        Ok(rd) => { let mut names: Vec<String> = rd.filter_map(|e| e.ok()).map(|e| { let n = e.file_name().to_string_lossy().to_string(); if e.path().is_dir() { format!("{n}/") } else { n } }).collect(); names.sort(); ToolResult::text(names.join("\n")) }
                        Err(e) => ToolResult::error(format!("list failed: {e}")),
                    }
                }
                "search" => {
                    let pattern = str_arg(&args, "pattern").to_string();
                    if pattern.is_empty() { return ToolResult::error("pattern is required"); }
                    let path = match self.within(str_arg(&args, "path")) { Ok(p) => p, Err(e) => return ToolResult::error(e) };
                    let regex = args.get("regex").and_then(Value::as_bool).unwrap_or(false);
                    let mut cmd = tokio::process::Command::new("grep");
                    cmd.arg("-rnI").arg("--exclude-dir=node_modules").arg("--exclude-dir=.git").arg("--exclude-dir=target").arg("--exclude-dir=.next").arg("--exclude-dir=dist").arg("-m").arg("50");
                    if !regex { cmd.arg("-F"); } else { cmd.arg("-E"); }
                    cmd.arg("--").arg(&pattern).arg(&path).kill_on_drop(true);
                    match tokio::time::timeout(std::time::Duration::from_secs(60), cmd.output()).await {
                        Ok(Ok(out)) => { let s = String::from_utf8_lossy(&out.stdout); let lines: Vec<&str> = s.lines().take(200).collect(); ToolResult::text(if lines.is_empty() { "no matches".to_string() } else { lines.join("\n") }) }
                        Ok(Err(e)) => ToolResult::error(format!("search failed: {e}")),
                        Err(_) => ToolResult::error("search timed out"),
                    }
                }
                "write_file" => {
                    if !self.grant.sandbox_write { return ToolResult::error("this task has no write grant"); }
                    let rel = str_arg(&args, "path");
                    if rel.is_empty() || rel.contains("..") || rel.starts_with('/') { return ToolResult::error("path must be relative to the task root"); }
                    let target = self.root.join(rel);
                    if let Some(parent) = target.parent() { if let Err(e) = std::fs::create_dir_all(parent) { return ToolResult::error(format!("mkdir failed: {e}")); } }
                    // The parent must resolve inside the root even through symlinks.
                    match target.parent().and_then(|p| p.canonicalize().ok()).zip(self.root.canonicalize().ok()) {
                        Some((p, r)) if p.starts_with(&r) => {}
                        _ => return ToolResult::error(format!("{rel} is outside the task root")),
                    }
                    let content = str_arg(&args, "content");
                    match std::fs::write(&target, content) { Ok(()) => ToolResult::text(format!("wrote {} bytes to {rel}", content.len())), Err(e) => ToolResult::error(format!("write failed: {e}")) }
                }
                "note" => { if let Ok(mut n) = self.notes.lock() { n.push(str_arg(&args, "text").to_string()); } ToolResult::text("noted") }
                "finish" => {
                    if let Ok(mut r) = self.result.lock() {
                        if r.is_some() { return ToolResult::error("finish was already called; the task has ended"); }
                        *r = Some(args.clone());
                    }
                    ToolResult::text("finished; stop here")
                }
                "shell" => {
                    if !self.grant.tool_exec { return ToolResult::error("this task has no shell grant"); }
                    let command = str_arg(&args, "command").to_string();
                    if Regex::new(SHELL_DENY).expect("deny regex").is_match(&command) { return ToolResult::error("refused: that command touches a permanent branch, the host, or deletes broadly. Do the reversible version in this worktree instead."); }
                    let root = self.root.clone();
                    let mut cmd = tokio::process::Command::new("timeout");
                    cmd.arg("-k").arg("10").arg("300").arg("bash").arg("-c").arg(&command).current_dir(&root).env("HOME", crate::spawn::user_home()).env("PATH", crate::spawn::executable_path()).kill_on_drop(true);
                    match cmd.output().await {
                        Ok(out) => { let mut s = String::from_utf8_lossy(&out.stdout).to_string(); let e = String::from_utf8_lossy(&out.stderr); if !e.is_empty() { s.push_str("\n[stderr]\n"); s.push_str(&e); } if s.len() > 24_000 { s.truncate(24_000); s.push_str("\n[truncated]"); } ToolResult { content: vec![json!({ "type": "text", "text": format!("exit {}\n{}", out.status.code().unwrap_or(-1), s) })], is_error: !out.status.success() } }
                        Err(e) => ToolResult::error(format!("shell failed: {e}")),
                    }
                }
                "mcp_read" => {
                    let Some((client, servers)) = &self.mcp else { return ToolResult::error("no MCP access in this task") };
                    let server = str_arg(&args, "server").to_string();
                    let tool = str_arg(&args, "tool").to_string();
                    if !servers.iter().any(|s| *s == server) { return ToolResult::error(format!("server {server} is not in this task's read set ({})", servers.join(", "))); }
                    if let Some(allowed) = &self.read_tools {
                        if !allowed.get(&server).is_some_and(|tools| tools.contains(&tool)) {
                            return ToolResult::error(format!("{server}.{tool} is not in the configured read tool set"));
                        }
                    }
                    if Regex::new(READ_TOOL_DENY).expect("deny regex").is_match(&tool) { return ToolResult::error(format!("{tool} is not a read tool")); }
                    match client.call_on(&server, &tool, args.get("args").cloned().unwrap_or(json!({}))).await {
                        Ok(v) => ToolResult::text(v.to_string().chars().take(22_000).collect::<String>()),
                        Err(e) => ToolResult::error(e.to_string()),
                    }
                }
                other => ToolResult::error(format!("tool {other} is not available in this task")),
            }
        })
    }
}

pub fn is_registered_worktree(repo: &Path, worktree: &Path) -> bool {
    let out = std::process::Command::new("git").arg("-C").arg(repo).arg("worktree").arg("list").arg("--porcelain").output();
    let Ok(out) = out else { return false };
    let wt = worktree.canonicalize().unwrap_or(worktree.to_path_buf());
    String::from_utf8_lossy(&out.stdout).lines().filter_map(|l| l.strip_prefix("worktree ")).any(|p| Path::new(p).canonicalize().map(|c| c == wt).unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn workspace_tools_stay_inside_the_root_and_refuse_irreversible_shell() {
        let dir = std::env::temp_dir().join(format!("ws-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("sub/a.txt"), "hello\nworld\n").unwrap();
        let ws = Workspace::new(dir.clone(), Grant::coding(), None);
        let r = ws.call("read_file", json!({ "path": "sub/a.txt" })).await;
        assert!(!r.is_error); assert!(r.content[0]["text"].as_str().unwrap().contains("2\tworld"));
        assert!(ws.call("read_file", json!({ "path": "../../etc/passwd" })).await.is_error);
        assert!(ws.call("shell", json!({ "command": "git push origin main" })).await.is_error);
        assert!(ws.call("shell", json!({ "command": "systemctl restart keir-operator" })).await.is_error);
        let r = ws.call("shell", json!({ "command": "echo ok" })).await;
        assert!(!r.is_error); assert!(r.content[0]["text"].as_str().unwrap().contains("ok"));
        let s = ws.call("search", json!({ "pattern": "world" })).await;
        assert!(s.content[0]["text"].as_str().unwrap().contains("a.txt"));
        assert!(!ws.call("finish", json!({ "status": "done", "summary": "x" })).await.is_error);
        assert!(ws.call("finish", json!({ "status": "done", "summary": "y" })).await.is_error, "finish is once");
        assert_eq!(ws.result().unwrap()["summary"], "x");
        let ro = Workspace::new(dir.clone(), Grant::read_only(), None);
        assert!(ro.tools().iter().all(|t| t.name != "shell"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
