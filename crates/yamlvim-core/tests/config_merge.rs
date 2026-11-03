use serde_yaml::Value;
use yamlvim_core::{
    compile_dns, config_hosts, merge_dns, parse_config, provider_paths, set_provider_path,
    strip_controller, to_yaml, DnsInput,
};

const BASE: &str = r#"
mixed-port: 7890
mode: rule
dns:
  enable: false
  nameserver:
    - 1.1.1.1
hosts:
  base.example: 10.0.0.1
proxies:
  - name: keep-me
    type: ss
    server: example.com
    port: 443
    cipher: aes-128-gcm
    password: secret
custom-vendor-key: keep
"#;

const DNS: &str = r#"
enabled: true
settings:
  enable: true
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
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
        - 93.184.216.34
"#;

#[test]
fn merge_preserves_unknown_keys_and_replaces_dns() {
    let base = parse_config(BASE).unwrap();
    let mut input: DnsInput = serde_yaml::from_str(DNS).unwrap();
    input.hosts = config_hosts(&base);
    let compiled = compile_dns(&input).unwrap();
    let merged = merge_dns(&base, &compiled).unwrap();
    let value = to_yaml(&merged).unwrap();
    let parsed: Value = serde_yaml::from_str(&value).unwrap();
    let mapping = parsed.as_mapping().unwrap();

    assert_eq!(
        mapping.get("mixed-port").and_then(Value::as_u64),
        Some(7890)
    );
    assert_eq!(
        mapping.get("custom-vendor-key").and_then(Value::as_str),
        Some("keep")
    );
    assert_eq!(
        mapping
            .get("dns")
            .and_then(Value::as_mapping)
            .and_then(|dns| dns.get("enable"))
            .and_then(Value::as_bool),
        Some(true)
    );
    let hosts = parsed
        .as_mapping()
        .and_then(|mapping| mapping.get("hosts"))
        .and_then(Value::as_mapping)
        .unwrap();
    assert_eq!(
        hosts.get("example.com").and_then(Value::as_str),
        Some("93.184.216.34")
    );
    assert_eq!(
        hosts.get("base.example").and_then(Value::as_str),
        Some("10.0.0.1")
    );
}

#[test]
fn disabled_override_leaves_base_untouched() {
    let base = parse_config(BASE).unwrap();
    let mut input: DnsInput = serde_yaml::from_str(DNS).unwrap();
    input.enabled = false;
    let compiled = compile_dns(&input).unwrap();
    let merged = merge_dns(&base, &compiled).unwrap();
    assert_eq!(merged, base);
}

#[test]
fn base_hosts_are_available_for_the_compiler() {
    let base = parse_config(BASE).unwrap();
    let hosts = config_hosts(&base);
    assert_eq!(
        hosts.get("base.example").and_then(Value::as_str),
        Some("10.0.0.1")
    );
}

#[test]
fn export_strips_controller_credentials() {
    let base = parse_config(
        r#"
mixed-port: 7890
external-controller: 127.0.0.1:9090
external-controller-pipe: \\.\pipe\test
secret: local-secret
proxies: []
"#,
    )
    .unwrap();
    let stripped = strip_controller(&base).unwrap();
    let mapping = stripped.as_mapping().unwrap();
    assert!(mapping.get("external-controller").is_none());
    assert!(mapping.get("external-controller-pipe").is_none());
    assert!(mapping.get("secret").is_none());
    assert_eq!(
        mapping.get("mixed-port").and_then(Value::as_u64),
        Some(7890)
    );
}

#[test]
fn provider_paths_can_be_rewritten() {
    let mut base = parse_config(
        r#"
mixed-port: 7890
rule-providers:
  private:
    type: http
    behavior: domain
    url: https://example.com/private.yaml
    path: C:/old/private.yaml
proxy-providers:
  sub:
    type: http
    path: ./providers/sub.yaml
"#,
    )
    .unwrap();
    let entries = provider_paths(&base).unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].section, "rule-providers");
    assert_eq!(entries[0].name, "private");

    set_provider_path(
        &mut base,
        "rule-providers",
        "private",
        "D:/app/data/core/providers/private.yaml",
    )
    .unwrap();
    set_provider_path(
        &mut base,
        "proxy-providers",
        "sub",
        "D:/app/data/core/providers/sub.yaml",
    )
    .unwrap();

    let text = to_yaml(&base).unwrap();
    assert!(text.contains("D:/app/data/core/providers/private.yaml"));
    assert!(text.contains("D:/app/data/core/providers/sub.yaml"));
    assert!(!text.contains("C:/old"));
}

#[test]
fn invalid_yaml_is_rejected() {
    assert!(parse_config("dns: [unclosed").is_err());
}
