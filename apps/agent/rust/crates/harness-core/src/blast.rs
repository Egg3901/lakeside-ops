//! Blast radius classes. The Rust twin of `lib/operator/blastradius.js`;
//! the two must agree on every input, and the shadow proves it.
//!
//! Owner rulings (2026-10-14): no simulation gate; economy and turn-worker
//! promotions to the main server run only in the owner's waking hours, on an
//! approval under three hours old, or on an explicit night pass. Inherited
//! merge consent is not awake evidence (ticket 1498).

use chrono::{DateTime, Datelike, NaiveDate, TimeZone, Timelike, Utc, Weekday};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BlastClass {
    Copy,
    Logic,
    Economy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Classification {
    pub class: BlastClass,
    pub reasons: Vec<String>,
}

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("static regex"))
}
static ECONOMY: OnceLock<Regex> = OnceLock::new();
static WORKER: OnceLock<Regex> = OnceLock::new();
static DISPLAY: OnceLock<Regex> = OnceLock::new();
static TEST: OnceLock<Regex> = OnceLock::new();
static NIGHT: OnceLock<Regex> = OnceLock::new();

pub fn economy_path(f: &str) -> bool {
    re(&ECONOMY, r"^src/lib/(turn|market|economy|banking|indexFunds|ledger|currency|budget|financialTxLog|corporations/(commands|queries/sector))/").is_match(f)
        || re(&WORKER, r"^(?:scripts/turn|src/worker|railway\.worker\.toml$|src/lib/turnWorker)").is_match(f)
}
fn display_path(f: &str) -> bool {
    // The Rust regex crate has no look-around, so the route-handler exclusion is explicit.
    if f.starts_with("src/app/api/") { return false; }
    re(&DISPLAY, r"^(?:src/app/.*\.(?:tsx|css)$|src/components/.*\.(?:tsx|css)$|public/|messages/|content/|[^/]*\.md$)").is_match(f)
}
fn test_path(f: &str) -> bool {
    re(&TEST, r"(?:\.test\.[cm]?[jt]sx?$|^e2e/|^__tests__/|/__tests__/)").is_match(f)
}

/// `None` means the file list was unavailable: that is the class that asks.
pub fn classify(files: Option<&[String]>) -> Classification {
    let Some(files) = files else {
        return Classification { class: BlastClass::Economy, reasons: vec!["file list unavailable".into()] };
    };
    let code: Vec<&String> = files.iter().filter(|f| !test_path(f)).collect();
    let economy: Vec<String> = code.iter().filter(|f| economy_path(f)).map(|f| f.to_string()).collect();
    if !economy.is_empty() {
        return Classification { class: BlastClass::Economy, reasons: economy.into_iter().take(8).collect() };
    }
    if !code.is_empty() && code.iter().all(|f| display_path(f)) {
        return Classification { class: BlastClass::Copy, reasons: vec!["pages, components, styles or text only".into()] };
    }
    Classification { class: BlastClass::Logic, reasons: code.iter().filter(|f| !display_path(f)).map(|f| f.to_string()).take(8).collect() }
}

/// US Eastern offset in hours for a UTC instant: DST (UTC-4) from the second
/// Sunday of March 02:00 local to the first Sunday of November 02:00 local.
pub fn eastern_offset_hours(utc: DateTime<Utc>) -> i32 {
    let year = utc.year();
    let nth_sunday = |month: u32, n: u32| -> NaiveDate {
        let first = NaiveDate::from_ymd_opt(year, month, 1).expect("date");
        let shift = (Weekday::Sun.num_days_from_sunday() + 7 - first.weekday().num_days_from_sunday()) % 7;
        first + chrono::Duration::days((shift + 7 * (n - 1)) as i64)
    };
    // Transitions happen at 02:00 local, which is 07:00 UTC (standard) and 06:00 UTC (daylight).
    let dst_start = Utc.from_utc_datetime(&nth_sunday(3, 2).and_hms_opt(7, 0, 0).expect("time"));
    let dst_end = Utc.from_utc_datetime(&nth_sunday(11, 1).and_hms_opt(6, 0, 0).expect("time"));
    if utc >= dst_start && utc < dst_end { -4 } else { -5 }
}

pub fn eastern_hour(utc_ms: i64) -> u32 {
    let utc = Utc.timestamp_millis_opt(utc_ms).single().expect("timestamp");
    let local = utc + chrono::Duration::hours(eastern_offset_hours(utc) as i64);
    local.hour()
}

#[derive(Debug, Clone, Copy)]
pub struct Window {
    pub start: u32,
    pub end: u32,
}
impl Default for Window {
    fn default() -> Self { Window { start: 9, end: 23 } }
}

pub fn in_awake_window(now_ms: i64, w: Window) -> bool {
    let h = eastern_hour(now_ms);
    h >= w.start && h < w.end
}

/// Next top-of-hour at or after `now_ms` that is inside the window.
pub fn next_window_open(now_ms: i64, w: Window) -> i64 {
    let hour = 3_600_000;
    let mut t = now_ms - now_ms.rem_euclid(hour) + hour;
    for _ in 0..48 {
        if in_awake_window(t, w) { return t; }
        t += hour;
    }
    now_ms + hour
}

pub fn has_night_pass(text: &str) -> bool {
    re(&NIGHT, r"(?i)\bnight pass\b|\bship (?:it )?(?:tonight|now|overnight)\b|\bpromote (?:it )?(?:tonight|now|overnight)\b|\bgo (?:now|tonight|overnight)\b|\bdon'?t wait for (?:morning|me)\b").is_match(text)
}

pub const FRESH_APPROVAL_MS: i64 = 3 * 3_600_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GateVerdict {
    pub allowed: bool,
    pub class: BlastClass,
    pub reason: String,
    pub resume_at: Option<i64>,
}

pub struct GateInput<'a> {
    pub class: BlastClass,
    pub to: &'a str,
    pub now_ms: i64,
    pub last_owner_approval_at: Option<i64>,
    pub night_pass: bool,
    pub window: Window,
}

pub fn promotion_gate(i: GateInput<'_>) -> GateVerdict {
    let ok = |reason: &str| GateVerdict { allowed: true, class: i.class, reason: reason.into(), resume_at: None };
    if i.class != BlastClass::Economy || i.to != "main" {
        return ok(if i.class == BlastClass::Copy { "copy and display fast lane" } else { "not an economy promotion to main" });
    }
    if i.night_pass { return ok("owner granted a night pass for this change"); }
    if in_awake_window(i.now_ms, i.window) { return ok("inside the owner-awake window"); }
    if let Some(at) = i.last_owner_approval_at {
        if at > 0 && i.now_ms - at <= FRESH_APPROVAL_MS { return ok("owner approved this head within the last three hours"); }
    }
    GateVerdict {
        allowed: false,
        class: i.class,
        reason: "economy or turn-worker change outside the owner-awake window with no fresh approval and no night pass".into(),
        resume_at: Some(next_window_open(i.now_ms, i.window)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn s(v: &[&str]) -> Vec<String> { v.iter().map(|x| x.to_string()).collect() }
    fn t(iso: &str) -> i64 { DateTime::parse_from_rfc3339(iso).unwrap().timestamp_millis() }

    #[test]
    fn files_decide_the_class() {
        assert_eq!(classify(Some(&s(&["src/app/corporation/[id]/page.tsx", "src/components/Card.tsx", "README.md"]))).class, BlastClass::Copy);
        assert_eq!(classify(Some(&s(&["src/app/api/budget/route.ts"]))).class, BlastClass::Logic);
        assert_eq!(classify(Some(&s(&["src/lib/market/clearing.ts", "src/app/market/page.tsx"]))).class, BlastClass::Economy);
        assert_eq!(classify(Some(&s(&["railway.worker.toml"]))).class, BlastClass::Economy);
        assert_eq!(classify(Some(&s(&["src/lib/market/clearing.test.ts"]))).class, BlastClass::Logic);
        assert_eq!(classify(None).class, BlastClass::Economy);
    }

    /// The same fixture the Node test reads (`test/fixtures/blast-cases.json`):
    /// the two classifiers must agree on every case.
    #[test]
    fn agrees_with_the_node_twin_on_the_shared_fixture() {
        let cases: Vec<serde_json::Value> = serde_json::from_str(include_str!("../../../../test/fixtures/blast-cases.json")).unwrap();
        for c in cases {
            let files: Option<Vec<String>> = c["files"].as_array().map(|a| a.iter().map(|f| f.as_str().unwrap().to_string()).collect());
            let got = serde_json::to_value(classify(files.as_deref()).class).unwrap();
            assert_eq!(got, c["class"], "files {:?}", files);
        }
    }

    #[test]
    fn eastern_clock() {
        assert_eq!(eastern_offset_hours(DateTime::parse_from_rfc3339("2026-10-14T06:00:00Z").unwrap().into()), -4);
        assert_eq!(eastern_offset_hours(DateTime::parse_from_rfc3339("2026-12-14T06:00:00Z").unwrap().into()), -5);
        assert_eq!(eastern_offset_hours(DateTime::parse_from_rfc3339("2026-03-08T06:59:00Z").unwrap().into()), -5, "just before the March switch");
        assert_eq!(eastern_offset_hours(DateTime::parse_from_rfc3339("2026-03-08T07:01:00Z").unwrap().into()), -4);
        assert_eq!(eastern_hour(t("2026-10-14T06:00:00Z")), 2);
        assert_eq!(eastern_hour(t("2026-10-14T18:00:00Z")), 14);
    }

    #[test]
    fn gate_matches_the_node_twin() {
        let night = t("2026-10-14T06:00:00Z");
        let day = t("2026-10-14T18:00:00Z");
        assert!(!in_awake_window(night, Window::default()));
        assert!(in_awake_window(day, Window::default()));
        assert_eq!(next_window_open(night, Window::default()), t("2026-10-14T13:00:00Z"));
        let g = |class, to, now, appr: Option<i64>, np| promotion_gate(GateInput { class, to, now_ms: now, last_owner_approval_at: appr, night_pass: np, window: Window::default() });
        let held = g(BlastClass::Economy, "main", night, Some(night - 5 * 3_600_000), false);
        assert!(!held.allowed);
        assert_eq!(held.resume_at, Some(t("2026-10-14T13:00:00Z")));
        assert!(g(BlastClass::Economy, "main", night, Some(night - 3_600_000), false).allowed);
        assert!(g(BlastClass::Economy, "main", night, None, true).allowed);
        assert!(g(BlastClass::Economy, "main", day, None, false).allowed);
        assert!(g(BlastClass::Economy, "staging", night, None, false).allowed);
        assert!(g(BlastClass::Copy, "main", night, None, false).allowed);
        assert!(has_night_pass("looks good, ship it tonight"));
        assert!(!has_night_pass("approve"));
    }
}
