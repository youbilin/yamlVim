use serde_yaml::Value;
use yamlvim_core::{compile_dns, DnsInput, Workspace};

const CONFIG: &str = r#"
mixed-port: 17899
mode: rule
log-level: info
external-controller: 127.0.0.1:9090
secret: local-secret
proxies:
  - name: node-a
    type: ss
    server: a.example.com
    port: 443
    cipher: aes-128-gcm
    password: secret
  - name: node-b
    type: trojan
    server: b.example.com
    port: 443
    password: secret
proxy-groups:
  - name: Auto
    type: url-test
    proxies: [node-a, node-b]
rules:
  - MATCH,Auto
rule-providers:
  private:
    type: file
    behavior: domain
    path: D:/data/core/providers/private.yaml
proxy-providers:
  sub:
    type: http
    path: D:/data/core/providers/sub.yaml
dns:
  enable: true
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  nameserver:
    - https://doh.pub/dns-query
hosts:
  base.example: 10.0.0.1
profile:
  store-selected: true
"#;

#[test]
fn parses_managed_sections_and_settings() {
    let workspace = Workspace::from_yaml(CONFIG).unwrap();
    assert_eq!(workspace.node_count(), 2);
    assert_eq!(workspace.exit_count(), 1);
    assert_eq!(workspace.rule_count(), 1);
    assert_eq!(workspace.rule_providers.len(), 1);
    assert_eq!(workspace.proxy_providers.len(), 1);
    assert!(workspace.dns.is_some());
    assert!(workspace.hosts.contains_key("base.example"));
    assert_eq!(
        workspace.settings.get("mixed-port").and_then(Value::as_u64),
        Some(17899)
    );
    assert!(workspace.settings.contains_key("profile"));
}

#[test]
fn exports_current_workspace_only() {
    let mut workspace = Workspace::from_yaml(CONFIG).unwrap();
    workspace.proxies.retain(|proxy| {
        proxy
            .as_mapping()
            .and_then(|mapping| mapping.get("name"))
            .and_then(Value::as_str)
            != Some("node-b")
    });
    let yaml = workspace.to_yaml(false).unwrap();
    assert!(yaml.contains("node-a"));
    assert!(!yaml.contains("node-b"));
    assert!(yaml.contains("mixed-port"));
    assert!(!yaml.contains("external-controller"));
    assert!(!yaml.contains("local-secret"));
    assert!(yaml.contains("base.example"));
}

#[test]
fn apply_dns_replaces_dns_and_hosts() {
    let mut workspace = Workspace::from_yaml(CONFIG).unwrap();
    let mut input: DnsInput = serde_yaml::from_str(
        r#"
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
"#,
    )
    .unwrap();
    input.hosts = workspace.hosts.clone();
    let compiled = compile_dns(&input).unwrap();
    workspace.apply_dns(&compiled);
    let dns = workspace.dns.as_ref().and_then(Value::as_mapping).unwrap();
    assert_eq!(dns.get("enable").and_then(Value::as_bool), Some(true));
    assert_eq!(
        workspace.hosts.get("example.com").and_then(Value::as_str),
        Some("93.184.216.34")
    );
    assert_eq!(
        workspace.hosts.get("base.example").and_then(Value::as_str),
        Some("10.0.0.1")
    );
}

#[test]
fn invalid_section_is_rejected() {
    let error = Workspace::from_yaml("proxies: not-a-list").unwrap_err();
    assert!(error.to_string().contains("proxies"));
}
