use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde_json::json;
use yamlvim_core::{parse_share_link, share_node_to_proxy};

fn b64(value: &str) -> String {
    STANDARD.encode(value.as_bytes())
}

#[test]
fn share_links_cover_reality_obfs_and_proxy_conversion() {
    let vless = parse_share_link("vless://11111111-2222-3333-4444-555555555555@vless.example:443?security=reality&type=grpc&serviceName=svc&sni=front.example&pbk=public&sid=abcd&fp=chrome&flow=xtls-rprx-vision#V").unwrap();
    assert_eq!(vless.network, "grpc");
    assert_eq!(vless.service.as_deref(), Some("svc"));
    assert_eq!(vless.flow.as_deref(), Some("xtls-rprx-vision"));
    assert!(vless.tls);
    assert_eq!(
        vless.extras.get("reality-opts"),
        Some(&json!({"public-key": "public", "short-id": "abcd"}))
    );
    let proxy = share_node_to_proxy(&vless);
    assert_eq!(proxy["name"], json!("V"));
    assert_eq!(proxy["servername"], json!("front.example"));
    assert_eq!(proxy["grpc-opts"], json!({"grpc-service-name": "svc"}));

    let hy2 = parse_share_link("hysteria2://auth@hy.example:8443?sni=front.example&insecure=1&obfs=salamander&obfs-password=secret#H").unwrap();
    assert_eq!(hy2.extras.get("skip-cert-verify"), Some(&json!(true)));
    assert_eq!(hy2.extras.get("obfs"), Some(&json!("salamander")));
    let hy2_proxy = share_node_to_proxy(&hy2);
    assert_eq!(hy2_proxy.get("network"), None);
    assert_eq!(hy2_proxy["sni"], json!("front.example"));

    let ss = parse_share_link(&format!(
        "ss://{}@example.com:8388#{}",
        b64("aes-256-gcm:pass:word"),
        "%F0%9F%87%AF%F0%9F%87%B5%20JP"
    ))
    .unwrap();
    assert_eq!(ss.password.as_deref(), Some("pass:word"));
    assert_eq!(ss.name.as_deref(), Some("🇯🇵 JP"));

    let ssr_payload = b64(&format!(
        "ssr.example:8388:auth_aes128_md5:aes-256-cfb:tls1.2_ticket_auth:{}/?remarks={}&obfsparam={}",
        b64("ssr-pass"),
        b64("SSR 节点"),
        b64("cdn.example")
    ));
    let ssr = parse_share_link(&format!("ssr://{}", ssr_payload)).unwrap();
    assert_eq!(ssr.name.as_deref(), Some("SSR 节点"));
    assert_eq!(ssr.password.as_deref(), Some("ssr-pass"));
}

#[test]
fn invalid_share_links_report_actionable_errors() {
    assert_eq!(
        parse_share_link("https://example.com/sub")
            .unwrap_err()
            .message,
        "这是订阅或网页链接，请切换到「订阅」标签导入"
    );
    assert_eq!(
        parse_share_link("vmess://not-base64").unwrap_err().message,
        "VMess 链接内容无法解析，请确认链接完整"
    );
    assert_eq!(
        parse_share_link("vless://uuid@host:443?type=ws path")
            .unwrap_err()
            .message,
        "链接中间含有空白字符，请检查是否被换行截断"
    );
    assert!(parse_share_link("ss://bad").is_err());
    assert!(parse_share_link("socks5://127.0.0.1#no-port").is_err());
}
