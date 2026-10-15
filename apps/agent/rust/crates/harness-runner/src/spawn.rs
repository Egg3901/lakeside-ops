//! Provider invocations. Each mirrors the Node operator's (`agent.js`,
//! `providers.js`): the CLI's own shell, file and web tools are off, the
//! harness endpoint is the only MCP server, and the subscription login is the
//! only credential. Images attach through the CLI's own image input.
//!
//! Muse and OpenCode coding launches on a repository worktree go through
//! `/root/bin/provider-agent-run.sh` (host policy); the direct `muse exec`
//! here is the tools-only support mode the operator already uses.

use harness_core::routing::{Provider, Route};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::process::Command;

pub struct SpawnSpec<'a> {
    pub route: &'a Route,
    pub brief: &'a str,
    pub prompt: &'a str,
    pub mcp_url: &'a str,
    pub tool_names: &'a [String],
    pub images: &'a [PathBuf],
    pub cwd: &'a Path,
    pub scratch: &'a Path,
    pub max_turns: u32,
    pub timeout_secs: u64,
    pub writable_workspace: bool,
}

pub struct Prepared { pub command: Command, pub stdin: Option<String>, pub provider: Provider, pub label: String }

/// Inherit the launching user's identity and executable search path.
pub fn user_home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/root"))
}

pub fn executable_path() -> String {
    std::env::var("PATH").unwrap_or_else(|_| "/usr/local/bin:/usr/bin:/bin".into())
}

fn timeout_wrapped(secs: u64, program: &str) -> Command {
    let mut c = Command::new("timeout");
    c.arg("-k").arg("15").arg(secs.to_string()).arg(program);
    c.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    c
}

pub fn prepare(s: &SpawnSpec<'_>) -> anyhow::Result<Prepared> {
    std::fs::create_dir_all(s.scratch)?;
    let mcp_name = "harness";
    match s.route.provider {
        Provider::Claude => {
            let mut c = timeout_wrapped(s.timeout_secs, "claude");
            let tools: Vec<String> = s.tool_names.iter().map(|t| format!("mcp__{mcp_name}__{t}")).collect();
            let mut builtin = String::new();
            let mut allowed = tools.clone();
            if !s.images.is_empty() { builtin = "Read".into(); allowed.push("Read".into()); }
            c.arg("-p").arg("--system-prompt").arg(s.brief).arg("--model").arg(&s.route.model).arg("--effort").arg(&s.route.effort)
                .arg("--setting-sources").arg("").arg("--tools").arg(&builtin).arg("--strict-mcp-config")
                .arg("--mcp-config").arg(serde_json::json!({ "mcpServers": { mcp_name: { "type": "http", "url": s.mcp_url } } }).to_string())
                .arg("--allowedTools").arg(allowed.join(",")).arg("--max-turns").arg(s.max_turns.to_string())
                .arg("--no-session-persistence").arg("--output-format").arg("stream-json").arg("--verbose");
            c.current_dir(s.cwd).env_clear().env("HOME", user_home()).env("PATH", executable_path()).env("LANG", "C.UTF-8").env("DISABLE_AUTOUPDATER", "1").env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1");
            let mut prompt = s.prompt.to_string();
            if !s.images.is_empty() { prompt.push_str("\n\nImages for this task (use Read on each path):\n"); for i in s.images { prompt.push_str(&format!("- {}\n", i.display())); } }
            Ok(Prepared { command: c, stdin: Some(prompt), provider: Provider::Claude, label: "claude-cli-subscription".into() })
        }
        Provider::Codex => {
            let home = s.scratch.join("codex-home"); std::fs::create_dir_all(&home)?;
            let auth = home.join("auth.json");
            if !auth.exists() { let source = std::env::var_os("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|| user_home().join(".codex")).join("auth.json");
                std::os::unix::fs::symlink(source, &auth)?; }
            let off = ["shell_tool", "apps", "plugins", "browser_use", "browser_use_external", "computer_use", "multi_agent", "image_generation", "hooks", "goals", "in_app_browser", "memories", "remote_plugin", "skill_search", "sleep_tool"];
            let mut cfg = vec![format!("model = {:?}", s.route.model), format!("model_reasoning_effort = {:?}", s.route.effort), "web_search = \"disabled\"".into(), "mcp_optional_startup_grace_ms = 0".into(), String::new(), "[features]".into()];
            cfg.extend(off.iter().map(|f| format!("{f} = false")));
            cfg.extend([String::new(), format!("[mcp_servers.{mcp_name}]"), format!("url = {:?}", s.mcp_url), "default_tools_approval_mode = \"approve\"".into(), "required = true".into(), String::new()]);
            std::fs::write(home.join("config.toml"), cfg.join("\n"))?;
            let last = s.scratch.join("last.txt");
            let mut c = timeout_wrapped(s.timeout_secs, "codex");
            c.arg("exec").arg("--ephemeral").arg("--skip-git-repo-check").arg("-s").arg(if s.writable_workspace { "workspace-write" } else { "read-only" }).arg("-C").arg(s.cwd).arg("--json").arg("-o").arg(&last);
            for i in s.images { c.arg("-i").arg(i); }
            c.arg("-");
            c.current_dir(s.cwd).env_clear().env("HOME", user_home()).env("CODEX_HOME", &home).env("PATH", executable_path()).env("LANG", "C.UTF-8");
            Ok(Prepared { command: c, stdin: Some(format!("{}\n\n## This task\n\n{}\n", s.brief, s.prompt)), provider: Provider::Codex, label: "codex-cli-chatgpt-subscription".into() })
        }
        Provider::Muse => {
            let tmp = s.scratch.join("tmp"); std::fs::create_dir_all(&tmp)?;
            let prompt_file = s.scratch.join("prompt.md");
            std::fs::write(&prompt_file, format!("{}\n\n## This task\n\n{}\n", s.brief, s.prompt))?;
            let mut c = timeout_wrapped(s.timeout_secs, "muse");
            c.arg("exec").arg("--json").arg("--workspace").arg(s.cwd).arg("--model").arg(&s.route.model).arg("--effort").arg(&s.route.effort)
                .arg("--no-session-log").arg("--no-foreign-personal-context").arg("--disable-shell").arg("--disable-write").arg("--disable-web-tools").arg("--disable-reminders")
                .arg("--approval-mode").arg("never").arg("--max-model-steps").arg(s.max_turns.to_string())
                .arg("-c").arg(format!("mcp_servers.{mcp_name}={}", serde_json::json!({ "url": s.mcp_url, "transport": "streamable_http" })))
                .arg("--prompt-file").arg(&prompt_file);
            for i in s.images { c.arg("--image").arg(i); }
            c.current_dir(s.cwd).env_clear().env("HOME", user_home()).env("PATH", executable_path()).env("LANG", "C.UTF-8").env("TMPDIR", &tmp);
            Ok(Prepared { command: c, stdin: None, provider: Provider::Muse, label: "muse-cli-subscription".into() })
        }
        Provider::Antigravity => {
            let home = s.scratch.join("agy-home"); let ws = s.cwd.to_path_buf();
            std::fs::create_dir_all(home.join(".gemini/config"))?; std::fs::create_dir_all(home.join(".gemini/antigravity-cli"))?;
            let tok = home.join(".gemini/antigravity-cli/antigravity-oauth-token");
            if !tok.exists() { std::os::unix::fs::symlink(user_home().join(".gemini/antigravity-cli/antigravity-oauth-token"), &tok)?; }
            let task = s.scratch.join("task.md");
            std::fs::write(&task, format!("{}\n\n## This task\n\n{}\n", s.brief, s.prompt))?;
            std::fs::write(home.join(".gemini/config/mcp_config.json"), serde_json::json!({ "mcpServers": { mcp_name: { "serverUrl": s.mcp_url } } }).to_string())?;
            let allow: Vec<String> = std::iter::once(format!("read_file({})", task.display())).chain(s.tool_names.iter().map(|t| format!("mcp({mcp_name}/{t})"))).collect();
            std::fs::write(home.join(".gemini/antigravity-cli/settings.json"), serde_json::json!({ "trustedWorkspaces": [ws], "permissions": { "allow": allow, "deny": ["command(*)", "write_file(/)"] } }).to_string())?;
            let mut c = timeout_wrapped(s.timeout_secs, "agy");
            c.arg("--model").arg(&s.route.model).arg("--effort").arg(&s.route.effort).arg("--output-format").arg("json").arg("-p").arg(format!("Read {} first: it holds your operating brief and this task. Follow it exactly, using only the {mcp_name} tools.", task.display()));
            c.current_dir(s.cwd).env_clear().env("HOME", &home).env("PATH", executable_path()).env("LANG", "C.UTF-8");
            Ok(Prepared { command: c, stdin: None, provider: Provider::Antigravity, label: "antigravity-cli-subscription".into() })
        }
        other => anyhow::bail!("provider {other:?} has no runner on this host yet; owner-selected routes to it fail explicitly rather than substituting"),
    }
}

pub fn binary_available(p: Provider) -> bool {
    let name = match p { Provider::Claude => "claude", Provider::Codex => "codex", Provider::Muse => "muse", Provider::Antigravity => "agy", Provider::Ollama => "ollama", Provider::OpenCode => "opencode", Provider::Grok => "grok", Provider::Gemini => "gemini", Provider::Cursor => "agent" };
    executable_path().split(':').any(|d| Path::new(d).join(name).exists()) && !matches!(p, Provider::Gemini | Provider::Cursor)
}
