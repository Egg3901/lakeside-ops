//! Status truth: what a ticket may be told, derived from receipts only.
//! Twin of `release.js` (`ticketReleaseState`), `publisher.js` (`derivePhase`)
//! and the `outcomeClaims` kinds in `broker.js`. A later fact across a
//! missing earlier gate is an inconsistency, never a shortcut.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

pub const TICKET_STAGES: [&str; 9] = ["prepared", "in-pr", "ci-green", "development", "staging", "main", "deployed-web", "deployed-worker", "live-verified"];

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReleaseFacts {
    pub prepared: bool,
    pub in_pr: bool,
    pub ci_green: bool,
    pub on_development: bool,
    pub on_staging: bool,
    pub on_main: bool,
    pub web_deployed: bool,
    pub worker_deployed: bool,
    pub live_verified: bool,
}

impl ReleaseFacts {
    fn as_array(&self) -> [bool; 9] {
        [self.prepared, self.in_pr, self.ci_green, self.on_development, self.on_staging, self.on_main, self.web_deployed, self.worker_deployed, self.live_verified]
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReleaseState {
    pub stage: String,
    pub next_gate: Option<String>,
    pub inconsistent: bool,
    pub player_label: String,
    pub can_claim_live: bool,
}

pub fn release_state(f: &ReleaseFacts) -> ReleaseState {
    let a = f.as_array();
    let mut stage: Option<usize> = None;
    let mut gap: Option<usize> = None;
    for (i, v) in a.iter().enumerate() {
        if *v {
            if gap.is_none() { stage = Some(i); }
        } else if gap.is_none() {
            gap = Some(i);
        }
    }
    let inconsistent = match gap { Some(g) => a[g + 1..].iter().any(|v| *v), None => false };
    let label = |s: &str| match s {
        "prepared" | "in-pr" => "being prepared",
        "ci-green" | "development" | "staging" => "in testing",
        "main" | "deployed-web" | "deployed-worker" => "being released",
        "live-verified" => "live",
        _ => "being looked at",
    };
    let stage_name = stage.map(|i| TICKET_STAGES[i]).unwrap_or("none");
    ReleaseState {
        stage: stage_name.into(),
        next_gate: gap.map(|g| TICKET_STAGES[g].to_string()),
        inconsistent,
        player_label: label(stage_name).into(),
        can_claim_live: stage_name == "live-verified" && !inconsistent,
    }
}

/// Status card stages (`statuscard.js`): the receipt each needs.
pub fn card_stage_allowed(stage: &str, dev: bool, staging: bool, main: bool) -> Result<(), String> {
    match stage {
        "found" | "written" => Ok(()),
        "tested" if dev => Ok(()),
        "tested" => Err("\"Tested\" needs the fix on development".into()),
        "sandbox" if staging => Ok(()),
        "sandbox" => Err("\"On the sandbox\" needs the fix on staging".into()),
        "main" | "confirmed" if main => Ok(()),
        "main" | "confirmed" => Err("\"Live on the main server\" needs the fix on main".into()),
        other => Err(format!("unknown stage \"{other}\"")),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    Accepted,
    Investigating,
    Preparing,
    Testing,
    Releasing,
    Verifying,
    Live,
    Waiting,
    Blocked,
    StaffOwned,
    Closed,
}

pub struct RecordView<'a> {
    pub state: &'a str,
    pub next_action: &'a str,
    pub staff_claimed: bool,
    pub attempts: usize,
}

pub fn derive_phase(r: &RecordView<'_>, facts: &ReleaseFacts) -> Phase {
    let rel = release_state(facts);
    let closed = matches!(r.state, "resolved" | "cancelled" | "closed-externally" | "terminal");
    if closed { return if rel.can_claim_live { Phase::Live } else { Phase::Closed }; }
    if r.staff_claimed { return Phase::StaffOwned; }
    if rel.can_claim_live { return Phase::Live; }
    if r.state == "blocked" || r.next_action == "blocked" { return Phase::Blocked; }
    match rel.stage.as_str() {
        "prepared" | "in-pr" => return Phase::Preparing,
        "ci-green" | "development" | "staging" => return Phase::Testing,
        "main" => return Phase::Releasing,
        "deployed-web" | "deployed-worker" => return Phase::Verifying,
        _ => {}
    }
    if r.next_action == "awaiting-ci" || r.next_action == "awaiting-event" { return Phase::Waiting; }
    if r.attempts == 0 && r.next_action == "attempt" { return Phase::Accepted; }
    Phase::Investigating
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClaimKind {
    Money,
    Reverted,
    Main,
    Staging,
    Development,
    Building,
    Written,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Claim {
    pub kind: ClaimKind,
    pub future: bool,
    pub sentence: String,
}

static CLAIMS: OnceLock<Vec<(ClaimKind, Regex)>> = OnceLock::new();
static FUTURE: OnceLock<Regex> = OnceLock::new();
static NEGATED: OnceLock<Regex> = OnceLock::new();
static SPLIT: OnceLock<Regex> = OnceLock::new();

fn claims() -> &'static Vec<(ClaimKind, Regex)> {
    CLAIMS.get_or_init(|| {
        let r = |p: &str| Regex::new(&format!("(?i){p}")).expect("claim regex");
        vec![
            (ClaimKind::Money, r(r"\bpaid (?:you |it |them )?back\b|\bpay (?:you |it |them )?back\b|\brepa(?:id|y)\b|\brefund(?:ed)?\b|\breimburs(?:ed|ement)\b|\bcompensat(?:ed|ion)\b|\b(?:paid|credited|returned) (?:to )?(?:you|your)\b|\b(?:you|your \w+) (?:\w+ ){0,3}(?:paid|credited|refunded)\b")),
            (ClaimKind::Reverted, r(r"\b(?:switched|turned|rolled|changed|put) (?:it |that |this |them |those )?back\b|\breverted\b|\bundone\b")),
            (ClaimKind::Main, r(r"\blive on the main server\b|\b(?:is|are|was|were|it's|now) (?:now )?live\b|\bfix(?:es)? (?:is|are) (?:now )?(?:live|out)\b")),
            (ClaimKind::Staging, r(r"\bon (?:the )?sandbox\b")),
            (ClaimKind::Development, r(r"\bin testing on dev\b|\bon (?:the )?dev(?:elopment)? server\b|\bon dev\b")),
            (ClaimKind::Building, r(r"\b(?:fix|correction|patch|change) is (?:now )?(?:being |still being )?(?:built|written|prepared|worked on)\b|\bbeing built\b|\b(?:building|writing|preparing) (?:a |the |that |this )?(?:fix|correction|patch)\b|\bworking on (?:a |the |that |this )?(?:fix|correction|patch)\b")),
            (ClaimKind::Written, r(r"\b(?:fix|correction|patch) (?:is|has been|was) (?:now )?(?:written|ready|built|prepared|done)\b|\bhave (?:a|the) (?:fix|correction) (?:ready|written)\b|\b(?:is|are) (?:now )?in testing\b|\bgoing through (?:its |the )?(?:checks|tests)\b|\bpassed (?:its|the|all its) (?:tests|checks)\b")),
        ]
    })
}

pub fn outcome_claims(text: &str) -> Vec<Claim> {
    let future = FUTURE.get_or_init(|| Regex::new(r"(?i)\b(?:will|won't|once|when|after|until|soon|should|going to|plan(?:ning)?|next|expect|if)\b|['’]ll\b").unwrap());
    let negated = NEGATED.get_or_init(|| Regex::new(r"(?i)\b(?:not|never|no|isn't|aren't|wasn't|weren't|hasn't|haven't|didn't|yet)\b|n['’]t\b").unwrap());
    let split = SPLIT.get_or_init(|| Regex::new(r"[.!?]\s+|\n+").unwrap());
    let mut out = Vec::new();
    for sentence in split.split(text) {
        if sentence.trim().is_empty() || negated.is_match(sentence) { continue; }
        for (kind, re) in claims() {
            if re.is_match(sentence) {
                out.push(Claim { kind: *kind, future: future.is_match(sentence), sentence: sentence.trim().chars().take(160).collect() });
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_state_never_infers_a_gate() {
        let mut f = ReleaseFacts { prepared: true, in_pr: true, ci_green: true, on_development: true, ..Default::default() };
        let s = release_state(&f);
        assert_eq!(s.stage, "development");
        assert_eq!(s.next_gate.as_deref(), Some("staging"));
        assert!(!s.can_claim_live);
        f.on_main = true; // main without staging
        assert!(release_state(&f).inconsistent);
        let live = ReleaseFacts { prepared: true, in_pr: true, ci_green: true, on_development: true, on_staging: true, on_main: true, web_deployed: true, worker_deployed: true, live_verified: true };
        assert!(release_state(&live).can_claim_live);
        assert_eq!(release_state(&ReleaseFacts::default()).player_label, "being looked at");
    }

    #[test]
    fn phases_follow_the_publisher() {
        let r = RecordView { state: "active", next_action: "attempt", staff_claimed: false, attempts: 0 };
        assert_eq!(derive_phase(&r, &ReleaseFacts::default()), Phase::Accepted);
        let r = RecordView { state: "active", next_action: "attempt", staff_claimed: false, attempts: 2 };
        assert_eq!(derive_phase(&r, &ReleaseFacts::default()), Phase::Investigating);
        let r = RecordView { state: "waiting", next_action: "awaiting-ci", staff_claimed: false, attempts: 2 };
        assert_eq!(derive_phase(&r, &ReleaseFacts { prepared: true, in_pr: true, ..Default::default() }), Phase::Preparing);
        let r = RecordView { state: "blocked", next_action: "blocked", staff_claimed: false, attempts: 2 };
        assert_eq!(derive_phase(&r, &ReleaseFacts { prepared: true, in_pr: true, ci_green: true, on_development: true, ..Default::default() }), Phase::Blocked, "a blocker is never hidden behind release progress");
        let r = RecordView { state: "terminal", next_action: "none", staff_claimed: false, attempts: 3 };
        assert_eq!(derive_phase(&r, &ReleaseFacts::default()), Phase::Closed);
    }

    #[test]
    fn claims_match_the_broker_kinds() {
        let c = outcome_claims("The fix is being built now. It will be live on the main server tonight.");
        assert_eq!(c[0].kind, ClaimKind::Building);
        assert!(!c[0].future);
        assert_eq!(c[1].kind, ClaimKind::Main);
        assert!(c[1].future);
        assert!(outcome_claims("It is not live yet.").is_empty());
        // As in the broker: "is prepared" reads as both building and written, and
        // both need their receipt (a written receipt satisfies building too).
        let kinds: Vec<ClaimKind> = outcome_claims("The correction is prepared.").into_iter().map(|c| c.kind).collect();
        assert!(kinds.contains(&ClaimKind::Written) && kinds.contains(&ClaimKind::Building));
        assert!(card_stage_allowed("main", true, true, false).is_err());
        assert!(card_stage_allowed("written", false, false, false).is_ok());
    }
}
