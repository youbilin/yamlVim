use std::fs;
use std::path::{Path, PathBuf};

use serde_yaml::Value;
use yamlvim_core::{compile_dns, DnsError, DnsInput};

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/dns")
        .join(name)
}

fn load_input(name: &str) -> DnsInput {
    let text = fs::read_to_string(fixture(name)).unwrap_or_else(|error| {
        panic!("failed to read fixture {name}: {error}");
    });
    serde_yaml::from_str(&text).unwrap_or_else(|error| {
        panic!("failed to parse fixture {name}: {error}");
    })
}

fn input(yaml: &str) -> DnsInput {
    serde_yaml::from_str(yaml).unwrap_or_else(|error| {
        panic!("failed to parse inline fixture: {error}\n{yaml}");
    })
}

fn assert_golden(input_name: &str, expected_name: &str) {
    let compiled = compile_dns(&load_input(input_name)).unwrap();
    let actual = serde_json::to_value(compiled.output()).unwrap();
    let expected_text = fs::read_to_string(fixture(expected_name)).unwrap();
    let expected: Value = serde_yaml::from_str(&expected_text).unwrap();
    let expected = serde_json::to_value(expected).unwrap();
    assert_eq!(actual, expected, "golden mismatch for {input_name}");
}

#[test]
fn golden_basic() {
    assert_golden("basic.yaml", "basic.expected.yaml");
}

#[test]
fn golden_advanced_preserves_new_fields() {
    assert_golden("advanced.yaml", "advanced.expected.yaml");
}

#[test]
fn golden_rule_set_policy() {
    assert_golden("rule-set.yaml", "rule-set.expected.yaml");
}

#[test]
fn disabled_override_produces_no_fragments() {
    let compiled = compile_dns(&load_input("disabled.yaml")).unwrap();
    assert!(!compiled.enabled);
    assert!(compiled.dns.is_none());
    assert!(compiled.hosts.is_none());
    assert_eq!(
        serde_json::to_value(compiled.output()).unwrap(),
        serde_json::json!({})
    );
    assert_golden("disabled.yaml", "disabled.expected.yaml");
}

#[test]
fn overlap_is_reported_as_warning() {
    let compiled = compile_dns(&load_input("overlap.yaml")).unwrap();
    assert!(
        compiled
            .warnings
            .iter()
            .any(|warning| warning.code == "overlap"),
        "expected an overlap warning, got {:?}",
        compiled.warnings
    );
}

#[test]
fn missing_rule_set_is_rejected() {
    let error = compile_dns(&input(
        r#"
enabled: true
settings:
  enable: true
  nameserver:
    - https://doh.pub/dns-query
rules:
  - id: private-policy
    match:
      type: rule-set
      value: private
    action:
      type: nameserver
      servers:
        - system
"#,
    ))
    .unwrap_err();
    assert_eq!(
        error,
        DnsError::UnknownRuleSet {
            rule: "private-policy".into(),
            value: "private".into()
        }
    );
}

#[test]
fn duplicate_policy_is_rejected() {
    let error = compile_dns(&input(
        r#"
enabled: true
settings:
  enable: true
  nameserver:
    - https://doh.pub/dns-query
rules:
  - id: first
    match:
      type: suffix
      value: example.com
    action:
      type: nameserver
      servers:
        - 1.1.1.1
  - id: second
    match:
      type: suffix
      value: example.com
    action:
      type: nameserver
      servers:
        - 8.8.8.8
"#,
    ))
    .unwrap_err();
    assert_eq!(
        error,
        DnsError::DuplicatePolicy {
            key: "+.example.com".into(),
            first: "first".into(),
            second: "second".into()
        }
    );
}

#[test]
fn invalid_fixed_ip_is_rejected() {
    let error = compile_dns(&input(
        r#"
enabled: true
settings:
  enable: true
  nameserver:
    - https://doh.pub/dns-query
rules:
  - id: pin
    match:
      type: exact
      value: example.com
    action:
      type: fixed-ip
      ips:
        - not-an-ip
"#,
    ))
    .unwrap_err();
    assert_eq!(
        error,
        DnsError::InvalidIp {
            rule: "pin".into(),
            value: "not-an-ip".into()
        }
    );
}

#[test]
fn fixed_ip_requires_exact_domain() {
    let error = compile_dns(&input(
        r#"
enabled: true
settings:
  enable: true
  nameserver:
    - https://doh.pub/dns-query
rules:
  - id: pin
    match:
      type: suffix
      value: example.com
    action:
      type: fixed-ip
      ips:
        - 1.2.3.4
"#,
    ))
    .unwrap_err();
    assert_eq!(
        error,
        DnsError::FixedIpRequiresExactDomain { rule: "pin".into() }
    );
}

#[test]
fn bypass_in_whitelist_mode_is_rejected() {
    let error = compile_dns(&input(
        r#"
enabled: true
settings:
  enable: true
  fake-ip-filter-mode: whitelist
  nameserver:
    - https://doh.pub/dns-query
rules:
  - id: bypass
    match:
      type: suffix
      value: lan
    action:
      type: bypass-fake-ip
"#,
    ))
    .unwrap_err();
    assert_eq!(
        error,
        DnsError::BypassUnsupportedInWhitelist {
            rule: "bypass".into()
        }
    );
}

#[test]
fn invalid_cidr_is_rejected() {
    let error = compile_dns(&input(
        r#"
enabled: true
settings:
  enable: true
  fake-ip-range: 198.18.0.1
  nameserver:
    - https://doh.pub/dns-query
"#,
    ))
    .unwrap_err();
    assert!(matches!(error, DnsError::InvalidCidr { field, .. } if field == "fake-ip-range"));
}

#[test]
fn unknown_dns_fields_are_preserved() {
    let compiled = compile_dns(&input(
        r#"
enabled: true
settings:
  enable: true
  nameserver:
    - https://doh.pub/dns-query
  prefer-h3: true
  custom-vendor-key: keep-me
"#,
    ))
    .unwrap();
    let dns = compiled.dns.unwrap();
    assert_eq!(dns.get("prefer-h3"), Some(&Value::Bool(true)));
    assert_eq!(
        dns.get("custom-vendor-key"),
        Some(&Value::String("keep-me".into()))
    );
}

#[test]
fn base_nameserver_policy_is_merged() {
    let compiled = compile_dns(&input(
        r#"
enabled: true
settings:
  enable: true
  nameserver:
    - https://doh.pub/dns-query
  nameserver-policy:
    '+.base.example': 1.1.1.1
rules:
  - id: rule
    match:
      type: suffix
      value: rule.example
    action:
      type: nameserver
      servers:
        - 8.8.8.8
"#,
    ))
    .unwrap();
    let dns = compiled.dns.unwrap();
    let policy = dns
        .get("nameserver-policy")
        .and_then(Value::as_mapping)
        .expect("nameserver-policy mapping");
    assert!(policy.contains_key("+.base.example"));
    assert!(policy.contains_key("+.rule.example"));
}

#[test]
fn tauri_shaped_json_input_compiles() {
    let value = serde_json::json!({
        "enabled": true,
        "settings": {
            "enable": true,
            "listen": "127.0.0.1:1053",
            "enhanced-mode": "fake-ip",
            "fake-ip-range": "198.18.0.1/16",
            "fake-ip-filter": ["*.lan"],
            "nameserver": ["https://doh.pub/dns-query"],
            "default-nameserver": ["223.5.5.5"],
            "proxy-server-nameserver": ["https://doh.pub/dns-query"],
            "use-hosts": true,
            "use-system-hosts": true
        },
        "rules": [
            {
                "id": "rule-openai",
                "match": { "type": "suffix", "value": "openai.com" },
                "action": { "type": "nameserver", "servers": ["https://dns.google/dns-query"] }
            },
            {
                "id": "rule-pin",
                "match": { "type": "exact", "value": "example.com" },
                "action": { "type": "fixed-ip", "ips": ["93.184.216.34"] }
            },
            {
                "id": "rule-ads",
                "match": { "type": "geosite", "value": "category-ads-all" },
                "action": { "type": "block" }
            }
        ],
        "hosts": {},
        "rule-sets": []
    });
    let input: DnsInput = serde_json::from_value(value).unwrap();
    let compiled = compile_dns(&input).unwrap();
    assert!(compiled.enabled);
    assert!(compiled
        .dns
        .as_ref()
        .and_then(|dns| dns.get("nameserver-policy"))
        .is_some());
}

#[test]
fn deprecated_geosite_and_geoip_warnings_are_reported() {
    let compiled = compile_dns(&input(
        r#"
enabled: true
settings:
  enable: true
  nameserver:
    - https://doh.pub/dns-query
  fallback-filter:
    geoip: true
    geosite:
      - category-ads-all
"#,
    ))
    .unwrap();
    assert!(compiled
        .warnings
        .iter()
        .any(|warning| warning.code == "deprecated-fallback-geosite"));
    assert!(compiled
        .warnings
        .iter()
        .any(|warning| warning.code == "geoip-requires-mmdb"));
}

#[test]
fn disabled_override_skips_validation() {
    let compiled = compile_dns(&input(
        r#"
enabled: false
settings:
  enable: true
  fake-ip-range: not-a-cidr
"#,
    ))
    .unwrap();
    assert!(!compiled.enabled);
}

#[test]
fn invalid_upstream_is_rejected() {
    let error = compile_dns(&input(
        r#"
enabled: true
settings:
  enable: true
  nameserver:
    - not-a-dns-server
"#,
    ))
    .unwrap_err();
    assert!(matches!(error, DnsError::InvalidUpstream { .. }));
}

#[test]
fn empty_nameserver_rule_is_rejected() {
    let error = compile_dns(&input(
        r#"
enabled: true
settings:
  enable: true
  nameserver:
    - https://doh.pub/dns-query
rules:
  - id: empty
    match:
      type: exact
      value: example.com
    action:
      type: nameserver
      servers: []
"#,
    ))
    .unwrap_err();
    assert_eq!(
        error,
        DnsError::EmptyServers {
            rule: "empty".into()
        }
    );
}
