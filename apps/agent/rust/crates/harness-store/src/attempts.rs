//! Tasks, attempts and trace events for runner-driven work (general Lakeside
//! tasks and, later, Keir tickets). Separate tables from the shadow's; same
//! `harness.db` file and one-writer rule.

use harness_core::routing::Route;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::path::Path;
use std::str::FromStr;

pub struct AttemptStore { pool: SqlitePool }

impl AttemptStore {
    pub async fn open(path: &Path) -> anyhow::Result<Self> {
        if let Some(dir) = path.parent() { std::fs::create_dir_all(dir)?; }
        let opts = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.display()))?.create_if_missing(true).journal_mode(sqlx::sqlite::SqliteJournalMode::Wal).busy_timeout(std::time::Duration::from_secs(10));
        let pool = SqlitePoolOptions::new().max_connections(1).connect_with(opts).await?;
        sqlx::query(r#"
            CREATE TABLE IF NOT EXISTS h_tasks (id TEXT PRIMARY KEY, kind TEXT NOT NULL, project TEXT, role TEXT, parent TEXT, requester TEXT, created_at INTEGER NOT NULL, state TEXT NOT NULL, spec TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS h_attempts (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, provider TEXT, model TEXT, effort TEXT, label TEXT, started_at INTEGER NOT NULL, ended_at INTEGER,
                exit_code INTEGER, timed_out INTEGER, quota_hold TEXT, result TEXT, usage TEXT, tool_calls INTEGER, events INTEGER, duration_ms INTEGER, final_text TEXT, stderr_tail TEXT);
            CREATE INDEX IF NOT EXISTS h_attempts_task ON h_attempts(task_id, started_at);
            CREATE TABLE IF NOT EXISTS attempt_events (id INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id TEXT NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS attempt_events_attempt ON attempt_events(attempt_id, seq);
        "#).execute(&pool).await?;
        Ok(AttemptStore { pool })
    }

    pub async fn create_task(&self, id: &str, kind: &str, project: &str, role: &str, parent: Option<&str>, requester: Option<&str>, spec: &serde_json::Value, now: i64) -> anyhow::Result<()> {
        sqlx::query("INSERT OR IGNORE INTO h_tasks (id, kind, project, role, parent, requester, created_at, state, spec) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)")
            .bind(id).bind(kind).bind(project).bind(role).bind(parent).bind(requester).bind(now).bind(spec.to_string()).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn set_task_state(&self, id: &str, state: &str) -> anyhow::Result<()> {
        sqlx::query("UPDATE h_tasks SET state = ? WHERE id = ?").bind(state).bind(id).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn start_attempt(&self, task_id: &str, attempt_id: &str, route: &Route, label: &str, started_at: i64) -> anyhow::Result<()> {
        sqlx::query("INSERT INTO h_attempts (id, task_id, provider, model, effort, label, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(attempt_id).bind(task_id).bind(format!("{:?}", route.provider).to_lowercase()).bind(&route.model).bind(&route.effort).bind(label).bind(started_at).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn append_event(&self, attempt_id: &str, seq: i64, at: i64, kind: &str, payload: &serde_json::Value) -> anyhow::Result<()> {
        sqlx::query("INSERT INTO attempt_events (attempt_id, seq, at, kind, payload) VALUES (?, ?, ?, ?, ?)")
            .bind(attempt_id).bind(seq).bind(at).bind(kind).bind(payload.to_string().chars().take(40_000).collect::<String>()).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn finish_attempt(&self, attempt_id: &str, o: &impl serde::Serialize) -> anyhow::Result<()> {
        let v = serde_json::to_value(o)?;
        sqlx::query("UPDATE h_attempts SET ended_at = ?, exit_code = ?, timed_out = ?, quota_hold = ?, result = ?, usage = ?, tool_calls = ?, events = ?, duration_ms = ?, final_text = ?, stderr_tail = ? WHERE id = ?")
            .bind(chrono::Utc::now().timestamp_millis()).bind(v["exit_code"].as_i64()).bind(v["timed_out"].as_bool().unwrap_or(false) as i64).bind(v["quota_hold"].as_str())
            .bind(v.get("result").filter(|r| !r.is_null()).map(|r| r.to_string())).bind(v["usage"].to_string()).bind(v["tool_calls"].as_array().map(|a| a.len() as i64).unwrap_or(0))
            .bind(v["events"].as_i64()).bind(v["duration_ms"].as_i64()).bind(v["final_text"].as_str().map(|s| s.chars().take(20_000).collect::<String>())).bind(v["stderr_tail"].as_str())
            .bind(attempt_id).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn get_task(&self, id: &str) -> anyhow::Result<Option<serde_json::Value>> {
        let Some(r) = sqlx::query("SELECT id, kind, project, role, parent, state, spec FROM h_tasks WHERE id = ?").bind(id).fetch_optional(&self.pool).await? else { return Ok(None) };
        Ok(Some(serde_json::json!({ "id": r.get::<String, _>("id"), "kind": r.get::<String, _>("kind"), "project": r.get::<Option<String>, _>("project"), "role": r.get::<Option<String>, _>("role"), "parent": r.get::<Option<String>, _>("parent"), "state": r.get::<String, _>("state"), "spec": serde_json::from_str::<serde_json::Value>(&r.get::<String, _>("spec")).unwrap_or(serde_json::Value::Null) })))
    }

    pub async fn list_tasks(&self, limit: i64) -> anyhow::Result<Vec<serde_json::Value>> {
        let rows = sqlx::query("SELECT t.id, t.kind, t.project, t.role, t.state, t.created_at, (SELECT count(*) FROM h_attempts a WHERE a.task_id = t.id) AS attempts FROM h_tasks t ORDER BY t.created_at DESC LIMIT ?").bind(limit).fetch_all(&self.pool).await?;
        Ok(rows.iter().map(|r| serde_json::json!({ "id": r.get::<String, _>("id"), "kind": r.get::<String, _>("kind"), "project": r.get::<Option<String>, _>("project"), "role": r.get::<Option<String>, _>("role"), "state": r.get::<String, _>("state"), "created_at": r.get::<i64, _>("created_at"), "attempts": r.get::<i64, _>("attempts") })).collect())
    }

    pub async fn show_attempt(&self, attempt_id: &str) -> anyhow::Result<Option<serde_json::Value>> {
        let Some(r) = sqlx::query("SELECT * FROM h_attempts WHERE id = ?").bind(attempt_id).fetch_optional(&self.pool).await? else { return Ok(None) };
        let events = sqlx::query("SELECT seq, at, kind, payload FROM attempt_events WHERE attempt_id = ? ORDER BY seq").bind(attempt_id).fetch_all(&self.pool).await?;
        Ok(Some(serde_json::json!({
            "id": r.get::<String, _>("id"), "task_id": r.get::<String, _>("task_id"), "provider": r.get::<Option<String>, _>("provider"), "model": r.get::<Option<String>, _>("model"), "label": r.get::<Option<String>, _>("label"),
            "started_at": r.get::<i64, _>("started_at"), "ended_at": r.get::<Option<i64>, _>("ended_at"), "exit_code": r.get::<Option<i64>, _>("exit_code"), "timed_out": r.get::<Option<i64>, _>("timed_out"),
            "quota_hold": r.get::<Option<String>, _>("quota_hold"), "result": r.get::<Option<String>, _>("result").and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()),
            "usage": r.get::<Option<String>, _>("usage").and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()), "tool_calls": r.get::<Option<i64>, _>("tool_calls"), "duration_ms": r.get::<Option<i64>, _>("duration_ms"),
            "final_text": r.get::<Option<String>, _>("final_text"), "stderr_tail": r.get::<Option<String>, _>("stderr_tail"),
            "events": events.iter().map(|e| serde_json::json!({ "seq": e.get::<i64, _>("seq"), "at": e.get::<i64, _>("at"), "kind": e.get::<String, _>("kind"), "payload": serde_json::from_str::<serde_json::Value>(&e.get::<String, _>("payload")).unwrap_or(serde_json::Value::Null) })).collect::<Vec<_>>(),
        })))
    }
}
