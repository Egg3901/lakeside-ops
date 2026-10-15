//! Independent installations opt in with --config or LAKESIDE_CONFIG.
use anyhow::{bail, Context};
use harness_core::routing::{ProjectProfile, Route};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    pub state_dir: PathBuf,
    pub projects: Vec<ProjectProfile>,
    pub default_route: String,
    #[serde(default)]
    pub routes: BTreeMap<String, String>,
    #[serde(default)]
    pub available_routes: Vec<String>,
    pub brief_file: Option<PathBuf>,
    pub mcp_config: Option<PathBuf>,
    #[serde(default)]
    pub mcp_read_tools: BTreeMap<String, Vec<String>>,
}

impl Settings {
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        let settings: Self = serde_json::from_str(&std::fs::read_to_string(path)
            .with_context(|| format!("read config {}", path.display()))?)
            .with_context(|| format!("parse config {}", path.display()))?;
        settings.validate()?;
        Ok(settings)
    }

    fn validate(&self) -> anyhow::Result<()> {
        if !self.state_dir.is_absolute() { bail!("state_dir must be absolute"); }
        if Route::parse(&self.default_route).is_none() { bail!("default_route must be provider:model@effort"); }
        for (lane, route) in &self.routes {
            if !["conversation", "coding", "investigation", "coordination"].contains(&lane.as_str()) || Route::parse(route).is_none() { bail!("invalid role route: {}", lane); }
        }
        for route in &self.available_routes { if Route::parse(route).is_none() { bail!("invalid available route"); } }
        if self.projects.is_empty() { bail!("register at least one project"); }
        let mut ids = std::collections::BTreeSet::new();
        for p in &self.projects {
            if p.id.trim().is_empty() || !ids.insert(&p.id) { bail!("project ids must be nonempty and unique"); }
            if !Path::new(&p.repo_path).is_absolute() || !Path::new(&p.repo_path).is_dir() { bail!("project {} repo_path must be an existing absolute directory", p.id); }
            if p.default_branch.trim().is_empty() { bail!("project {} needs default_branch", p.id); }
        }
        for p in [&self.brief_file, &self.mcp_config].into_iter().flatten() {
            if !p.is_absolute() || !p.is_file() { bail!("{} must be an existing absolute file", p.display()); }
        }
        if self.mcp_config.is_none() && !self.mcp_read_tools.is_empty() { bail!("mcp_read_tools requires mcp_config"); }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn settings() -> Settings {
        Settings { state_dir: "/tmp/lakeside".into(), projects: vec![ProjectProfile {
            id: "my-app".into(), repo_path: std::env::temp_dir().to_string_lossy().into_owned(), default_branch: "main".into(), public: false, uses_check_scheduler: false,
        }], default_route: "claude:my-model@medium".into(), routes: BTreeMap::new(), available_routes: Vec::new(), brief_file: None, mcp_config: None, mcp_read_tools: BTreeMap::new() }
    }
    #[test]
    fn validates_independent_registry_without_lakeside_defaults() {
        let mut s = settings(); assert!(s.validate().is_ok());
        s.projects.push(s.projects[0].clone()); assert!(s.validate().is_err());
        s.projects.pop(); s.state_dir = "relative".into(); assert!(s.validate().is_err());
        s.state_dir = "/tmp/state".into(); s.default_route = "typo".into(); assert!(s.validate().is_err());
    }
    #[test]
    fn rejects_unknown_keys_and_incomplete_mcp_setup() {
        assert!(serde_json::from_str::<Settings>(r#"{"state_dir":"/tmp","projects":[],"default_route":"claude:model","typo":true}"#).is_err());
        let mut s = settings(); s.mcp_read_tools.insert("metrics".into(), vec!["health".into()]); assert!(s.validate().is_err());
    }
}
