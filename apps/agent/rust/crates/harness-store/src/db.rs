//! The harness's own SQLite. One writer (whichever harness process owns the
//! file), WAL, append-only tables. Labels are never rewritten: a later
//! evaluation appends a new row.

use harness_core::outcome::LabelEvent;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::path::Path;
use std::str::FromStr;

pub struct HarnessDb { pool: SqlitePool }

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Comparison {
    pub at: i64,
    pub kind: String,
    pub subject: String,
    pub rust: String,
    pub node: String,
    pub agree: bool,
    pub note: String,
}

impl HarnessDb {
    pub async fn open(path: &Path) -> anyhow::Result<Self> {
        if let Some(dir) = path.parent() { std::fs::create_dir_all(dir)?; }
        let opts = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.display()))?.create_if_missing(true).journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);
        let pool = SqlitePoolOptions::new().max_connections(1).connect_with(opts).await?;
        sqlx::query(r#"
            CREATE TABLE IF NOT EXISTS shadow_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, release TEXT, report TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS labels (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket INTEGER NOT NULL, label TEXT NOT NULL, policy_version TEXT NOT NULL,
                evaluated_at INTEGER NOT NULL, window_end INTEGER, provisional INTEGER NOT NULL, keir_attributed INTEGER NOT NULL, evidence TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS labels_ticket ON labels(ticket, evaluated_at);
            CREATE TABLE IF NOT EXISTS comparisons (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL,
                rust TEXT NOT NULL, node TEXT NOT NULL, agree INTEGER NOT NULL, note TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS comparisons_kind ON comparisons(kind, at);
        "#).execute(&pool).await?;
        Ok(HarnessDb { pool })
    }

    pub async fn record_run(&self, at: i64, release: Option<&str>, report: &serde_json::Value) -> anyhow::Result<i64> {
        let r = sqlx::query("INSERT INTO shadow_runs (at, release, report) VALUES (?, ?, ?)").bind(at).bind(release).bind(report.to_string()).execute(&self.pool).await?;
        Ok(r.last_insert_rowid())
    }

    /// Append a label only when it differs from the ticket's latest one, so
    /// the table reads as a history of changes.
    pub async fn record_label(&self, l: &LabelEvent) -> anyhow::Result<bool> {
        let label = serde_json::to_string(&l.label)?.trim_matches('"').to_string();
        let last: Option<String> = sqlx::query("SELECT label FROM labels WHERE ticket = ? ORDER BY id DESC LIMIT 1").bind(l.ticket as i64).fetch_optional(&self.pool).await?.map(|r| r.get("label"));
        if last.as_deref() == Some(label.as_str()) { return Ok(false); }
        sqlx::query("INSERT INTO labels (ticket, label, policy_version, evaluated_at, window_end, provisional, keir_attributed, evidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(l.ticket as i64).bind(&label).bind(&l.policy_version).bind(l.evaluated_at).bind(l.window_end).bind(l.provisional as i64).bind(l.keir_attributed as i64).bind(serde_json::to_string(&l.evidence)?)
            .execute(&self.pool).await?;
        Ok(true)
    }

    pub async fn record_comparison(&self, c: &Comparison) -> anyhow::Result<()> {
        sqlx::query("INSERT INTO comparisons (at, kind, subject, rust, node, agree, note) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(c.at).bind(&c.kind).bind(&c.subject).bind(&c.rust).bind(&c.node).bind(c.agree as i64).bind(&c.note).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn agreement(&self, since: i64) -> anyhow::Result<Vec<(String, i64, i64)>> {
        let rows = sqlx::query("SELECT kind, sum(agree) AS agreed, count(*) AS total FROM comparisons WHERE at >= ? GROUP BY kind").bind(since).fetch_all(&self.pool).await?;
        Ok(rows.iter().map(|r| (r.get::<String, _>("kind"), r.get::<i64, _>("agreed"), r.get::<i64, _>("total"))).collect())
    }

    pub async fn label_history(&self, ticket: u32) -> anyhow::Result<Vec<(String, i64)>> {
        let rows = sqlx::query("SELECT label, evaluated_at FROM labels WHERE ticket = ? ORDER BY id").bind(ticket as i64).fetch_all(&self.pool).await?;
        Ok(rows.iter().map(|r| (r.get::<String, _>("label"), r.get::<i64, _>("evaluated_at"))).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use harness_core::outcome::{Label, POLICY_VERSION};

    #[tokio::test]
    async fn labels_append_only_on_change() {
        let dir = std::env::temp_dir().join(format!("harness-db-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let db = HarnessDb::open(&dir.join("harness.db")).await.unwrap();
        let mk = |label, at| LabelEvent { ticket: 7, label, policy_version: POLICY_VERSION.into(), evaluated_at: at, window_end: None, provisional: true, evidence: vec![], keir_attributed: false };
        assert!(db.record_label(&mk(Label::ClosedObserving, 1)).await.unwrap());
        assert!(!db.record_label(&mk(Label::ClosedObserving, 2)).await.unwrap(), "same label is not re-recorded");
        assert!(db.record_label(&mk(Label::Reopened, 3)).await.unwrap());
        assert_eq!(db.label_history(7).await.unwrap().len(), 2);
        db.record_comparison(&Comparison { at: 1, kind: "card-stage".into(), subject: "1514".into(), rust: "ok".into(), node: "ok".into(), agree: true, note: String::new() }).await.unwrap();
        assert_eq!(db.agreement(0).await.unwrap(), vec![("card-stage".to_string(), 1, 1)]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
