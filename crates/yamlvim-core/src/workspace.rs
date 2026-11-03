use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};

use crate::config::{parse_config, ConfigError};
use crate::dns::CompiledDns;

const CONTROLLER_KEYS: &[&str] = &[
    "external-controller",
    "external-controller-pipe",
    "external-controller-unix",
    "external-controller-tls",
    "external-controller-cors",
    "secret",
];

/// The current, curated workspace. It is the only source of truth for export;
/// there is no hidden base config. Global settings live in `settings`, while
/// nodes, exits, rules, providers, DNS and hosts are managed sections.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Workspace {
    #[serde(default)]
    pub settings: Mapping,
    #[serde(default)]
    pub proxies: Vec<Value>,
    #[serde(default, rename = "proxy-groups")]
    pub proxy_groups: Vec<Value>,
    #[serde(default)]
    pub rules: Vec<Value>,
    #[serde(default, rename = "rule-providers")]
    pub rule_providers: Mapping,
    #[serde(default, rename = "proxy-providers")]
    pub proxy_providers: Mapping,
    #[serde(default)]
    pub dns: Option<Value>,
    #[serde(default)]
    pub hosts: Mapping,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceView {
    pub settings: Mapping,
    pub nodes: Vec<Value>,
    pub exits: Vec<Value>,
    pub rules: Vec<Value>,
    pub rule_providers: Mapping,
    pub proxy_providers: Mapping,
    pub dns: Option<Value>,
    pub hosts: Mapping,
    pub node_count: usize,
    pub exit_count: usize,
    pub rule_count: usize,
}

impl Workspace {
    pub fn from_yaml(text: &str) -> Result<Self, ConfigError> {
        let value = parse_config(text)?;
        Self::from_value(value)
    }

    pub fn from_value(value: Value) -> Result<Self, ConfigError> {
        let mut root = value.as_mapping().cloned().ok_or(ConfigError::NotMapping)?;
        let proxies = take_sequence(&mut root, "proxies")?;
        let proxy_groups = take_sequence(&mut root, "proxy-groups")?;
        let rules = take_sequence(&mut root, "rules")?;
        let rule_providers = take_mapping(&mut root, "rule-providers")?;
        let proxy_providers = take_mapping(&mut root, "proxy-providers")?;
        let hosts = take_mapping(&mut root, "hosts")?;
        let dns = match root.shift_remove("dns") {
            None | Some(Value::Null) => None,
            Some(value) => Some(value),
        };

        Ok(Self {
            settings: root,
            proxies,
            proxy_groups,
            rules,
            rule_providers,
            proxy_providers,
            dns,
            hosts,
        })
    }

    pub fn to_value(&self, include_controller: bool) -> Result<Value, ConfigError> {
        let workspace = self.normalized();
        let mut root = workspace.settings.clone();
        root.insert(
            Value::String("proxies".into()),
            Value::Sequence(workspace.proxies.clone()),
        );
        root.insert(
            Value::String("proxy-groups".into()),
            Value::Sequence(workspace.proxy_groups.clone()),
        );
        root.insert(
            Value::String("rules".into()),
            Value::Sequence(workspace.rules.clone()),
        );
        if !workspace.rule_providers.is_empty() {
            root.insert(
                Value::String("rule-providers".into()),
                Value::Mapping(workspace.rule_providers.clone()),
            );
        }
        if !workspace.proxy_providers.is_empty() {
            root.insert(
                Value::String("proxy-providers".into()),
                Value::Mapping(workspace.proxy_providers.clone()),
            );
        }
        if let Some(dns) = &workspace.dns {
            root.insert(Value::String("dns".into()), dns.clone());
        }
        if !workspace.hosts.is_empty() {
            root.insert(
                Value::String("hosts".into()),
                Value::Mapping(workspace.hosts.clone()),
            );
        }
        if !include_controller {
            for key in CONTROLLER_KEYS {
                root.shift_remove(*key);
            }
        }
        Ok(Value::Mapping(root))
    }

    /// Remove proxy-group members that no longer refer to a node, group or
    /// provider. This keeps a workspace after deleting nodes from exporting
    /// dangling references.
    pub fn normalize(&mut self) {
        let mut known = BTreeSet::new();
        for name in [
            "DIRECT",
            "REJECT",
            "REJECT-DROP",
            "PASS",
            "COMPATIBLE",
            "GLOBAL",
        ] {
            known.insert(name.to_string());
        }
        for proxy in &self.proxies {
            if let Some(name) = proxy
                .as_mapping()
                .and_then(|mapping| mapping.get("name"))
                .and_then(Value::as_str)
            {
                known.insert(name.to_string());
            }
        }
        for group in &self.proxy_groups {
            if let Some(name) = group
                .as_mapping()
                .and_then(|mapping| mapping.get("name"))
                .and_then(Value::as_str)
            {
                known.insert(name.to_string());
            }
        }
        for name in self.proxy_providers.keys() {
            if let Some(name) = name.as_str() {
                known.insert(name.to_string());
            }
        }

        for group in &mut self.proxy_groups {
            let Some(mapping) = group.as_mapping_mut() else {
                continue;
            };
            let Some(members) = mapping.get_mut("proxies").and_then(Value::as_sequence_mut) else {
                continue;
            };
            members.retain(|member| {
                member
                    .as_str()
                    .map(|name| known.contains(name))
                    .unwrap_or(true)
            });
        }
    }

    pub fn normalized(&self) -> Self {
        let mut workspace = self.clone();
        workspace.normalize();
        workspace
    }

    pub fn to_yaml(&self, include_controller: bool) -> Result<String, ConfigError> {
        let value = self.to_value(include_controller)?;
        crate::config::to_yaml(&value)
    }

    /// Replace the DNS and hosts sections with a compiled override.
    pub fn apply_dns(&mut self, compiled: &CompiledDns) {
        if !compiled.enabled {
            return;
        }
        if let Some(dns) = &compiled.dns {
            self.dns = Some(Value::Mapping(dns.clone()));
        }
        self.hosts = compiled.hosts.clone().unwrap_or_default();
    }

    pub fn view(&self) -> WorkspaceView {
        WorkspaceView {
            settings: self.settings.clone(),
            nodes: self.proxies.clone(),
            exits: self.proxy_groups.clone(),
            rules: self.rules.clone(),
            rule_providers: self.rule_providers.clone(),
            proxy_providers: self.proxy_providers.clone(),
            dns: self.dns.clone(),
            hosts: self.hosts.clone(),
            node_count: self.proxies.len(),
            exit_count: self.proxy_groups.len(),
            rule_count: self.rules.len(),
        }
    }

    pub fn node_count(&self) -> usize {
        self.proxies.len()
    }

    pub fn exit_count(&self) -> usize {
        self.proxy_groups.len()
    }

    pub fn rule_count(&self) -> usize {
        self.rules.len()
    }
}

fn take_sequence(map: &mut Mapping, section: &str) -> Result<Vec<Value>, ConfigError> {
    match map.shift_remove(section) {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Sequence(values)) => Ok(values),
        Some(_) => Err(ConfigError::InvalidSection {
            section: section.into(),
        }),
    }
}

fn take_mapping(map: &mut Mapping, section: &str) -> Result<Mapping, ConfigError> {
    match map.shift_remove(section) {
        None | Some(Value::Null) => Ok(Mapping::new()),
        Some(Value::Mapping(values)) => Ok(values),
        Some(_) => Err(ConfigError::InvalidSection {
            section: section.into(),
        }),
    }
}
