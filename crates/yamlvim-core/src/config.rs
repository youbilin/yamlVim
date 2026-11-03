use std::fmt;

use serde_yaml::{Mapping, Value};

use crate::dns::CompiledDns;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigError {
    InvalidYaml(String),
    NotMapping,
    Serialize(String),
    ProviderNotFound { section: String, name: String },
    InvalidSection { section: String },
}

impl fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidYaml(message) => write!(formatter, "invalid mihomo YAML: {message}"),
            Self::NotMapping => write!(formatter, "mihomo config must be a YAML mapping"),
            Self::Serialize(message) => write!(formatter, "failed to serialize config: {message}"),
            Self::ProviderNotFound { section, name } => {
                write!(formatter, "provider {name:?} not found in {section}")
            }
            Self::InvalidSection { section } => {
                write!(formatter, "{section} must be a YAML list or mapping")
            }
        }
    }
}

impl std::error::Error for ConfigError {}

/// Parse a mihomo config and require a mapping at the top level.
pub fn parse_config(text: &str) -> Result<Value, ConfigError> {
    let value: Value =
        serde_yaml::from_str(text).map_err(|error| ConfigError::InvalidYaml(error.to_string()))?;
    if value.as_mapping().is_none() {
        return Err(ConfigError::NotMapping);
    }
    Ok(value)
}

/// Apply the compiled DNS override to a base mihomo config.
///
/// When the override is enabled, the dns block is replaced and the top-level
/// hosts block is replaced (the compiler has already merged the base hosts
/// into its output). All other keys are preserved at the semantic level.
pub fn merge_dns(base: &Value, compiled: &CompiledDns) -> Result<Value, ConfigError> {
    if !compiled.enabled {
        return Ok(base.clone());
    }

    let mut merged = base.clone();
    let mapping = merged.as_mapping_mut().ok_or(ConfigError::NotMapping)?;
    if let Some(dns) = &compiled.dns {
        mapping.insert(Value::String("dns".into()), Value::Mapping(dns.clone()));
    }
    if let Some(hosts) = &compiled.hosts {
        mapping.insert(Value::String("hosts".into()), Value::Mapping(hosts.clone()));
    }
    Ok(merged)
}

/// Extract the top-level hosts map from a base config so it can be passed into
/// the DNS compiler and preserved.
pub fn config_hosts(value: &Value) -> Mapping {
    value
        .as_mapping()
        .and_then(|mapping| mapping.get("hosts"))
        .and_then(Value::as_mapping)
        .cloned()
        .unwrap_or_default()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderPathEntry {
    pub section: String,
    pub name: String,
    pub path: String,
}

/// Collect the file paths referenced by `rule-providers` and
/// `proxy-providers` so an importer can copy them into the app data folder.
pub fn provider_paths(value: &Value) -> Result<Vec<ProviderPathEntry>, ConfigError> {
    let root = value.as_mapping().ok_or(ConfigError::NotMapping)?;
    let mut entries = Vec::new();
    for section in ["rule-providers", "proxy-providers"] {
        let Some(providers) = root.get(section).and_then(Value::as_mapping) else {
            continue;
        };
        for (name, provider) in providers {
            let Some(name) = name.as_str() else {
                continue;
            };
            let Some(provider) = provider.as_mapping() else {
                continue;
            };
            let Some(path) = provider.get("path").and_then(Value::as_str) else {
                continue;
            };
            entries.push(ProviderPathEntry {
                section: section.to_string(),
                name: name.to_string(),
                path: path.to_string(),
            });
        }
    }
    Ok(entries)
}

pub fn set_provider_path(
    value: &mut Value,
    section: &str,
    name: &str,
    new_path: &str,
) -> Result<(), ConfigError> {
    let root = value.as_mapping_mut().ok_or(ConfigError::NotMapping)?;
    let providers = root
        .get_mut(section)
        .and_then(Value::as_mapping_mut)
        .ok_or_else(|| ConfigError::ProviderNotFound {
            section: section.into(),
            name: name.into(),
        })?;
    let provider = providers
        .get_mut(name)
        .and_then(Value::as_mapping_mut)
        .ok_or_else(|| ConfigError::ProviderNotFound {
            section: section.into(),
            name: name.into(),
        })?;
    provider.insert(Value::String("path".into()), Value::String(new_path.into()));
    Ok(())
}

pub fn to_yaml(value: &Value) -> Result<String, ConfigError> {
    serde_yaml::to_string(value).map_err(|error| ConfigError::Serialize(error.to_string()))
}

/// Remove local controller credentials before exporting a config.
pub fn strip_controller(value: &Value) -> Result<Value, ConfigError> {
    let mut result = value.clone();
    let mapping = result.as_mapping_mut().ok_or(ConfigError::NotMapping)?;
    for key in [
        "external-controller",
        "external-controller-pipe",
        "external-controller-unix",
        "external-controller-tls",
        "external-controller-cors",
        "secret",
    ] {
        mapping.shift_remove(key);
    }
    Ok(result)
}
