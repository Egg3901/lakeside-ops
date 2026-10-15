//! The Node event sink, read-only. Schema owned by `lib/operator/events.js`.

use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: i64,
    pub at: i64,
    pub kind: String,
    pub task_id: Option<String>,
    pub attempt_id: Option<String>,
    pub ticket: Option<u32>,
    pub actor: Option<String>,
    pub release: Option<String>,
    pub payload: serde_json::Value,
}

pub struct EventReader { pool: SqlitePool }

impl EventReader {
    pub async fn open(path: &Path) -> anyhow::Result<Self> {
        let opts = SqliteConnectOptions::new().filename(path).read_only(true).create_if_missing(false);
        let pool = SqlitePoolOptions::new().max_connections(2).connect_with(opts).await?;
        Ok(EventReader { pool })
    }

    pub async fn count(&self) -> anyhow::Result<i64> {
        Ok(sqlx::query("SELECT count(*) AS n FROM events").fetch_one(&self.pool).await?.get::<i64, _>("n"))
    }

    pub async fn since(&self, at: i64, limit: i64) -> anyhow::Result<Vec<Event>> {
        let rows = sqlx::query("SELECT id, at, kind, task_id, attempt_id, ticket, actor, release, payload FROM events WHERE at >= ? ORDER BY id ASC LIMIT ?")
            .bind(at).bind(limit).fetch_all(&self.pool).await?;
        Ok(rows.iter().map(|r| Event {
            id: r.get("id"), at: r.get("at"), kind: r.get("kind"), task_id: r.get("task_id"), attempt_id: r.get("attempt_id"),
            ticket: r.get::<Option<i64>, _>("ticket").map(|t| t as u32), actor: r.get("actor"), release: r.get("release"),
            payload: serde_json::from_str(r.get::<String, _>("payload").as_str()).unwrap_or(serde_json::Value::Null),
        }).collect())
    }

    pub async fn by_kind(&self, kind: &str, limit: i64) -> anyhow::Result<Vec<Event>> {
        let rows = sqlx::query("SELECT id, at, kind, task_id, attempt_id, ticket, actor, release, payload FROM events WHERE kind = ? ORDER BY id DESC LIMIT ?")
            .bind(kind).bind(limit).fetch_all(&self.pool).await?;
        Ok(rows.iter().map(|r| Event {
            id: r.get("id"), at: r.get("at"), kind: r.get("kind"), task_id: r.get("task_id"), attempt_id: r.get("attempt_id"),
            ticket: r.get::<Option<i64>, _>("ticket").map(|t| t as u32), actor: r.get("actor"), release: r.get("release"),
            payload: serde_json::from_str(r.get::<String, _>("payload").as_str()).unwrap_or(serde_json::Value::Null),
        }).collect())
    }

    pub async fn kinds(&self) -> anyhow::Result<Vec<(String, i64)>> {
        let rows = sqlx::query("SELECT kind, count(*) AS n FROM events GROUP BY kind ORDER BY n DESC").fetch_all(&self.pool).await?;
        Ok(rows.iter().map(|r| (r.get::<String, _>("kind"), r.get::<i64, _>("n"))).collect())
    }
}
