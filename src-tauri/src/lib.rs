use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::alphabet;
use base64::engine::{general_purpose::GeneralPurpose, DecodePaddingMode, GeneralPurposeConfig};
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_yaml::Mapping;

use yamlvim_core::{
    compile_dns, parse_share_link, provider_paths, set_provider_path, share_node_to_proxy,
    DnsInput, DnsWarning, ProviderPathEntry, Workspace, WorkspaceView,
};
use yamlvim_mihomo::{
    probe_core as probe_core_binary, validate_config as validate_config_binary, ConfigValidation,
    ControllerClient, ControllerTransport, CoreProbe, DelayResult, ProbeOptions, SystemRunner,
};

const GEODATA_FILES: &[&str] = &[
    "Country.mmdb",
    "geoip.metadb",
    "GeoSite.dat",
    "geosite.dat",
    "GeoIP.dat",
    "GEOIP.dat",
    "GEOIP.metadb",
    "GEOSITE.dat",
    "ASN.mmdb",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    core_path: String,
    #[serde(default)]
    controller_endpoint: String,
    #[serde(default)]
    controller_secret: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            core_path: "mihomo".into(),
            controller_endpoint: String::new(),
            controller_secret: String::new(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DnsPreview {
    enabled: bool,
    yaml: String,
    warnings: Vec<DnsWarning>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DnsConfigPreview {
    enabled: bool,
    yaml: String,
    warnings: Vec<DnsWarning>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigStatus {
    data_dir: String,
    workspace_path: String,
    config_path: String,
    core_dir: String,
    geodata: Vec<String>,
    has_workspace: bool,
    node_count: usize,
    exit_count: usize,
    rule_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    config_yaml: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigApplyResult {
    ok: bool,
    yaml: String,
    warnings: Vec<DnsWarning>,
    validation: ConfigValidation,
    #[serde(skip_serializing_if = "Option::is_none")]
    snapshot: Option<String>,
}

fn app_data_dir() -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os("YAMLVIM_DATA_DIR") {
        return Ok(PathBuf::from(dir));
    }

    #[cfg(debug_assertions)]
    {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let project = manifest
            .parent()
            .ok_or_else(|| "src-tauri has no parent directory".to_string())?;
        Ok(project.join("data"))
    }

    #[cfg(not(debug_assertions))]
    {
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        let parent = executable
            .parent()
            .ok_or_else(|| "executable has no parent directory".to_string())?;
        Ok(parent.join("data"))
    }
}

fn workspace_path() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("workspace.json"))
}

fn settings_path() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("settings.json"))
}

fn core_data_dir() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("core"))
}

fn exports_dir() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("exports"))
}

fn read_text(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| format!("failed to read {}: {error}", path.display()))
}

fn read_optional(path: &Path) -> Result<Option<String>, String> {
    if path.exists() {
        read_text(path).map(Some)
    } else {
        Ok(None)
    }
}

fn write_atomic(path: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
    }
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, text)
        .map_err(|error| format!("failed to write {}: {error}", temporary.display()))?;
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("failed to replace {}: {error}", path.display()))?;
    }
    fs::rename(&temporary, path)
        .map_err(|error| format!("failed to move {} into place: {error}", temporary.display()))
}

fn timestamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn history_snapshot(_label: &str, _yaml: &str) -> Result<PathBuf, String> {
    Ok(PathBuf::new())
}

fn history_count() -> Result<usize, String> {
    Ok(0)
}

fn is_share_link(token: &str) -> bool {
    for scheme in [
        "ss://",
        "ssr://",
        "vmess://",
        "vless://",
        "trojan://",
        "hysteria2://",
        "hy2://",
        "tuic://",
        "socks5://",
    ] {
        if token.starts_with(scheme) {
            return true;
        }
    }
    false
}

fn contains_share_link(text: &str) -> bool {
    text.split_whitespace().any(is_share_link)
}

fn unique_node_name(base: &str, names: &mut std::collections::BTreeSet<String>) -> String {
    let base = if base.trim().is_empty() {
        "node"
    } else {
        base.trim()
    };
    if names.insert(base.to_string()) {
        return base.to_string();
    }
    let mut index = 2;
    loop {
        let candidate = format!("{base} {index}");
        if names.insert(candidate.clone()) {
            return candidate;
        }
        index += 1;
    }
}

fn looks_like_config(text: &str) -> bool {
    let Ok(value) = serde_yaml::from_str::<serde_yaml::Value>(text) else {
        return false;
    };
    let Some(mapping) = value.as_mapping() else {
        return false;
    };
    [
        "proxies",
        "proxy-groups",
        "rules",
        "mixed-port",
        "port",
        "dns",
    ]
    .iter()
    .any(|key| mapping.contains_key(*key))
}

fn single_node_yaml(text: &str) -> bool {
    let Ok(value) = serde_yaml::from_str::<serde_yaml::Value>(text) else {
        return false;
    };
    let Some(mapping) = value.as_mapping() else {
        return false;
    };
    mapping.contains_key("name") && mapping.contains_key("type")
}

fn decode_base64(text: &str) -> Option<String> {
    let compact: String = text
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect();
    for alphabet in [alphabet::STANDARD, alphabet::URL_SAFE] {
        let engine = GeneralPurpose::new(
            &alphabet,
            GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent),
        );
        if let Ok(bytes) = engine.decode(compact.as_bytes()) {
            if let Ok(text) = String::from_utf8(bytes) {
                return Some(text);
            }
        }
    }
    None
}

fn fetch_text(url: &str) -> Result<String, String> {
    let response = ureq::get(url)
        .set("User-Agent", "YamlVim/0.1")
        .timeout(Duration::from_secs(30))
        .call()
        .map_err(|error| format!("订阅下载失败：{error}"))?;
    response
        .into_string()
        .map_err(|error| format!("订阅内容读取失败：{error}"))
}

fn add_nodes_from_links(text: &str) -> Result<ConfigStatus, String> {
    let links: Vec<&str> = text
        .split_whitespace()
        .filter(|token| is_share_link(token))
        .collect();
    if links.is_empty() {
        return Err("没有识别到节点链接".into());
    }

    let previous = load_workspace_opt()?;
    let mut workspace = previous.clone().unwrap_or_default();
    let mut names: BTreeSet<String> = workspace.proxies.iter().filter_map(proxy_name).collect();
    for link in &links {
        let node = parse_share_link(link)
            .map_err(|error| format!("节点链接解析失败：{}", error.message))?;
        let mut proxy = share_node_to_proxy(&node);
        let raw_name = proxy
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or("node")
            .to_string();
        let name = unique_node_name(&raw_name, &mut names);
        proxy.insert("name".into(), serde_json::Value::String(name.clone()));
        let proxy_value = serde_yaml::to_value(serde_json::Value::Object(proxy))
            .map_err(|error| error.to_string())?;
        workspace.proxies.push(proxy_value);
    }
    workspace.normalize();

    if let Some(previous) = previous {
        let previous_yaml = previous.to_yaml(false).map_err(|error| error.to_string())?;
        history_snapshot("before-add-links", &previous_yaml)?;
    }
    save_workspace_files(&workspace, Some("imported-links"))?;
    config_status()
}

fn proxy_name(value: &serde_yaml::Value) -> Option<String> {
    value
        .as_mapping()?
        .get("name")?
        .as_str()
        .map(str::to_string)
}

fn sanitize_component(value: &str) -> String {
    let mut result = String::new();
    for character in value.chars() {
        if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
            result.push(character);
        } else {
            result.push('_');
        }
    }
    if result.is_empty() {
        "provider".into()
    } else {
        result
    }
}

fn provider_destination(data: &Path, entry: &ProviderPathEntry) -> PathBuf {
    let section = if entry.section == "rule-providers" {
        "rules"
    } else {
        "proxies"
    };
    let file_name = Path::new(entry.path.as_str())
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "provider.yaml".to_string());
    data.join("core")
        .join("providers")
        .join(section)
        .join(sanitize_component(&entry.name))
        .join(file_name)
}

fn copy_workspace_providers(
    workspace: &mut Workspace,
    source_dir: &Path,
    data: &Path,
) -> Result<(), String> {
    let mut value = workspace
        .to_value(true)
        .map_err(|error| error.to_string())?;
    let entries = provider_paths(&value).map_err(|error| error.to_string())?;
    for entry in &entries {
        let source_file = {
            let path = PathBuf::from(entry.path.as_str());
            if path.is_absolute() {
                path
            } else {
                source_dir.join(path)
            }
        };
        let destination = provider_destination(data, entry);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
        }
        if source_file.is_file() && source_file != destination {
            fs::copy(&source_file, &destination).map_err(|error| {
                format!(
                    "failed to copy provider {} to {}: {error}",
                    source_file.display(),
                    destination.display()
                )
            })?;
        }
        set_provider_path(
            &mut value,
            &entry.section,
            &entry.name,
            &destination.display().to_string(),
        )
        .map_err(|error| error.to_string())?;
    }
    *workspace = Workspace::from_value(value).map_err(|error| error.to_string())?;
    Ok(())
}

fn copy_geodata(source_dir: &Path, data: &Path) -> Result<Vec<String>, String> {
    let core = data.join("core");
    fs::create_dir_all(&core)
        .map_err(|error| format!("failed to create {}: {error}", core.display()))?;

    let mut candidates = vec![source_dir.to_path_buf()];
    if let Some(parent) = source_dir.parent() {
        candidates.push(parent.to_path_buf());
        if let Some(grandparent) = parent.parent() {
            candidates.push(grandparent.to_path_buf());
        }
    }

    let mut copied = Vec::new();
    let mut seen = BTreeSet::new();
    for name in GEODATA_FILES {
        if !seen.insert(name.to_ascii_lowercase()) {
            continue;
        }
        let source = candidates
            .iter()
            .map(|directory| directory.join(name))
            .find(|path| path.is_file());
        let Some(source) = source else {
            continue;
        };
        let destination = core.join(name);
        if source != destination {
            fs::copy(&source, &destination).map_err(|error| {
                format!(
                    "failed to copy {} to {}: {error}",
                    source.display(),
                    destination.display()
                )
            })?;
        }
        copied.push((*name).to_string());
    }
    Ok(copied)
}

fn geodata_in(data: &Path) -> Vec<String> {
    let core = data.join("core");
    let mut result = Vec::new();
    let mut seen = BTreeSet::new();
    for name in GEODATA_FILES {
        if !seen.insert(name.to_ascii_lowercase()) {
            continue;
        }
        if core.join(name).is_file() {
            result.push((*name).to_string());
        }
    }
    result
}

fn resolve_core_path(preferred: Option<&str>) -> Result<String, String> {
    if let Some(value) = preferred {
        let value = value.trim();
        if !value.is_empty() && value != "mihomo" {
            return Ok(value.to_string());
        }
    }
    if let Some(value) = std::env::var_os("YAMLVIM_MIHOMO") {
        return Ok(PathBuf::from(value).display().to_string());
    }
    let bin = app_data_dir()?.join("bin");
    for name in ["mihomo.exe", "mihomo", "clash-meta.exe", "clash-meta"] {
        let candidate = bin.join(name);
        if candidate.is_file() {
            return Ok(candidate.display().to_string());
        }
    }
    Ok("mihomo".to_string())
}

fn load_workspace_opt() -> Result<Option<Workspace>, String> {
    let data = app_data_dir()?;
    let workspace_file = workspace_path()?;
    if workspace_file.exists() {
        let text = read_text(&workspace_file)?;
        let workspace = serde_json::from_str::<Workspace>(&text)
            .map_err(|error| format!("failed to parse {}: {error}", workspace_file.display()))?;
        return Ok(Some(workspace));
    }

    for legacy in ["config.yaml", "base.yaml"] {
        let path = data.join(legacy);
        if !path.exists() {
            continue;
        }
        let text = read_text(&path)?;
        let mut workspace = Workspace::from_yaml(&text).map_err(|error| error.to_string())?;
        copy_workspace_providers(&mut workspace, &data, &data)?;
        workspace.normalize();
        let _ = history_snapshot("migrated-legacy", &text);
        save_workspace_files(&workspace, Some("migrated-workspace"))?;
        return Ok(Some(workspace));
    }

    Ok(None)
}

fn load_workspace() -> Result<Workspace, String> {
    load_workspace_opt()?.ok_or_else(|| "尚未导入 mihomo YAML。请先在「配置」页导入。".to_string())
}

fn save_workspace_files(workspace: &Workspace, label: Option<&str>) -> Result<String, String> {
    let data = app_data_dir()?;
    fs::create_dir_all(&data)
        .map_err(|error| format!("failed to create {}: {error}", data.display()))?;
    let json = serde_json::to_string_pretty(workspace).map_err(|error| error.to_string())?;
    write_atomic(&data.join("workspace.json"), &json)?;
    let yaml = workspace
        .to_yaml(false)
        .map_err(|error| error.to_string())?;
    write_atomic(&data.join("config.yaml"), &yaml)?;
    if let Some(label) = label {
        history_snapshot(label, &yaml)?;
    }
    Ok(yaml)
}

#[tauri::command]
fn load_settings() -> Result<AppSettings, String> {
    let path = settings_path()?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let text = read_text(&path)?;
    serde_json::from_str(&text)
        .map_err(|error| format!("failed to parse {}: {error}", path.display()))
}

#[tauri::command]
fn save_settings(settings: AppSettings) -> Result<(), String> {
    let path = settings_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
    }
    let text = serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?;
    write_atomic(&path, &text)
}

#[tauri::command]
fn data_dir() -> Result<String, String> {
    Ok(app_data_dir()?.display().to_string())
}

#[tauri::command]
async fn probe_core(path: String) -> Result<CoreProbe, String> {
    let resolved = resolve_core_path(Some(&path))?;
    tauri::async_runtime::spawn_blocking(move || {
        probe_core_binary(
            &SystemRunner,
            Path::new(&resolved),
            &ProbeOptions::default(),
        )
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn compile_dns_preview(input: DnsInput) -> Result<DnsPreview, String> {
    let compiled = compile_dns(&input).map_err(|error| error.to_string())?;
    let yaml = serde_yaml::to_string(&compiled.output()).map_err(|error| error.to_string())?;
    Ok(DnsPreview {
        enabled: compiled.enabled,
        yaml,
        warnings: compiled.warnings,
    })
}

#[tauri::command]
fn config_status() -> Result<ConfigStatus, String> {
    let data = app_data_dir()?;
    let workspace = load_workspace_opt()?;
    let config_file = data.join("config.yaml");
    let config_yaml = match &workspace {
        Some(workspace) => Some(
            workspace
                .to_yaml(false)
                .map_err(|error| error.to_string())?,
        ),
        None => read_optional(&config_file)?,
    };
    let (node_count, exit_count, rule_count) = match &workspace {
        Some(workspace) => (
            workspace.node_count(),
            workspace.exit_count(),
            workspace.rule_count(),
        ),
        None => (0, 0, 0),
    };

    Ok(ConfigStatus {
        data_dir: data.display().to_string(),
        workspace_path: data.join("workspace.json").display().to_string(),
        config_path: config_file.display().to_string(),
        core_dir: data.join("core").display().to_string(),
        geodata: geodata_in(&data),
        has_workspace: workspace.is_some(),
        node_count,
        exit_count,
        rule_count,
        config_yaml,
    })
}

#[tauri::command]
fn workspace_view() -> Result<WorkspaceView, String> {
    Ok(load_workspace()?.view())
}
#[tauri::command]
fn workspace_dns_yaml() -> Result<String, String> {
    let workspace = load_workspace()?;
    let mut root = Mapping::new();
    if let Some(dns) = &workspace.dns {
        root.insert(serde_yaml::Value::String("dns".into()), dns.clone());
    }
    if !workspace.hosts.is_empty() {
        root.insert(
            serde_yaml::Value::String("hosts".into()),
            serde_yaml::Value::Mapping(workspace.hosts.clone()),
        );
    }
    serde_yaml::to_string(&serde_yaml::Value::Mapping(root)).map_err(|error| error.to_string())
}

#[tauri::command]
async fn apply_dns_yaml(yaml: String) -> Result<ConfigApplyResult, String> {
    let settings = load_settings()?;
    let core = resolve_core_path(Some(&settings.core_path))?;
    let data = app_data_dir()?;
    let workspace = load_workspace()?;

    let parsed: serde_yaml::Value =
        serde_yaml::from_str(&yaml).map_err(|error| error.to_string())?;
    let Some(mapping) = parsed.as_mapping() else {
        return Err("DNS YAML 必须是一个 mapping".into());
    };
    if mapping.is_empty() {
        return Err("DNS YAML 为空".into());
    }

    let dns = match mapping.get("dns") {
        Some(serde_yaml::Value::Null) | None => {
            if mapping.contains_key("hosts") {
                None
            } else {
                Some(serde_yaml::Value::Mapping(mapping.clone()))
            }
        }
        Some(value) => Some(value.clone()),
    };
    let hosts = mapping
        .get("hosts")
        .and_then(|value| value.as_mapping())
        .cloned();

    let mut candidate = workspace.clone();
    if let Some(dns) = dns {
        candidate.dns = Some(dns);
    }
    if let Some(hosts) = hosts {
        candidate.hosts = hosts;
    }
    candidate.normalize();
    let candidate_yaml = candidate
        .to_yaml(false)
        .map_err(|error| error.to_string())?;
    let core_dir = data.join("core");

    let validation = tauri::async_runtime::spawn_blocking({
        let core = core.clone();
        let candidate_yaml = candidate_yaml.clone();
        move || {
            validate_config_binary(
                &SystemRunner,
                Path::new(&core),
                &candidate_yaml,
                &core_dir,
                Duration::from_secs(10),
            )
        }
    })
    .await
    .map_err(|error| error.to_string())?;

    if !validation.ok {
        return Ok(ConfigApplyResult {
            ok: false,
            yaml: candidate_yaml,
            warnings: Vec::new(),
            validation,
            snapshot: None,
        });
    }

    let previous_yaml = workspace
        .to_yaml(false)
        .map_err(|error| error.to_string())?;
    let snapshot = history_snapshot("before-dns-yaml", &previous_yaml)?;
    save_workspace_files(&candidate, Some("dns-yaml"))?;

    Ok(ConfigApplyResult {
        ok: true,
        yaml: candidate_yaml,
        warnings: Vec::new(),
        validation,
        snapshot: Some(snapshot.display().to_string()),
    })
}

fn import_workspace_text(text: &str, source_dir: &Path) -> Result<ConfigStatus, String> {
    let mut workspace = Workspace::from_yaml(text).map_err(|error| error.to_string())?;
    let data = app_data_dir()?;
    fs::create_dir_all(&data)
        .map_err(|error| format!("failed to create {}: {error}", data.display()))?;

    copy_workspace_providers(&mut workspace, source_dir, &data)?;
    copy_geodata(source_dir, &data)?;
    workspace.normalize();

    if let Some(previous) = load_workspace_opt()? {
        let previous_yaml = previous.to_yaml(false).map_err(|error| error.to_string())?;
        history_snapshot("before-import", &previous_yaml)?;
    }
    history_snapshot("import-source", text)?;
    save_workspace_files(&workspace, Some("imported"))?;
    config_status()
}

#[tauri::command]
fn import_config(source: String) -> Result<ConfigStatus, String> {
    let source_path = PathBuf::from(&source);
    let text = read_text(&source_path)?;
    let source_dir = source_path.parent().unwrap_or_else(|| Path::new("."));
    import_workspace_text(&text, source_dir)
}

#[tauri::command]
fn import_config_text(text: String) -> Result<ConfigStatus, String> {
    let data = app_data_dir()?;
    import_workspace_text(&text, &data)
}

#[tauri::command]
fn import_node_links(text: String) -> Result<ConfigStatus, String> {
    add_nodes_from_links(&text)
}

#[tauri::command]
fn import_source(input: String) -> Result<ConfigStatus, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("请输入配置文件路径、订阅链接、节点链接或 YAML".into());
    }
    let data = app_data_dir()?;

    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        let body = fetch_text(trimmed)?;
        return import_text_or_links(&body, &data, true);
    }

    let path = Path::new(trimmed);
    if path.is_file() {
        let body = read_text(path)?;
        let source_dir = path.parent().unwrap_or_else(|| Path::new("."));
        return import_text_or_links(&body, source_dir, true);
    }

    import_text_or_links(trimmed, &data, true)
}

fn import_text_or_links(
    text: &str,
    source_dir: &Path,
    allow_base64: bool,
) -> Result<ConfigStatus, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("内容为空".into());
    }
    if looks_like_config(trimmed) {
        return import_workspace_text(trimmed, source_dir);
    }
    if contains_share_link(trimmed) {
        return add_nodes_from_links(trimmed);
    }
    if single_node_yaml(trimmed) {
        return add_node_yaml(trimmed.to_string());
    }
    if allow_base64 {
        if let Some(decoded) = decode_base64(trimmed) {
            if decoded.trim() != trimmed {
                return import_text_or_links(&decoded, source_dir, false);
            }
        }
    }
    Err("无法识别输入：需要 mihomo 配置 YAML、订阅链接、节点分享链接或文件路径".into())
}

#[tauri::command]
fn preview_dns_config(input: DnsInput) -> Result<DnsConfigPreview, String> {
    let workspace = load_workspace()?;
    let mut input = input;
    input.hosts = workspace.hosts.clone();
    let compiled = compile_dns(&input).map_err(|error| error.to_string())?;
    let mut candidate = workspace;
    candidate.apply_dns(&compiled);
    candidate.normalize();
    let yaml = candidate
        .to_yaml(false)
        .map_err(|error| error.to_string())?;
    Ok(DnsConfigPreview {
        enabled: compiled.enabled,
        yaml,
        warnings: compiled.warnings,
    })
}

#[tauri::command]
async fn validate_config(yaml: String) -> Result<ConfigValidation, String> {
    let settings = load_settings()?;
    let core = resolve_core_path(Some(&settings.core_path))?;
    let core_dir = core_data_dir()?;
    tauri::async_runtime::spawn_blocking(move || {
        validate_config_binary(
            &SystemRunner,
            Path::new(&core),
            &yaml,
            &core_dir,
            Duration::from_secs(10),
        )
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn apply_dns_config(input: DnsInput) -> Result<ConfigApplyResult, String> {
    let settings = load_settings()?;
    let core = resolve_core_path(Some(&settings.core_path))?;
    let data = app_data_dir()?;
    let workspace = load_workspace()?;

    let mut input = input;
    input.hosts = workspace.hosts.clone();
    let compiled = compile_dns(&input).map_err(|error| error.to_string())?;
    let mut candidate = workspace.clone();
    candidate.apply_dns(&compiled);
    candidate.normalize();
    let yaml = candidate
        .to_yaml(false)
        .map_err(|error| error.to_string())?;
    let core_dir = data.join("core");

    let validation = tauri::async_runtime::spawn_blocking({
        let core = core.clone();
        let yaml = yaml.clone();
        move || {
            validate_config_binary(
                &SystemRunner,
                Path::new(&core),
                &yaml,
                &core_dir,
                Duration::from_secs(10),
            )
        }
    })
    .await
    .map_err(|error| error.to_string())?;

    if !validation.ok {
        return Ok(ConfigApplyResult {
            ok: false,
            yaml,
            warnings: compiled.warnings,
            validation,
            snapshot: None,
        });
    }

    let previous_yaml = workspace
        .to_yaml(false)
        .map_err(|error| error.to_string())?;
    let snapshot = history_snapshot("before-apply", &previous_yaml)?;
    save_workspace_files(&candidate, Some("applied"))?;

    Ok(ConfigApplyResult {
        ok: true,
        yaml,
        warnings: compiled.warnings,
        validation,
        snapshot: Some(snapshot.display().to_string()),
    })
}

#[tauri::command]
fn save_workspace_yaml(yaml: String) -> Result<ConfigStatus, String> {
    let previous = load_workspace_opt()?;
    let mut workspace = Workspace::from_yaml(&yaml).map_err(|error| error.to_string())?;
    let data = app_data_dir()?;
    fs::create_dir_all(&data)
        .map_err(|error| format!("failed to create {}: {error}", data.display()))?;

    // The editor sees the safe config, which has controller credentials stripped.
    // Preserve the previous attach credentials when the edited YAML omits them.
    if let Some(previous) = &previous {
        for key in [
            "external-controller",
            "external-controller-pipe",
            "external-controller-unix",
            "external-controller-tls",
            "external-controller-cors",
            "secret",
        ] {
            if !workspace.settings.contains_key(key) {
                if let Some(value) = previous.settings.get(key) {
                    workspace
                        .settings
                        .insert(serde_yaml::Value::String(key.into()), value.clone());
                }
            }
        }
    }

    copy_workspace_providers(&mut workspace, &data, &data)?;
    workspace.normalize();

    if let Some(previous) = previous {
        let previous_yaml = previous.to_yaml(false).map_err(|error| error.to_string())?;
        history_snapshot("before-edit", &previous_yaml)?;
    }
    save_workspace_files(&workspace, Some("edited"))?;
    config_status()
}

#[tauri::command]
fn add_node_yaml(yaml: String) -> Result<ConfigStatus, String> {
    let value: serde_yaml::Value =
        serde_yaml::from_str(&yaml).map_err(|error| error.to_string())?;
    let mut additions = Vec::new();
    match &value {
        serde_yaml::Value::Mapping(mapping) => {
            if let Some(proxies) = mapping
                .get("proxies")
                .and_then(serde_yaml::Value::as_sequence)
            {
                additions.extend(proxies.iter().cloned());
            } else if mapping.contains_key("name") {
                additions.push(value.clone());
            } else {
                return Err("节点 YAML 需要包含 name/type，或一个 proxies 列表".into());
            }
        }
        serde_yaml::Value::Sequence(sequence) => additions.extend(sequence.iter().cloned()),
        _ => return Err("节点 YAML 必须是一个 mapping、mapping 列表或 proxies 列表".into()),
    }
    if additions.is_empty() {
        return Err("没有可添加的节点".into());
    }

    let previous = load_workspace_opt()?;
    let mut workspace = load_workspace()?;
    let mut names: BTreeSet<String> = workspace.proxies.iter().filter_map(proxy_name).collect();
    for addition in &additions {
        if addition.as_mapping().is_none() {
            return Err("每个节点必须是一个 YAML mapping".into());
        }
        let name = proxy_name(addition).ok_or_else(|| "每个节点都需要 name".to_string())?;
        if addition
            .as_mapping()
            .and_then(|mapping| mapping.get("type"))
            .and_then(serde_yaml::Value::as_str)
            .is_none()
        {
            return Err(format!("节点 {name} 缺少 type"));
        }
        if !names.insert(name.clone()) {
            return Err(format!("节点 name 重复：{name}"));
        }
    }

    if let Some(previous) = previous {
        let previous_yaml = previous.to_yaml(false).map_err(|error| error.to_string())?;
        history_snapshot("before-add-node", &previous_yaml)?;
    }
    workspace.proxies.extend(additions);
    workspace.normalize();
    save_workspace_files(&workspace, Some("node-added"))?;
    config_status()
}

fn yaml_mapping(yaml: &str) -> Result<Mapping, String> {
    let value: serde_yaml::Value = serde_yaml::from_str(yaml).map_err(|error| error.to_string())?;
    value
        .as_mapping()
        .cloned()
        .ok_or_else(|| "YAML 必须是一个 mapping".to_string())
}

fn ensure_node_name(mapping: &Mapping) -> Result<String, String> {
    let name = mapping
        .get("name")
        .and_then(serde_yaml::Value::as_str)
        .ok_or_else(|| "节点缺少 name".to_string())?;
    if mapping
        .get("type")
        .and_then(serde_yaml::Value::as_str)
        .is_none()
    {
        return Err(format!("节点 {name} 缺少 type"));
    }
    Ok(name.to_string())
}

fn replace_group_reference(workspace: &mut Workspace, old_name: &str, new_name: &str) {
    for group in &mut workspace.proxy_groups {
        let Some(mapping) = group.as_mapping_mut() else {
            continue;
        };
        if let Some(serde_yaml::Value::Sequence(members)) = mapping.get_mut("proxies") {
            for member in members {
                if member.as_str() == Some(old_name) {
                    *member = serde_yaml::Value::String(new_name.into());
                }
            }
        }
        if let Some(serde_yaml::Value::Sequence(providers)) = mapping.get_mut("use") {
            for provider in providers {
                if provider.as_str() == Some(old_name) {
                    *provider = serde_yaml::Value::String(new_name.into());
                }
            }
        }
    }
    for proxy in &mut workspace.proxies {
        let Some(mapping) = proxy.as_mapping_mut() else {
            continue;
        };
        if let Some(serde_yaml::Value::String(dialer)) = mapping.get_mut("dialer-proxy") {
            if dialer == old_name {
                *dialer = new_name.into();
            }
        }
    }
}

#[tauri::command]
fn node_yaml(name: String) -> Result<String, String> {
    let workspace = load_workspace()?;
    let node = workspace
        .proxies
        .iter()
        .find(|value| proxy_name(value).as_deref() == Some(name.as_str()))
        .ok_or_else(|| format!("节点不存在：{name}"))?;
    serde_yaml::to_string(node).map_err(|error| error.to_string())
}

#[tauri::command]
fn update_node_yaml(old_name: String, yaml: String) -> Result<ConfigStatus, String> {
    let mut workspace = load_workspace()?;
    let new_value =
        serde_yaml::from_str::<serde_yaml::Value>(&yaml).map_err(|error| error.to_string())?;
    let mapping = new_value
        .as_mapping()
        .cloned()
        .ok_or_else(|| "节点 YAML 必须是一个 mapping".to_string())?;
    let new_name = ensure_node_name(&mapping)?;
    if new_name != old_name
        && workspace
            .proxies
            .iter()
            .any(|value| proxy_name(value).as_deref() == Some(new_name.as_str()))
    {
        return Err(format!("节点 name 重复：{new_name}"));
    }
    let index = workspace
        .proxies
        .iter()
        .position(|value| proxy_name(value).as_deref() == Some(old_name.as_str()))
        .ok_or_else(|| format!("节点不存在：{old_name}"))?;
    workspace.proxies[index] = serde_yaml::Value::Mapping(mapping);
    if new_name != old_name {
        replace_group_reference(&mut workspace, &old_name, &new_name);
    }
    workspace.normalize();
    save_workspace_files(&workspace, Some("node-edit"))?;
    config_status()
}

#[tauri::command]
fn delete_node(name: String) -> Result<ConfigStatus, String> {
    let mut workspace = load_workspace()?;
    let before = workspace.proxies.len();
    workspace
        .proxies
        .retain(|value| proxy_name(value).as_deref() != Some(name.as_str()));
    if workspace.proxies.len() == before {
        return Err(format!("节点不存在：{name}"));
    }
    workspace.normalize();
    save_workspace_files(&workspace, Some("node-delete"))?;
    config_status()
}

#[tauri::command]
fn toggle_node(name: String, disabled: bool) -> Result<ConfigStatus, String> {
    let mut workspace = load_workspace()?;
    let node = workspace
        .proxies
        .iter_mut()
        .find(|value| proxy_name(value).as_deref() == Some(name.as_str()))
        .ok_or_else(|| format!("节点不存在：{name}"))?;
    let mapping = node
        .as_mapping_mut()
        .ok_or_else(|| "节点不是 mapping".to_string())?;
    if disabled {
        mapping.insert(
            serde_yaml::Value::String("disabled".into()),
            serde_yaml::Value::Bool(true),
        );
    } else {
        mapping.remove("disabled");
    }
    save_workspace_files(&workspace, Some("node-toggle"))?;
    config_status()
}

#[tauri::command]
fn exit_yaml(name: String) -> Result<String, String> {
    let workspace = load_workspace()?;
    let group = workspace
        .proxy_groups
        .iter()
        .find(|value| proxy_name(value).as_deref() == Some(name.as_str()))
        .ok_or_else(|| format!("出口不存在：{name}"))?;
    serde_yaml::to_string(group).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_exit_yaml(original_name: Option<String>, yaml: String) -> Result<ConfigStatus, String> {
    let mut workspace = load_workspace()?;
    let new_value =
        serde_yaml::from_str::<serde_yaml::Value>(&yaml).map_err(|error| error.to_string())?;
    let mapping = new_value
        .as_mapping()
        .cloned()
        .ok_or_else(|| "出口 YAML 必须是一个 mapping".to_string())?;
    let new_name = ensure_node_name(&mapping)?;
    if let Some(original) = &original_name {
        let index = workspace
            .proxy_groups
            .iter()
            .position(|value| proxy_name(value).as_deref() == Some(original.as_str()))
            .ok_or_else(|| format!("出口不存在：{original}"))?;
        if new_name != *original
            && workspace
                .proxy_groups
                .iter()
                .any(|value| proxy_name(value).as_deref() == Some(new_name.as_str()))
        {
            return Err(format!("出口 name 重复：{new_name}"));
        }
        workspace.proxy_groups[index] = serde_yaml::Value::Mapping(mapping);
        if new_name != *original {
            replace_group_reference(&mut workspace, original, &new_name);
        }
    } else {
        if workspace
            .proxy_groups
            .iter()
            .any(|value| proxy_name(value).as_deref() == Some(new_name.as_str()))
        {
            return Err(format!("出口 name 重复：{new_name}"));
        }
        workspace
            .proxy_groups
            .push(serde_yaml::Value::Mapping(mapping));
    }
    workspace.normalize();
    save_workspace_files(&workspace, Some("exit-edit"))?;
    config_status()
}

#[tauri::command]
fn delete_exit(name: String) -> Result<ConfigStatus, String> {
    let mut workspace = load_workspace()?;
    let before = workspace.proxy_groups.len();
    workspace
        .proxy_groups
        .retain(|value| proxy_name(value).as_deref() != Some(name.as_str()));
    if workspace.proxy_groups.len() == before {
        return Err(format!("出口不存在：{name}"));
    }
    workspace.normalize();
    save_workspace_files(&workspace, Some("exit-delete"))?;
    config_status()
}

#[tauri::command]
fn save_rules(rules: Vec<String>) -> Result<ConfigStatus, String> {
    let mut workspace = load_workspace()?;
    workspace.rules = rules.into_iter().map(serde_yaml::Value::String).collect();
    workspace.normalize();
    save_workspace_files(&workspace, Some("rules-edit"))?;
    config_status()
}

#[tauri::command]
async fn controller_get(path: String) -> Result<String, String> {
    let settings = load_settings()?;
    let endpoint = settings.controller_endpoint.trim().to_string();
    if endpoint.is_empty() {
        return Err("请先在内核页配置控制器地址和密钥".into());
    }
    let client = ControllerClient::from_parts(
        &endpoint,
        &settings.controller_secret,
        ControllerTransport::Tcp,
    );
    client.get(&path)
}

#[tauri::command]
async fn controller_delay(name: String) -> Result<DelayResult, String> {
    let settings = load_settings()?;
    let endpoint = settings.controller_endpoint.trim().to_string();
    if endpoint.is_empty() {
        return Err("请先配置控制器".into());
    }
    let client = ControllerClient::from_parts(
        &endpoint,
        &settings.controller_secret,
        ControllerTransport::Tcp,
    );
    let result = client.test_delay(&name, "https://www.gstatic.com/generate_204", 5_000);
    match result {
        Ok(delay) => Ok(DelayResult {
            name,
            delay_ms: Some(delay),
            error: None,
        }),
        Err(error) => Ok(DelayResult {
            name,
            delay_ms: None,
            error: Some(error),
        }),
    }
}

#[tauri::command]
fn save_controller(endpoint: String, secret: String) -> Result<(), String> {
    let mut settings = load_settings()?;
    settings.controller_endpoint = endpoint.trim().to_string();
    settings.controller_secret = secret.trim().to_string();
    save_settings(settings)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportEntry {
    name: String,
    path: String,
    size_bytes: u64,
}

#[tauri::command]
fn list_exports() -> Result<Vec<ExportEntry>, String> {
    let dir = exports_dir()?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let entries =
        fs::read_dir(&dir).map_err(|error| format!("failed to read {}: {error}", dir.display()))?;
    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) == Some("yaml") {
            let metadata = entry
                .metadata()
                .map_err(|error| format!("failed to read metadata: {error}"))?;
            result.push(ExportEntry {
                name: path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string(),
                path: path.display().to_string(),
                size_bytes: metadata.len(),
            });
        }
    }
    result.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(result)
}

#[tauri::command]
fn read_export(path: String) -> Result<String, String> {
    read_text(Path::new(&path))
}

#[tauri::command]
fn load_export_as_workspace(path: String) -> Result<ConfigStatus, String> {
    let text = read_text(Path::new(&path))?;
    let mut workspace = Workspace::from_yaml(&text).map_err(|error| error.to_string())?;
    let data = app_data_dir()?;
    fs::create_dir_all(&data)
        .map_err(|error| format!("failed to create {}: {error}", data.display()))?;
    copy_workspace_providers(&mut workspace, &data, &data)?;
    workspace.normalize();
    save_workspace_files(&workspace, Some("loaded-export"))?;
    config_status()
}

#[tauri::command]
async fn switch_proxy(group: String, name: String) -> Result<String, String> {
    let settings = load_settings()?;
    let endpoint = settings.controller_endpoint.trim().to_string();
    if endpoint.is_empty() {
        return Err("请先配置控制器地址和密钥".into());
    }
    let client = ControllerClient::from_parts(
        &endpoint,
        &settings.controller_secret,
        ControllerTransport::Tcp,
    );
    let encoded = group
        .as_bytes()
        .iter()
        .map(|byte| format!("%{:02X}", byte))
        .collect::<String>();
    let body = format!("{{\"name\":\"{name}\"}}");
    client.put(&format!("/proxies/{encoded}"), &body)
}

#[tauri::command]
fn export_config() -> Result<String, String> {
    let workspace = load_workspace()?;
    let yaml = workspace
        .to_yaml(false)
        .map_err(|error| error.to_string())?;
    let exports = exports_dir()?;
    fs::create_dir_all(&exports)
        .map_err(|error| format!("failed to create {}: {error}", exports.display()))?;
    let path = exports.join(format!("config-{}.yaml", timestamp()));
    write_atomic(&path, &yaml)?;
    history_snapshot("export", &yaml)?;
    Ok(path.display().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            data_dir,
            probe_core,
            config_status,
            workspace_view,
            workspace_dns_yaml,
            apply_dns_yaml,
            import_config,
            validate_config,
            apply_dns_config,
            save_workspace_yaml,
            add_node_yaml,
            export_config,
            import_source,
            import_config_text,
            import_node_links,
            controller_get,
            controller_delay,
            save_controller,
            list_exports,
            read_export,
            load_export_as_workspace,
            switch_proxy,
            node_yaml,
            update_node_yaml,
            delete_node,
            toggle_node,
            exit_yaml,
            save_exit_yaml,
            delete_exit,
            save_rules
        ])
        .run(tauri::generate_context!())
        .expect("error while running YamlVim");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("yamlvim-tauri-{label}-{nanos}"))
    }

    #[test]
    fn import_and_export_use_the_workspace_only() {
        let root = temp_dir("import");
        let source = root.join("source");
        let rules = source.join("rules");
        let data = root.join("data");
        fs::create_dir_all(&rules).unwrap();

        let provider = rules.join("private.yaml");
        fs::write(&provider, "payload:\n  - example.org\n").unwrap();
        fs::write(source.join("GEOIP.dat"), b"fake-geodata").unwrap();

        let config = format!(
            "mixed-port: 17899\nmode: rule\nlog-level: silent\nexternal-controller: 127.0.0.1:9090\nsecret: local-secret\nproxies:\n  - name: node-a\n    type: ss\n    server: a.example.com\n    port: 443\n    cipher: aes-128-gcm\n    password: secret\nproxy-groups:\n  - name: Auto\n    type: select\n    proxies: [node-a]\nrules:\n  - MATCH,Auto\nrule-providers:\n  private:\n    type: file\n    behavior: domain\n    path: {}\n",
            provider.display()
        );
        let source_config = source.join("config.yaml");
        fs::write(&source_config, &config).unwrap();

        let previous = std::env::var_os("YAMLVIM_DATA_DIR");
        std::env::set_var("YAMLVIM_DATA_DIR", &data);
        let status = import_config(source_config.display().to_string()).unwrap();
        let export_path = export_config().unwrap();

        let workspace_text = fs::read_to_string(data.join("workspace.json")).unwrap();
        let mut workspace: Workspace = serde_json::from_str(&workspace_text).unwrap();
        workspace.proxies.retain(|proxy| {
            proxy
                .as_mapping()
                .and_then(|mapping| mapping.get("name"))
                .and_then(serde_yaml::Value::as_str)
                != Some("node-a")
        });
        let edited_yaml = workspace.to_yaml(false).unwrap();
        let edited_status = save_workspace_yaml(edited_yaml).unwrap();
        let second_export = export_config().unwrap();
        let added_status = add_node_yaml(
            "name: node-c\ntype: ss\nserver: c.example.com\nport: 443\ncipher: aes-128-gcm\npassword: secret\n"
                .into(),
        )
        .unwrap();
        let third_export = export_config().unwrap();

        match previous {
            Some(value) => std::env::set_var("YAMLVIM_DATA_DIR", value),
            None => std::env::remove_var("YAMLVIM_DATA_DIR"),
        }

        assert!(status.has_workspace);
        assert_eq!(status.node_count, 1);
        assert_eq!(status.exit_count, 1);
        assert_eq!(status.rule_count, 1);
        assert!(status
            .geodata
            .iter()
            .any(|name| name.eq_ignore_ascii_case("GEOIP.dat")));
        assert!(!data.join("base.yaml").exists());

        let workspace_text = fs::read_to_string(data.join("workspace.json")).unwrap();
        let workspace: Workspace = serde_json::from_str(&workspace_text).unwrap();
        assert_eq!(workspace.node_count(), 1);

        let generated = fs::read_to_string(data.join("config.yaml")).unwrap();
        assert!(!generated.contains("node-a"));
        assert!(!generated.contains("external-controller"));
        assert!(!generated.contains("local-secret"));
        assert!(generated.contains("providers"));
        assert!(generated.contains("private.yaml"));

        let copied_provider = data
            .join("core")
            .join("providers")
            .join("rules")
            .join("private")
            .join("private.yaml");
        assert!(copied_provider.is_file());
        assert!(data.join("core").join("GEOIP.dat").is_file());
        assert_eq!(fs::read_to_string(&source_config).unwrap(), config);

        let exported = fs::read_to_string(&export_path).unwrap();
        assert!(exported.contains("node-a"));
        assert!(!exported.contains("external-controller"));
        assert!(export_path.contains("exports"));

        assert_eq!(edited_status.node_count, 0);
        let second = fs::read_to_string(second_export).unwrap();
        assert!(!second.contains("node-a"));
        assert_eq!(added_status.node_count, 1);
        let third = fs::read_to_string(third_export).unwrap();
        assert!(third.contains("node-c"));
        let _ = fs::remove_dir_all(root);
    }
}
