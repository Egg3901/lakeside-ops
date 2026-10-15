//! Owner-selected subagent routing for any Lakeside work.
//!
//! Rules (owner, 2026-10-14): subscriptions only, so every provider is a CLI
//! the harness hosts tools for; an owner-selected route wins over the
//! defaults; an unavailable provider is a clear failure or a wait, never a
//! silent substitution; children cannot widen the parent's grant; player
//! personal data never goes to a training-tier provider unredacted; a task
//! with images never routes to a vision-weak model. Defaults are seeded from
//! the owner's standing directives, not from benchmarks.

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider { Claude, Codex, Muse, Antigravity, Ollama, OpenCode, Grok, Gemini, Cursor }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Capabilities {
    pub vision: bool,
    pub mcp_client: bool,
    pub headless_safe: bool,
    pub resume: bool,
    pub structured_stream: bool,
    pub subscription: bool,
    pub trains_on_data: bool,
}

/// Known on this box as of 2026-10-14. Gemini CLI is dead for individuals,
/// Cursor is unauthenticated. Muse reads images (benchmark 2026-10-14: Wonder
/// Full 31/32, Spark 1.3 32/32, contributor 32/32 at 5 s median) and takes
/// MCP servers over `-c mcp_servers.<name>`; it hangs headless unless approval
/// is off. The Muse contributor tier trains on submitted data per the Meta contract.
pub fn capabilities(p: Provider) -> Capabilities {
    use Provider::*;
    match p {
        Claude => Capabilities { vision: true, mcp_client: true, headless_safe: true, resume: true, structured_stream: true, subscription: true, trains_on_data: false },
        Codex => Capabilities { vision: true, mcp_client: true, headless_safe: true, resume: true, structured_stream: true, subscription: true, trains_on_data: false },
        Muse => Capabilities { vision: true, mcp_client: true, headless_safe: false, resume: false, structured_stream: true, subscription: true, trains_on_data: true },
        Antigravity => Capabilities { vision: true, mcp_client: true, headless_safe: true, resume: false, structured_stream: true, subscription: true, trains_on_data: false },
        Ollama => Capabilities { vision: false, mcp_client: false, headless_safe: true, resume: false, structured_stream: true, subscription: false, trains_on_data: false },
        OpenCode => Capabilities { vision: false, mcp_client: true, headless_safe: true, resume: false, structured_stream: true, subscription: false, trains_on_data: false },
        Grok => Capabilities { vision: false, mcp_client: false, headless_safe: true, resume: false, structured_stream: false, subscription: true, trains_on_data: false },
        Gemini | Cursor => Capabilities { vision: false, mcp_client: false, headless_safe: false, resume: false, structured_stream: false, subscription: true, trains_on_data: false },
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Role { Investigator, Coder, Reviewer, VisionInspector, Researcher, DocWriter, ReleaseVerifier, Conversation }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Route { pub provider: Provider, pub model: String, pub effort: String }

impl Route {
    pub fn new(provider: Provider, model: &str, effort: &str) -> Self { Route { provider, model: model.into(), effort: effort.into() } }
    /// `muse:muse-wonder-full-1.0@medium`, the operator's env format.
    pub fn parse(s: &str) -> Option<Route> {
        let (prov, rest) = s.split_once(':')?;
        let (model, effort) = rest.split_once('@').unwrap_or((rest, "medium"));
        let provider = match prov { "claude" => Provider::Claude, "codex" => Provider::Codex, "muse" => Provider::Muse, "antigravity" | "agy" => Provider::Antigravity, "ollama" => Provider::Ollama, "opencode" => Provider::OpenCode, "grok" => Provider::Grok, "gemini" => Provider::Gemini, "cursor" => Provider::Cursor, _ => return None };
        Some(Route::new(provider, model, effort))
    }
}

/// Owner directives as of 2026-10-14 (`/etc/keir-operator.env` and the
/// standing dispatch policy). Benchmarks recommend changes; they do not make them.
pub fn default_route(role: Role) -> Route {
    match role {
        Role::Investigator => Route::new(Provider::Muse, "muse-wonder-full-1.0", "medium"),
        Role::Coder => Route::new(Provider::Muse, "muse-spark-1.3-contributor", "xhigh"),
        Role::Reviewer => Route::new(Provider::Claude, "claude-sonnet-5-5", "medium"),
        // Owner, 2026-10-14: Spark 1.3 standard (32/32, does not train on data).
        Role::VisionInspector => Route::new(Provider::Muse, "muse-spark-1.3", "medium"),
        Role::Researcher => Route::new(Provider::Codex, "gpt-6.1-sol", "medium"),
        Role::DocWriter => Route::new(Provider::Muse, "muse-wonder-full-1.0", "medium"),
        Role::ReleaseVerifier => Route::new(Provider::Claude, "claude-sonnet-5-5", "medium"),
        Role::Conversation => Route::new(Provider::Codex, "gpt-6.1-sol", "medium"),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Grant { pub read: bool, pub sandbox_write: bool, pub tool_exec: bool, pub external_effects: bool }

impl Grant {
    pub fn read_only() -> Self { Grant { read: true, ..Default::default() } }
    pub fn coding() -> Self { Grant { read: true, sandbox_write: true, tool_exec: true, external_effects: false } }
    pub fn subset_of(&self, parent: &Grant) -> bool {
        (!self.read || parent.read) && (!self.sandbox_write || parent.sandbox_write) && (!self.tool_exec || parent.tool_exec) && (!self.external_effects || parent.external_effects)
    }
}

pub fn default_grant(role: Role) -> Grant {
    match role {
        Role::Coder => Grant::coding(),
        Role::ReleaseVerifier => Grant { read: true, tool_exec: true, ..Default::default() },
        _ => Grant::read_only(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DataClass { PublicCode, PrivateOps, PlayerPersonal }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectProfile {
    pub id: String,
    pub repo_path: String,
    pub default_branch: String,
    pub public: bool,
    pub uses_check_scheduler: bool,
}

/// The registered Lakeside projects. Public repositories never receive
/// private ops or player material in artifacts.
pub fn project(id: &str) -> Option<ProjectProfile> {
    let p = |id: &str, path: &str, branch: &str, public: bool, sched: bool| Some(ProjectProfile { id: id.into(), repo_path: path.into(), default_branch: branch.into(), public, uses_check_scheduler: sched });
    match id {
        "a-house-divided" | "ahd" | "AHDGame" => p("a-house-divided", "/root/projects/AHDGame", "development", true, true),
        "lakeside-operator" | "lakeside-ops" | "keir" => p("lakeside-operator", "/root/projects/lakeside-ops", "main", true, false),
        "ops-dash" | "LSGD-ops-dash" => p("ops-dash", "/root/projects/lakeside-ops", "main", true, false),
        "metroforge" => p("metroforge", "/root/projects/metroforge", "main", false, true),
        "grand-century" => p("grand-century", "/root/projects/grand-century", "main", false, true),
        "ahd-client" => p("ahd-client", "/root/projects/ahd-client", "master", false, false),
        "adhd-bot" => p("adhd-bot", "/root/projects/adhd-bot", "main", false, false),
        _ => None,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteRequest {
    pub project: String,
    pub role: Role,
    /// Owner-selected route. Takes precedence over the role default.
    pub route: Option<Route>,
    pub grant: Option<Grant>,
    pub data_classes: Vec<DataClass>,
    pub has_images: bool,
    pub headless: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ResolvedRoute {
    pub project: ProjectProfile,
    pub role: Role,
    pub route: Route,
    pub grant: Grant,
    pub capabilities: Capabilities,
    pub owner_selected: bool,
    pub notes: Vec<String>,
}

#[derive(Debug, Error, PartialEq, Eq, Serialize, Deserialize)]
pub enum RouteError {
    #[error("unknown project {0}")] UnknownProject(String),
    #[error("provider {0:?} is unavailable; no substitution was made")] Unavailable(Provider),
    #[error("the requested grant widens the parent's grant")] GrantWidening,
    #[error("this task carries images and {0:?} cannot read them")] VisionRequired(Provider),
    #[error("player personal data cannot go to {0:?}, which trains on submitted data")] DataClassDenied(Provider),
    #[error("{0:?} is not safe to run headless on this host")] NotHeadlessSafe(Provider),
}

pub fn resolve_route(req: &RouteRequest, parent_grant: Option<&Grant>, available: &dyn Fn(Provider) -> bool) -> Result<ResolvedRoute, RouteError> {
    let project = project(&req.project).ok_or_else(|| RouteError::UnknownProject(req.project.clone()))?;
    resolve_route_for_project(req, project, parent_grant, available)
}

/// Resolve an explicitly registered project without consulting Lakeside's registry.
/// The same grant and data-class gates apply to external installations.
pub fn resolve_route_for_project(req: &RouteRequest, project: ProjectProfile, parent_grant: Option<&Grant>, available: &dyn Fn(Provider) -> bool) -> Result<ResolvedRoute, RouteError> {
    let owner_selected = req.route.is_some();
    let route = req.route.clone().unwrap_or_else(|| default_route(req.role));
    let caps = capabilities(route.provider);
    let grant = req.grant.unwrap_or_else(|| default_grant(req.role));
    if let Some(parent) = parent_grant { if !grant.subset_of(parent) { return Err(RouteError::GrantWidening); } }
    if req.data_classes.contains(&DataClass::PlayerPersonal) && caps.trains_on_data { return Err(RouteError::DataClassDenied(route.provider)); }
    if req.has_images && !caps.vision { return Err(RouteError::VisionRequired(route.provider)); }
    if !available(route.provider) { return Err(RouteError::Unavailable(route.provider)); }
    let mut notes = Vec::new();
    if req.headless && !caps.headless_safe { notes.push(format!("{:?} needs approval disabled and a trusted workspace to run headless", route.provider)); }
    if !caps.mcp_client { notes.push(format!("{:?} has no MCP client; tools go through the shell bridge", route.provider)); }
    if project.public && req.data_classes.iter().any(|c| *c != DataClass::PublicCode) { notes.push("public project: private ops and player material must not enter artifacts".into()); }
    Ok(ResolvedRoute { project, role: req.role, route, grant, capabilities: caps, owner_selected, notes })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn req(role: Role) -> RouteRequest { RouteRequest { project: "ahd".into(), role, route: None, grant: None, data_classes: vec![DataClass::PublicCode], has_images: false, headless: true } }
    fn all(_: Provider) -> bool { true }

    #[test]
    fn consolidated_sources_keep_aliases_and_public_privacy() {
        for alias in ["keir", "lakeside-operator", "lakeside-ops", "ops-dash", "LSGD-ops-dash"] {
            let source = project(alias).unwrap();
            assert_eq!(source.repo_path, "/root/projects/lakeside-ops");
            assert_eq!(source.default_branch, "main");
            assert!(source.public);
        }
    }

    #[test]
    fn independent_projects_keep_grant_and_privacy_gates() {
        let custom = ProjectProfile { id: "my-service".into(), repo_path: "/home/dev/my-service".into(), default_branch: "trunk".into(), public: false, uses_check_scheduler: false };
        let mut q = req(Role::Coder); q.project = custom.id.clone();
        q.route = Route::parse("claude:my-model@medium");
        let r = resolve_route_for_project(&q, custom.clone(), None, &all).unwrap();
        assert_eq!(r.project, custom);
        assert_eq!(resolve_route_for_project(&q, custom.clone(), Some(&Grant::read_only()), &all).unwrap_err(), RouteError::GrantWidening);
        q.route = Route::parse("muse:my-model@medium"); q.data_classes = vec![DataClass::PlayerPersonal];
        assert_eq!(resolve_route_for_project(&q, custom, None, &all).unwrap_err(), RouteError::DataClassDenied(Provider::Muse));
    }

    #[test]
    fn owner_route_wins_and_unavailable_never_substitutes() {
        let r = resolve_route(&req(Role::Coder), None, &all).unwrap();
        assert_eq!(r.route, Route::new(Provider::Muse, "muse-spark-1.3-contributor", "xhigh"));
        assert!(!r.owner_selected);
        let mut q = req(Role::Coder); q.route = Route::parse("claude:claude-sonnet-5-5@high");
        let r = resolve_route(&q, None, &all).unwrap();
        assert_eq!(r.route.provider, Provider::Claude); assert!(r.owner_selected);
        assert_eq!(resolve_route(&q, None, &|p| p != Provider::Claude).unwrap_err(), RouteError::Unavailable(Provider::Claude));
    }

    #[test]
    fn children_cannot_widen_and_data_classes_gate_training_tier() {
        let mut q = req(Role::Coder); q.grant = Some(Grant::coding());
        assert_eq!(resolve_route(&q, Some(&Grant::read_only()), &all).unwrap_err(), RouteError::GrantWidening);
        let mut q = req(Role::Investigator); q.data_classes = vec![DataClass::PlayerPersonal];
        assert_eq!(resolve_route(&q, None, &all).unwrap_err(), RouteError::DataClassDenied(Provider::Muse));
        q.route = Route::parse("claude:claude-opus-5-5@medium");
        assert!(resolve_route(&q, None, &all).is_ok());
    }

    #[test]
    fn images_never_go_to_a_vision_weak_model() {
        let mut q = req(Role::Investigator); q.has_images = true;
        assert!(resolve_route(&q, None, &all).is_ok(), "Muse reads images (benchmarked 2026-10-14)");
        q.route = Route::parse("grok:grok-build@medium");
        assert_eq!(resolve_route(&q, None, &all).unwrap_err(), RouteError::VisionRequired(Provider::Grok));
        let r = resolve_route(&RouteRequest { role: Role::VisionInspector, ..req(Role::VisionInspector) }, None, &all).unwrap();
        assert!(r.capabilities.vision);
        assert_eq!(resolve_route(&RouteRequest { project: "nope".into(), ..req(Role::Coder) }, None, &all).unwrap_err(), RouteError::UnknownProject("nope".into()));
    }
}
