use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::net::{IpAddr, SocketAddr};

use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};

/// A complete DNS override input: the global settings, the per-domain rules,
/// the existing top-level hosts map, and the rule-set names available in the
/// workspace.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub struct DnsInput {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub settings: DnsSettings,
    #[serde(default)]
    pub rules: Vec<DnsRule>,
    #[serde(default)]
    pub hosts: Mapping,
    #[serde(default, rename = "rule-sets")]
    pub rule_sets: Vec<String>,
}

/// The mihomo `dns:` block. Known fields are typed; anything else is preserved
/// in `extra` so newer mihomo options survive an import/export round-trip.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub struct DnsSettings {
    #[serde(default)]
    pub enable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub listen: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ipv6: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ipv6_timeout: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prefer_h3: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enhanced_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fake_ip_range: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fake_ip_range6: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fake_ip_filter: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fake_ip_filter_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fake_ip_ttl: Option<u32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub default_nameserver: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nameserver: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub proxy_server_nameserver: Vec<String>,
    #[serde(default, skip_serializing_if = "is_mapping_empty")]
    pub proxy_server_nameserver_policy: Mapping,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub direct_nameserver: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direct_nameserver_follow_policy: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fallback: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback_filter: Option<FallbackFilter>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback_lazy_query: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_algorithm: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_max_size: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub use_hosts: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub use_system_hosts: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub respect_rules: Option<bool>,
    #[serde(default, skip_serializing_if = "is_mapping_empty")]
    pub nameserver_policy: Mapping,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub struct FallbackFilter {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub geoip: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub geoip_code: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ipcidr: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub domain: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub geosite: Vec<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct DnsRule {
    pub id: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(rename = "match")]
    pub matcher: DnsMatch,
    pub action: DnsAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

fn default_true() -> bool {
    true
}

fn is_mapping_empty(map: &Mapping) -> bool {
    map.is_empty()
}

/// Matches supported by mihomo's `nameserver-policy` keys. Keyword and regex
/// are intentionally absent: mihomo does not define them for this field.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", content = "value", rename_all = "kebab-case")]
pub enum DnsMatch {
    Exact(String),
    Suffix(String),
    Geosite(String),
    RuleSet(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum DnsAction {
    Nameserver { servers: Vec<String> },
    FixedIp { ips: Vec<String> },
    BypassFakeIp,
    Block,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DnsError {
    InvalidDomain {
        rule: String,
        value: String,
    },
    InvalidName {
        rule: String,
        value: String,
    },
    InvalidIp {
        rule: String,
        value: String,
    },
    InvalidCidr {
        field: String,
        value: String,
    },
    InvalidUpstream {
        rule: String,
        value: String,
    },
    InvalidDefaultNameserver {
        value: String,
    },
    InvalidMode {
        field: String,
        value: String,
    },
    UnknownRuleSet {
        rule: String,
        value: String,
    },
    DuplicatePolicy {
        key: String,
        first: String,
        second: String,
    },
    DuplicateHost {
        domain: String,
        first: String,
        second: String,
    },
    FixedIpRequiresExactDomain {
        rule: String,
    },
    EmptyServers {
        rule: String,
    },
    EmptyIps {
        rule: String,
    },
    BypassUnsupportedInWhitelist {
        rule: String,
    },
    Serialize(String),
}

impl fmt::Display for DnsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidDomain { rule, value } => {
                write!(f, "rule {rule}: invalid domain {value:?}")
            }
            Self::InvalidName { rule, value } => {
                write!(f, "rule {rule}: invalid name {value:?}")
            }
            Self::InvalidIp { rule, value } => {
                write!(f, "rule {rule}: invalid IP address {value:?}")
            }
            Self::InvalidCidr { field, value } => {
                write!(f, "{field}: invalid CIDR {value:?}")
            }
            Self::InvalidUpstream { rule, value } => {
                write!(f, "rule {rule}: invalid DNS upstream {value:?}")
            }
            Self::InvalidDefaultNameserver { value } => {
                write!(
                    f,
                    "default-nameserver must be an IP or IP:port, got {value:?}"
                )
            }
            Self::InvalidMode { field, value } => {
                write!(f, "{field}: unsupported value {value:?}")
            }
            Self::UnknownRuleSet { rule, value } => {
                write!(f, "rule {rule}: unknown rule-set {value:?}")
            }
            Self::DuplicatePolicy { key, first, second } => {
                write!(
                    f,
                    "DNS policy {key:?} is defined by both {first} and {second}"
                )
            }
            Self::DuplicateHost {
                domain,
                first,
                second,
            } => {
                write!(f, "host {domain:?} is defined by both {first} and {second}")
            }
            Self::FixedIpRequiresExactDomain { rule } => {
                write!(
                    f,
                    "rule {rule}: fixed-ip requires an exact-domain match; use a hosts entry instead"
                )
            }
            Self::EmptyServers { rule } => {
                write!(f, "rule {rule}: nameserver list is empty")
            }
            Self::EmptyIps { rule } => {
                write!(f, "rule {rule}: IP list is empty")
            }
            Self::BypassUnsupportedInWhitelist { rule } => {
                write!(
                    f,
                    "rule {rule}: bypass-fake-ip is ambiguous when fake-ip-filter-mode is whitelist"
                )
            }
            Self::Serialize(message) => write!(f, "failed to serialize DNS settings: {message}"),
        }
    }
}

impl std::error::Error for DnsError {}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub struct DnsWarning {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "kebab-case")]
pub struct CompiledDns {
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dns: Option<Mapping>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hosts: Option<Mapping>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<DnsWarning>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DnsOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dns: Option<Mapping>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hosts: Option<Mapping>,
}

impl CompiledDns {
    /// Only the config fragments, without compiler metadata.
    pub fn output(&self) -> DnsOutput {
        DnsOutput {
            dns: self.dns.clone(),
            hosts: self.hosts.clone(),
        }
    }
}

/// Compile the visual DNS override into the mihomo config fragments.
///
/// The returned `dns` mapping is intended to replace the base `dns:` block.
/// The returned `hosts` mapping contains the input hosts plus fixed-IP rules;
/// when present, callers should replace the base top-level `hosts` map with it.
pub fn compile_dns(input: &DnsInput) -> Result<CompiledDns, DnsError> {
    if !input.enabled {
        return Ok(CompiledDns {
            enabled: false,
            dns: None,
            hosts: None,
            warnings: Vec::new(),
        });
    }

    validate_settings(&input.settings)?;

    let mut warnings = Vec::new();
    if !input.settings.enable {
        warnings.push(DnsWarning {
            code: "dns-disabled".into(),
            message:
                "DNS override is enabled, but dns.enable is false; mihomo will use system DNS."
                    .into(),
            rule: None,
        });
    }
    if let Some(filter) = &input.settings.fallback_filter {
        if !filter.geosite.is_empty() {
            warnings.push(DnsWarning {
                code: "deprecated-fallback-geosite".into(),
                message: "fallback-filter.geosite is deprecated by mihomo; prefer nameserver-policy entries."
                    .into(),
                rule: None,
            });
        }
        if filter.geoip == Some(true) {
            warnings.push(DnsWarning {
                code: "geoip-requires-mmdb".into(),
                message: "fallback-filter.geoip requires a local GeoIP/MMDB database; mihomo may try to download it at startup."
                    .into(),
                rule: None,
            });
        }
    }

    let settings_value = serde_yaml::to_value(&input.settings)
        .map_err(|error| DnsError::Serialize(error.to_string()))?;
    let mut dns = settings_value.as_mapping().cloned().unwrap_or_default();

    let mut policy = take_mapping(&mut dns, "nameserver-policy")?;
    let mut fake_filter = take_string_sequence(&mut dns, "fake-ip-filter")?;
    let mut hosts = input.hosts.clone();

    let mut policy_owners: BTreeMap<String, String> = BTreeMap::new();
    let mut host_owners: BTreeMap<String, String> = BTreeMap::new();
    let mut domain_keys: Vec<(String, String)> = Vec::new();

    for rule in &input.rules {
        if !rule.enabled {
            continue;
        }

        match &rule.action {
            DnsAction::Nameserver { servers } => {
                if servers.is_empty() {
                    return Err(DnsError::EmptyServers {
                        rule: rule.id.clone(),
                    });
                }
                for server in servers {
                    validate_upstream(server, &rule.id)?;
                }
                let key = policy_key(&rule.matcher, &rule.id, input)?;
                let value = string_list_value(servers);
                if let Some(existing) = policy.get(key.as_str()) {
                    if existing == &value {
                        continue;
                    }
                    let first = policy_owners
                        .get(&key)
                        .cloned()
                        .unwrap_or_else(|| "base".into());
                    return Err(DnsError::DuplicatePolicy {
                        key,
                        first,
                        second: rule.id.clone(),
                    });
                }
                policy.insert(Value::String(key.clone()), value);
                policy_owners.insert(key, rule.id.clone());
                if let Some(domain) = matcher_domain_normalized(&rule.matcher, &rule.id)? {
                    domain_keys.push((domain, rule.id.clone()));
                }
            }
            DnsAction::FixedIp { ips } => {
                if ips.is_empty() {
                    return Err(DnsError::EmptyIps {
                        rule: rule.id.clone(),
                    });
                }
                let domain = match &rule.matcher {
                    DnsMatch::Exact(domain) => normalize_domain(domain, &rule.id)?,
                    _ => {
                        return Err(DnsError::FixedIpRequiresExactDomain {
                            rule: rule.id.clone(),
                        })
                    }
                };
                for ip in ips {
                    if ip.parse::<IpAddr>().is_err() {
                        return Err(DnsError::InvalidIp {
                            rule: rule.id.clone(),
                            value: ip.clone(),
                        });
                    }
                }
                let value = string_list_value(ips);
                if let Some(existing) = hosts.get(domain.as_str()) {
                    if existing == &value {
                        continue;
                    }
                    let first = host_owners
                        .get(&domain)
                        .cloned()
                        .unwrap_or_else(|| "base".into());
                    return Err(DnsError::DuplicateHost {
                        domain,
                        first,
                        second: rule.id.clone(),
                    });
                }
                hosts.insert(Value::String(domain.clone()), value);
                host_owners.insert(domain, rule.id.clone());
            }
            DnsAction::BypassFakeIp => {
                if input.settings.fake_ip_filter_mode.as_deref() == Some("whitelist") {
                    return Err(DnsError::BypassUnsupportedInWhitelist {
                        rule: rule.id.clone(),
                    });
                }
                let pattern = fake_ip_pattern(&rule.matcher, &rule.id, input)?;
                if !fake_filter.iter().any(|item| item == &pattern) {
                    fake_filter.push(pattern);
                }
            }
            DnsAction::Block => {
                let key = policy_key(&rule.matcher, &rule.id, input)?;
                let value = Value::String("rcode://refused".into());
                if let Some(existing) = policy.get(key.as_str()) {
                    if existing == &value {
                        continue;
                    }
                    let first = policy_owners
                        .get(&key)
                        .cloned()
                        .unwrap_or_else(|| "base".into());
                    return Err(DnsError::DuplicatePolicy {
                        key,
                        first,
                        second: rule.id.clone(),
                    });
                }
                policy.insert(Value::String(key.clone()), value);
                policy_owners.insert(key, rule.id.clone());
                if let Some(domain) = matcher_domain_normalized(&rule.matcher, &rule.id)? {
                    domain_keys.push((domain, rule.id.clone()));
                }
            }
        }
    }

    if !policy.is_empty() {
        dns.insert(
            Value::String("nameserver-policy".into()),
            Value::Mapping(policy),
        );
    }
    if !fake_filter.is_empty() {
        dns.insert(
            Value::String("fake-ip-filter".into()),
            Value::Sequence(fake_filter.into_iter().map(Value::String).collect()),
        );
    }

    warnings.extend(overlap_warnings(&domain_keys));

    Ok(CompiledDns {
        enabled: true,
        dns: Some(dns),
        hosts: if hosts.is_empty() { None } else { Some(hosts) },
        warnings,
    })
}

fn validate_settings(settings: &DnsSettings) -> Result<(), DnsError> {
    if let Some(range) = &settings.fake_ip_range {
        validate_cidr("fake-ip-range", range)?;
    }
    if let Some(range) = &settings.fake_ip_range6 {
        validate_cidr("fake-ip-range6", range)?;
    }
    for value in &settings.default_nameserver {
        if !is_ip_or_socket(value) {
            return Err(DnsError::InvalidDefaultNameserver {
                value: value.clone(),
            });
        }
    }
    for value in settings
        .nameserver
        .iter()
        .chain(settings.proxy_server_nameserver.iter())
        .chain(settings.direct_nameserver.iter())
        .chain(settings.fallback.iter())
    {
        validate_upstream(value, "settings")?;
    }
    if let Some(filter) = &settings.fallback_filter {
        for cidr in &filter.ipcidr {
            validate_cidr("fallback-filter.ipcidr", cidr)?;
        }
    }
    if let Some(mode) = &settings.enhanced_mode {
        if !matches!(mode.as_str(), "fake-ip" | "redir-host") {
            return Err(DnsError::InvalidMode {
                field: "enhanced-mode".into(),
                value: mode.clone(),
            });
        }
    }
    if let Some(mode) = &settings.fake_ip_filter_mode {
        if !matches!(mode.as_str(), "blacklist" | "whitelist" | "rule") {
            return Err(DnsError::InvalidMode {
                field: "fake-ip-filter-mode".into(),
                value: mode.clone(),
            });
        }
    }
    Ok(())
}

fn take_mapping(map: &mut Mapping, key: &str) -> Result<Mapping, DnsError> {
    match map.shift_remove(key) {
        None => Ok(Mapping::new()),
        Some(Value::Mapping(value)) => Ok(value),
        Some(_) => Err(DnsError::Serialize(format!("{key} must be a mapping"))),
    }
}

fn take_string_sequence(map: &mut Mapping, key: &str) -> Result<Vec<String>, DnsError> {
    match map.shift_remove(key) {
        None => Ok(Vec::new()),
        Some(Value::Sequence(values)) => values
            .into_iter()
            .map(|value| match value {
                Value::String(value) => Ok(value),
                _ => Err(DnsError::Serialize(format!("{key} must contain strings"))),
            })
            .collect(),
        Some(Value::String(value)) => Ok(vec![value]),
        Some(_) => Err(DnsError::Serialize(format!(
            "{key} must be a list of strings"
        ))),
    }
}

fn policy_key(matcher: &DnsMatch, rule: &str, input: &DnsInput) -> Result<String, DnsError> {
    match matcher {
        DnsMatch::Exact(domain) => normalize_domain(domain, rule),
        DnsMatch::Suffix(domain) => Ok(format!("+.{}", normalize_suffix(domain, rule)?)),
        DnsMatch::Geosite(name) => {
            validate_name(name, rule)?;
            Ok(format!("geosite:{name}"))
        }
        DnsMatch::RuleSet(name) => {
            validate_name(name, rule)?;
            if !input.rule_sets.iter().any(|item| item == name) {
                return Err(DnsError::UnknownRuleSet {
                    rule: rule.into(),
                    value: name.clone(),
                });
            }
            Ok(format!("rule-set:{name}"))
        }
    }
}

fn fake_ip_pattern(matcher: &DnsMatch, rule: &str, input: &DnsInput) -> Result<String, DnsError> {
    match matcher {
        DnsMatch::Exact(domain) => normalize_domain(domain, rule),
        DnsMatch::Suffix(domain) => Ok(format!("+.{}", normalize_suffix(domain, rule)?)),
        DnsMatch::Geosite(name) => {
            validate_name(name, rule)?;
            Ok(format!("geosite:{name}"))
        }
        DnsMatch::RuleSet(name) => {
            validate_name(name, rule)?;
            if !input.rule_sets.iter().any(|item| item == name) {
                return Err(DnsError::UnknownRuleSet {
                    rule: rule.into(),
                    value: name.clone(),
                });
            }
            Ok(format!("rule-set:{name}"))
        }
    }
}

fn matcher_domain_normalized(matcher: &DnsMatch, rule: &str) -> Result<Option<String>, DnsError> {
    match matcher {
        DnsMatch::Exact(domain) => Ok(Some(normalize_domain(domain, rule)?)),
        DnsMatch::Suffix(domain) => Ok(Some(normalize_suffix(domain, rule)?)),
        _ => Ok(None),
    }
}

fn normalize_domain(value: &str, rule: &str) -> Result<String, DnsError> {
    let domain = value.trim().trim_end_matches('.').to_ascii_lowercase();
    if domain.is_empty()
        || domain.len() > 253
        || domain.chars().any(|character| {
            character.is_whitespace() || matches!(character, '/' | '\\' | ':' | '*')
        })
    {
        return Err(DnsError::InvalidDomain {
            rule: rule.into(),
            value: value.into(),
        });
    }
    Ok(domain)
}

fn normalize_suffix(value: &str, rule: &str) -> Result<String, DnsError> {
    let value = value.trim().trim_end_matches('.');
    let value = value
        .strip_prefix("+.")
        .or_else(|| value.strip_prefix("*."))
        .or_else(|| value.strip_prefix('.'))
        .unwrap_or(value);
    normalize_domain(value, rule)
}

fn validate_name(value: &str, rule: &str) -> Result<(), DnsError> {
    let name = value.trim();
    if name.is_empty() || name.chars().any(char::is_whitespace) {
        return Err(DnsError::InvalidName {
            rule: rule.into(),
            value: value.into(),
        });
    }
    Ok(())
}

fn validate_upstream(value: &str, rule: &str) -> Result<(), DnsError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(DnsError::InvalidUpstream {
            rule: rule.into(),
            value: value.into(),
        });
    }
    if value == "system" {
        return Ok(());
    }
    if let Some((scheme, rest)) = value.split_once("://") {
        let supported = [
            "udp", "tcp", "tls", "https", "quic", "dhcp", "rcode", "http",
        ];
        if supported.contains(&scheme) && !rest.is_empty() {
            return Ok(());
        }
        return Err(DnsError::InvalidUpstream {
            rule: rule.into(),
            value: value.into(),
        });
    }
    if is_ip_or_socket(value) {
        return Ok(());
    }
    Err(DnsError::InvalidUpstream {
        rule: rule.into(),
        value: value.into(),
    })
}

fn validate_cidr(field: &str, value: &str) -> Result<(), DnsError> {
    let (address, prefix) = value.split_once('/').ok_or_else(|| DnsError::InvalidCidr {
        field: field.into(),
        value: value.into(),
    })?;
    let address: IpAddr = address.parse().map_err(|_| DnsError::InvalidCidr {
        field: field.into(),
        value: value.into(),
    })?;
    let prefix: u8 = prefix.parse().map_err(|_| DnsError::InvalidCidr {
        field: field.into(),
        value: value.into(),
    })?;
    let maximum = if address.is_ipv4() { 32 } else { 128 };
    if prefix > maximum {
        return Err(DnsError::InvalidCidr {
            field: field.into(),
            value: value.into(),
        });
    }
    Ok(())
}

fn is_ip_or_socket(value: &str) -> bool {
    value.parse::<IpAddr>().is_ok() || value.parse::<SocketAddr>().is_ok()
}

fn string_list_value(values: &[String]) -> Value {
    if values.len() == 1 {
        Value::String(values[0].clone())
    } else {
        Value::Sequence(values.iter().cloned().map(Value::String).collect())
    }
}

fn overlap_warnings(domains: &[(String, String)]) -> Vec<DnsWarning> {
    let mut warnings = Vec::new();
    let mut seen: BTreeSet<(String, String)> = BTreeSet::new();
    for (index, (left, left_rule)) in domains.iter().enumerate() {
        for (right, right_rule) in domains.iter().skip(index + 1) {
            if left == right || !domains_overlap(left, right) {
                continue;
            }
            let key = if left_rule <= right_rule {
                (left_rule.clone(), right_rule.clone())
            } else {
                (right_rule.clone(), left_rule.clone())
            };
            if seen.insert(key) {
                warnings.push(DnsWarning {
                    code: "overlap".into(),
                    message: format!(
                        "DNS rules {left_rule} ({left}) and {right_rule} ({right}) overlap; verify the effective result with a live query."
                    ),
                    rule: Some(left_rule.clone()),
                });
            }
        }
    }
    warnings
}

fn domains_overlap(left: &str, right: &str) -> bool {
    left == right || left.ends_with(&format!(".{right}")) || right.ends_with(&format!(".{left}"))
}
