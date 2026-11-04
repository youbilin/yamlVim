use std::collections::BTreeSet;

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

use base64::alphabet;
use base64::engine::{general_purpose::GeneralPurpose, DecodePaddingMode, GeneralPurposeConfig};
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_yaml::Mapping;
mod share;

use yamlvim_core::{
    compile_dns, parse_share_link, provider_paths, set_provider_path, share_node_to_proxy,
    DnsInput, DnsWarning, ProviderPathEntry, Workspace, WorkspaceView,
};
use yamlvim_mihomo::{
    probe_core as probe_core_binary, validate_config as validate_config_binary, ConfigValidation,
    ControllerClient, ControllerTransport, CoreProbe, DelayResult, ProbeOptions, SystemRunner,
};

const DEFAULT_DNS_YAML: &str = include_str!("../defaults/dns-default.yaml");

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuleCatalogItem {
    slug: String,
    provider_name: String,
    kind: String,
    behavior: String,
    url: String,
    format: String,
    popular: bool,
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

fn core_available(core: &str) -> bool {
    let path = Path::new(core);
    if path.is_absolute() || core.contains('\\') || core.contains('/') {
        return path.is_file();
    }
    true
}

fn missing_core_validation(core: &str) -> ConfigValidation {
    ConfigValidation {
        ok: false,
        status: None,
        timed_out: false,
        output: format!(
            "未找到 mihomo 内核（{core}）。mihomo -t 校验只需要内核可执行文件，不需要连接内核；请在「内核」页设置 mihomo 路径，或把 mihomo.exe 放到数据目录的 bin 文件夹。"
        ),
    }
}

fn skipped_core_validation() -> ConfigValidation {
    ConfigValidation {
        ok: true,
        status: None,
        timed_out: false,
        output: "未找到 mihomo 内核，已跳过 mihomo -t 校验。".to_string(),
    }
}

fn friendly_validation(validation: ConfigValidation, core: &str) -> ConfigValidation {
    if !validation.ok && validation.output.contains("failed to start process") {
        return ConfigValidation {
            ok: false,
            status: validation.status,
            timed_out: validation.timed_out,
            output: format!(
                "无法启动 mihomo 内核（{core}）。请到「内核」页确认 mihomo 可执行文件路径。\n{}",
                validation.output
            ),
        };
    }
    validation
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
fn save_dns_default(yaml: String) -> Result<String, String> {
    let value: serde_yaml::Value =
        serde_yaml::from_str(&yaml).map_err(|error| error.to_string())?;
    if value.as_mapping().is_none() {
        return Err("DNS YAML 必须是一个 mapping".into());
    }
    let data = app_data_dir()?;
    fs::create_dir_all(&data)
        .map_err(|error| format!("failed to create {}: {error}", data.display()))?;
    let path = data.join("dns-default.yaml");
    write_atomic(&path, &yaml)?;
    Ok(path.display().to_string())
}

#[tauri::command]
fn load_dns_default() -> Result<Option<String>, String> {
    let path = app_data_dir()?.join("dns-default.yaml");
    if !path.exists() {
        return Ok(Some(DEFAULT_DNS_YAML.to_string()));
    }
    read_text(&path).map(Some)
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

    let core_missing = !core_available(&core);
    let validation = if core_missing {
        skipped_core_validation()
    } else {
        friendly_validation(
            tauri::async_runtime::spawn_blocking({
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
            .map_err(|error| error.to_string())?,
            &core,
        )
    };

    let mut warnings = Vec::new();
    if core_missing {
        warnings.push(DnsWarning {
            code: "core-missing".into(),
            message: "未找到 mihomo 内核，已跳过 mihomo -t 校验；导出前请在「内核」页配置内核路径。"
                .into(),
            rule: None,
        });
    }

    if !validation.ok {
        return Ok(ConfigApplyResult {
            ok: false,
            yaml: candidate_yaml,
            warnings,
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
        warnings,
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

#[derive(Debug, Clone, Deserialize)]
struct VergeProfileItem {
    uid: Option<String>,
    name: Option<String>,
    file: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VergeProfilesFile {
    current: Option<String>,
    items: Option<Vec<VergeProfileItem>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VergeProfile {
    uid: String,
    name: String,
    file: String,
    current: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VergeProfilesView {
    dir: String,
    profiles: Vec<VergeProfile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VergeImportResult {
    status: ConfigStatus,
    profile: String,
    controller_set: Option<String>,
}

fn verge_data_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(dir) = std::env::var_os("YAMLVIM_VERGE_DIR") {
        dirs.push(PathBuf::from(dir));
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        let base = PathBuf::from(appdata);
        for name in [
            "io.github.clash-verge-rev.clash-verge-rev",
            "top.gydi.clashverge",
            "clash-verge",
            "clash-verge-rev",
        ] {
            dirs.push(base.join(name));
        }
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        dirs.push(PathBuf::from(local).join("io.github.clash-verge-rev.clash-verge-rev"));
    }
    dirs
}

fn find_verge_dir() -> Result<PathBuf, String> {
    verge_data_dirs()
        .into_iter()
        .find(|dir| dir.join("profiles.yaml").is_file())
        .ok_or_else(|| "未找到 Clash Verge 数据目录（profiles.yaml）".into())
}

fn read_verge_profile_list(dir: &Path) -> Result<(Option<String>, Vec<VergeProfileItem>), String> {
    let text = read_text(&dir.join("profiles.yaml"))?;
    let parsed: VergeProfilesFile =
        serde_yaml::from_str(&text).map_err(|error| format!("profiles.yaml 解析失败：{error}"))?;
    Ok((parsed.current, parsed.items.unwrap_or_default()))
}

fn verge_profile_file(dir: &Path, item: &VergeProfileItem) -> Option<String> {
    let file = item.file.as_deref()?.trim();
    (!file.is_empty() && dir.join("profiles").join(file).is_file()).then(|| file.to_string())
}

fn maybe_apply_verge_controller(dir: &Path) -> Result<Option<String>, String> {
    let Ok(text) = read_text(&dir.join("config.yaml")) else {
        return Ok(None);
    };
    let Ok(value) = serde_yaml::from_str::<serde_yaml::Value>(&text) else {
        return Ok(None);
    };
    let Some(endpoint) = value
        .get("external-controller")
        .and_then(serde_yaml::Value::as_str)
        .map(str::trim)
        .filter(|endpoint| !endpoint.is_empty())
    else {
        return Ok(None);
    };
    let secret = value
        .get("secret")
        .and_then(serde_yaml::Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    let mut settings = load_settings()?;
    if !settings.controller_endpoint.trim().is_empty() {
        return Ok(None);
    }
    settings.controller_endpoint = endpoint.to_string();
    settings.controller_secret = secret;
    save_settings(settings)?;
    Ok(Some(endpoint.to_string()))
}

#[tauri::command]
fn clash_verge_profiles() -> Result<VergeProfilesView, String> {
    let dir = find_verge_dir()?;
    let (current, items) = read_verge_profile_list(&dir)?;
    let mut profiles = Vec::new();
    for item in items {
        let Some(file) = verge_profile_file(&dir, &item) else {
            continue;
        };
        let is_current = item.uid.is_some() && item.uid == current;
        profiles.push(VergeProfile {
            uid: item.uid.clone().unwrap_or_else(|| file.clone()),
            name: item.name.clone().unwrap_or_else(|| file.clone()),
            file,
            current: is_current,
        });
    }
    Ok(VergeProfilesView {
        dir: dir.display().to_string(),
        profiles,
    })
}

#[tauri::command]
fn import_clash_verge(uid: Option<String>) -> Result<VergeImportResult, String> {
    let dir = find_verge_dir()?;
    let (current, items) = read_verge_profile_list(&dir)?;
    let mut chosen: Option<&VergeProfileItem> = None;
    for item in &items {
        if verge_profile_file(&dir, item).is_none() {
            continue;
        }
        let matches = match &uid {
            Some(want) => item.uid.as_deref() == Some(want.as_str()),
            None => item.uid.is_some() && item.uid == current,
        };
        if matches {
            chosen = Some(item);
            break;
        }
        chosen = chosen.or(Some(item));
    }
    let item = chosen.ok_or_else(|| "Clash Verge 没有可导入的订阅文件".to_string())?;
    let file = verge_profile_file(&dir, item)
        .ok_or_else(|| "Clash Verge 没有可导入的订阅文件".to_string())?;
    let profiles_dir = dir.join("profiles");
    let text = read_text(&profiles_dir.join(&file))?;
    let status = import_workspace_text(&text, &profiles_dir)?;
    let controller_set = maybe_apply_verge_controller(&dir)?;
    Ok(VergeImportResult {
        status,
        profile: item.name.clone().unwrap_or_else(|| file.clone()),
        controller_set,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VergeExportResult {
    profile: String,
    file: String,
    verge_dir: String,
    providers_copied: usize,
}

fn sanitize_verge_name(name: Option<&str>) -> String {
    let trimmed = name
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or("YamlVim");
    trimmed
        .chars()
        .map(|character| match character {
            '\n' | '\r' | '/' | '\\' | ':' => ' ',
            other => other,
        })
        .collect::<String>()
        .trim()
        .chars()
        .take(60)
        .collect()
}

#[tauri::command]
fn export_to_clash_verge(name: Option<String>) -> Result<VergeExportResult, String> {
    let dir = find_verge_dir()?;
    let profiles_dir = dir.join("profiles");
    fs::create_dir_all(&profiles_dir)
        .map_err(|error| format!("failed to create {}: {error}", profiles_dir.display()))?;

    let workspace = load_workspace()?;
    let (yaml, provider_copies) = portable_external_yaml(&workspace)?;

    let now_millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0);
    let uid = format!("yamlvim-{now_millis}");
    let profile_name = sanitize_verge_name(name.as_deref());
    let file = format!("{uid}.yaml");
    write_atomic(&profiles_dir.join(&file), &yaml)?;

    // 复制本地规则/代理提供者文件，Verge 以它的数据目录为 -d 根
    let mut providers_copied = 0usize;
    for (source, relative) in provider_copies {
        if !source.is_file() {
            continue;
        }
        let target = dir.join(&relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
        }
        // 提供者文件可能被内核或杀毒软件短暂占用，复制失败时跳过，不影响订阅写入
        if fs::copy(&source, &target).is_ok() {
            providers_copied += 1;
        }
    }

    let profiles_path = dir.join("profiles.yaml");
    let text = read_text(&profiles_path)?;
    let mut value: serde_yaml::Value =
        serde_yaml::from_str(&text).map_err(|error| format!("profiles.yaml 解析失败：{error}"))?;
    let Some(mapping) = value.as_mapping_mut() else {
        return Err("profiles.yaml 结构无效".into());
    };
    let items = mapping
        .entry(serde_yaml::Value::String("items".into()))
        .or_insert_with(|| serde_yaml::Value::Sequence(Vec::new()));
    let Some(sequence) = items.as_sequence_mut() else {
        return Err("profiles.yaml items 结构无效".into());
    };
    sequence.retain(|item| {
        item.get("uid").and_then(serde_yaml::Value::as_str) != Some(uid.as_str())
    });
    let mut item = Mapping::new();
    item.insert(
        serde_yaml::Value::String("uid".into()),
        serde_yaml::Value::String(uid.clone()),
    );
    item.insert(
        serde_yaml::Value::String("name".into()),
        serde_yaml::Value::String(profile_name.clone()),
    );
    item.insert(
        serde_yaml::Value::String("type".into()),
        serde_yaml::Value::String("local".into()),
    );
    item.insert(
        serde_yaml::Value::String("file".into()),
        serde_yaml::Value::String(file.clone()),
    );
    item.insert(
        serde_yaml::Value::String("updated".into()),
        serde_yaml::Value::Number(now_millis.into()),
    );
    sequence.push(serde_yaml::Value::Mapping(item));
    mapping.insert(
        serde_yaml::Value::String("current".into()),
        serde_yaml::Value::String(uid.clone()),
    );
    let updated_text = serde_yaml::to_string(&value).map_err(|error| error.to_string())?;
    write_atomic(&profiles_path, &updated_text)?;

    Ok(VergeExportResult {
        profile: profile_name,
        file,
        verge_dir: dir.display().to_string(),
        providers_copied,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShareInfoView {
    url: String,
    scheme_url: String,
    expires_at: u64,
}

fn share_server() -> std::sync::MutexGuard<'static, share::ShareServer> {
    static SERVER: std::sync::OnceLock<std::sync::Mutex<share::ShareServer>> =
        std::sync::OnceLock::new();
    SERVER
        .get_or_init(|| std::sync::Mutex::new(share::ShareServer::new()))
        .lock()
        .unwrap_or_else(|error| error.into_inner())
}

#[tauri::command]
fn share_to_clash_verge() -> Result<ShareInfoView, String> {
    let workspace = load_workspace()?;
    let (yaml, _) = portable_external_yaml(&workspace)?;
    let info = share_server().publish(yaml)?;
    Ok(ShareInfoView {
        url: info.url,
        scheme_url: info.scheme_url,
        expires_at: info.expires_at,
    })
}

fn open_in_shell(url: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/c", "start", "", url])
            .creation_flags(0x0800_0000)
            .spawn()
            .is_ok()
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(url).spawn().is_ok()
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open").arg(url).spawn().is_ok()
    }
}

#[tauri::command]
fn open_external_url(url: String) -> Result<bool, String> {
    let url = url.trim();
    let allowed = url.starts_with("http://")
        || url.starts_with("https://")
        || url.starts_with("clash://");
    if !allowed {
        return Err("只允许打开 http/https/clash 地址".into());
    }
    if url.contains('\r') || url.contains('\n') {
        return Err("地址格式无效".into());
    }
    let opened = open_in_shell(url);
    Ok(opened)
}

/// 生成对外使用的 YAML：provider 路径改写为 home 内相对路径，
/// 并返回需要随配置一起复制的本地文件（源路径, 相对目标）。
fn portable_external_yaml(workspace: &Workspace) -> Result<(String, Vec<(PathBuf, String)>), String> {
    let mut portable = workspace.clone();
    let core_dir = core_data_dir()?;
    let mut copies: Vec<(PathBuf, String)> = Vec::new();
    for providers in [
        &mut portable.rule_providers,
        &mut portable.proxy_providers,
    ] {
        for (name, provider) in providers.iter_mut() {
            let Some(mapping) = provider.as_mapping_mut() else {
                continue;
            };
            let Some(provider_name) = name.as_str() else {
                continue;
            };
            let Some(old_path) = mapping
                .get("path")
                .and_then(serde_yaml::Value::as_str)
                .map(str::to_string)
            else {
                continue;
            };
            let extension = Path::new(&old_path)
                .extension()
                .and_then(|ext| ext.to_str())
                .unwrap_or("mrs")
                .to_string();
            let relative = format!(
                "./rules/{}.{}",
                sanitize_component(provider_name),
                extension
            );
            mapping.insert(
                serde_yaml::Value::String("path".into()),
                serde_yaml::Value::String(relative.clone()),
            );
            let source = {
                let path = Path::new(&old_path);
                if path.is_absolute() {
                    path.to_path_buf()
                } else {
                    core_dir.join(path)
                }
            };
            copies.push((source, relative.trim_start_matches("./").to_string()));
        }
    }
    let yaml = portable.to_yaml(false).map_err(|error| error.to_string())?;
    Ok((yaml, copies))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportBatchResult {
    status: ConfigStatus,
    added_nodes: u64,
    added_exits: u64,
    added_rules: u64,
    errors: Vec<String>,
}

fn looks_like_path(text: &str) -> bool {
    let bytes = text.as_bytes();
    text.starts_with('/')
        || text.starts_with("./")
        || text.starts_with(".\\")
        || (bytes.len() >= 3 && bytes[1] == b':' && (bytes[2] == b'\\' || bytes[2] == b'/'))
}

fn import_single_source(line: &str, data: &Path) -> Result<ConfigStatus, String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Err("内容为空".into());
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        let body = fetch_text(trimmed)?;
        return import_text_or_links(&body, data, true);
    }
    let path = Path::new(trimmed);
    if path.is_file() {
        let body = read_text(path)?;
        let source_dir = path.parent().unwrap_or_else(|| Path::new("."));
        return import_text_or_links(&body, source_dir, true);
    }
    if looks_like_path(trimmed) {
        return Err(format!("文件不存在：{trimmed}"));
    }
    import_text_or_links(trimmed, data, true)
}

#[tauri::command]
fn import_source(input: String) -> Result<ImportBatchResult, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("请输入配置文件路径、订阅链接、节点链接或 YAML".into());
    }
    let data = app_data_dir()?;

    // 整段 YAML 配置或单个节点 YAML 保持一次性导入的语义
    if looks_like_config(trimmed) {
        let status = import_workspace_text(trimmed, &data)?;
        return Ok(ImportBatchResult {
            status,
            added_nodes: 0,
            added_exits: 0,
            added_rules: 0,
            errors: Vec::new(),
        });
    }
    if single_node_yaml(trimmed) {
        let status = add_node_yaml(trimmed.to_string())?;
        return Ok(ImportBatchResult {
            status,
            added_nodes: 0,
            added_exits: 0,
            added_rules: 0,
            errors: Vec::new(),
        });
    }

    let lines: Vec<String> = trimmed
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect();
    if lines.is_empty() {
        return Err("请输入配置文件路径、订阅链接、节点链接或 YAML".into());
    }

    let mut counts = config_status()?;
    let mut added_nodes = 0u64;
    let mut added_exits = 0u64;
    let mut added_rules = 0u64;
    let mut errors = Vec::new();

    for (index, line) in lines.iter().enumerate() {
        match import_single_source(line, &data) {
            Ok(status) => {
                added_nodes += (status.node_count as u64).saturating_sub(counts.node_count as u64);
                added_exits += (status.exit_count as u64).saturating_sub(counts.exit_count as u64);
                added_rules += (status.rule_count as u64).saturating_sub(counts.rule_count as u64);
                counts = status;
            }
            Err(error) => errors.push(format!("第 {} 行：{}", index + 1, error)),
        }
    }

    if errors.len() == lines.len() {
        return Err(errors.join("；"));
    }

    let status = config_status()?;
    Ok(ImportBatchResult {
        status,
        added_nodes,
        added_exits,
        added_rules,
        errors,
    })
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
async fn validate_config(yaml: String) -> Result<ConfigValidation, String> {
    let settings = load_settings()?;
    let core = resolve_core_path(Some(&settings.core_path))?;
    let core_dir = core_data_dir()?;
    if !core_available(&core) {
        return Ok(missing_core_validation(&core));
    }
    tauri::async_runtime::spawn_blocking(move || {
        friendly_validation(
            validate_config_binary(
                &SystemRunner,
                Path::new(&core),
                &yaml,
                &core_dir,
                Duration::from_secs(10),
            ),
            &core,
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

    let core_missing = !core_available(&core);
    let validation = if core_missing {
        skipped_core_validation()
    } else {
        friendly_validation(
            tauri::async_runtime::spawn_blocking({
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
            .map_err(|error| error.to_string())?,
            &core,
        )
    };

    let mut warnings = compiled.warnings;
    if core_missing {
        warnings.push(DnsWarning {
            code: "core-missing".into(),
            message: "未找到 mihomo 内核，已跳过 mihomo -t 校验；导出前请在「内核」页配置内核路径。"
                .into(),
            rule: None,
        });
    }

    if !validation.ok {
        return Ok(ConfigApplyResult {
            ok: false,
            yaml,
            warnings,
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
        warnings,
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
fn delete_nodes(names: Vec<String>) -> Result<ConfigStatus, String> {
    let targets: BTreeSet<String> = names.into_iter().collect();
    if targets.is_empty() {
        return Err("没有选择节点".into());
    }
    let mut workspace = load_workspace()?;
    let before = workspace.proxies.len();
    workspace
        .proxies
        .retain(|value| !proxy_name(value).is_some_and(|name| targets.contains(&name)));
    let removed = before - workspace.proxies.len();
    if removed == 0 {
        return Err("没有匹配的节点".into());
    }
    workspace.normalize();
    save_workspace_files(&workspace, Some("nodes-delete"))?;
    config_status()
}

#[tauri::command]
fn set_nodes_disabled(names: Vec<String>, disabled: bool) -> Result<ConfigStatus, String> {
    let targets: BTreeSet<String> = names.into_iter().collect();
    if targets.is_empty() {
        return Err("没有选择节点".into());
    }
    let mut workspace = load_workspace()?;
    let mut changed = 0;
    for value in &mut workspace.proxies {
        let Some(name) = proxy_name(value) else {
            continue;
        };
        if !targets.contains(&name) {
            continue;
        }
        let Some(mapping) = value.as_mapping_mut() else {
            continue;
        };
        if disabled {
            mapping.insert(
                serde_yaml::Value::String("disabled".into()),
                serde_yaml::Value::Bool(true),
            );
        } else {
            mapping.remove("disabled");
        }
        changed += 1;
    }
    if changed == 0 {
        return Err("没有匹配的节点".into());
    }
    save_workspace_files(&workspace, Some("nodes-toggle"))?;
    config_status()
}

#[tauri::command]
fn add_rule_sets(items: Vec<RuleCatalogItem>, target: String) -> Result<ConfigStatus, String> {
    if items.is_empty() {
        return Err("没有选择规则集".into());
    }
    let target = target.trim();
    if target.is_empty() {
        return Err("请选择目标".into());
    }
    let mut workspace = load_workspace()?;
    let rules_dir = core_data_dir()?.join("rules");
    fs::create_dir_all(&rules_dir)
        .map_err(|error| format!("failed to create {}: {error}", rules_dir.display()))?;

    for item in items {
        let provider_name = item.provider_name;
        let provider_key = serde_yaml::Value::String(provider_name.clone());
        if !workspace.rule_providers.contains_key(&provider_key) {
            let mut provider = Mapping::new();
            provider.insert(
                serde_yaml::Value::String("type".into()),
                serde_yaml::Value::String("http".into()),
            );
            provider.insert(
                serde_yaml::Value::String("behavior".into()),
                serde_yaml::Value::String(item.behavior),
            );
            provider.insert(
                serde_yaml::Value::String("url".into()),
                serde_yaml::Value::String(item.url),
            );
            provider.insert(
                serde_yaml::Value::String("path".into()),
                serde_yaml::Value::String(format!(
                    "./rules/{}.mrs",
                    sanitize_component(&provider_name)
                )),
            );
            provider.insert(
                serde_yaml::Value::String("interval".into()),
                serde_yaml::Value::Number(serde_yaml::Number::from(86400)),
            );
            provider.insert(
                serde_yaml::Value::String("format".into()),
                serde_yaml::Value::String(item.format),
            );
            workspace
                .rule_providers
                .insert(provider_key, serde_yaml::Value::Mapping(provider));
        }
        let rule = format!("RULE-SET,{provider_name},{target}");
        if !workspace
            .rules
            .iter()
            .any(|value| value.as_str() == Some(rule.as_str()))
        {
            workspace.rules.push(serde_yaml::Value::String(rule));
        }
    }

    workspace.normalize();
    save_workspace_files(&workspace, Some("rule-sets-add"))?;
    config_status()
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TemplateProviderInput {
    name: String,
    behavior: String,
    url: String,
    #[serde(default = "default_provider_format")]
    format: String,
}

fn default_provider_format() -> String {
    "mrs".to_string()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TemplateRuleInput {
    provider: String,
    target: String,
    #[serde(default)]
    no_resolve: bool,
}

#[tauri::command]
fn apply_group_template(
    groups: Vec<serde_yaml::Value>,
    providers: Vec<TemplateProviderInput>,
    rules: Vec<TemplateRuleInput>,
    match_target: String,
) -> Result<ConfigStatus, String> {
    if groups.is_empty() {
        return Err("模板没有策略组".into());
    }
    let match_target = match_target.trim();
    if match_target.is_empty() {
        return Err("模板缺少 MATCH 目标".into());
    }

    let mut workspace = load_workspace()?;

    for group in groups {
        let mapping = group
            .as_mapping()
            .ok_or_else(|| "策略组必须是 mapping".to_string())?;
        let name = mapping
            .get("name")
            .and_then(serde_yaml::Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .ok_or_else(|| "策略组缺少 name".to_string())?;
        if mapping
            .get("proxies")
            .and_then(serde_yaml::Value::as_sequence)
            .is_none()
        {
            return Err(format!("策略组 {name} 缺少 proxies"));
        }
        let replacement = serde_yaml::Value::Mapping(mapping.clone());
        if let Some(index) = workspace
            .proxy_groups
            .iter()
            .position(|value| proxy_name(value).as_deref() == Some(name))
        {
            workspace.proxy_groups[index] = replacement;
        } else {
            workspace.proxy_groups.push(replacement);
        }
    }

    let provider_names: BTreeSet<String> = providers.iter().map(|item| item.name.clone()).collect();

    for provider in providers {
        let provider_name = provider.name.trim();
        if provider_name.is_empty() {
            return Err("规则集缺少名称".into());
        }
        let mut mapping = Mapping::new();
        mapping.insert(
            serde_yaml::Value::String("type".into()),
            serde_yaml::Value::String("http".into()),
        );
        mapping.insert(
            serde_yaml::Value::String("behavior".into()),
            serde_yaml::Value::String(provider.behavior),
        );
        mapping.insert(
            serde_yaml::Value::String("url".into()),
            serde_yaml::Value::String(provider.url),
        );
        mapping.insert(
            serde_yaml::Value::String("path".into()),
            serde_yaml::Value::String(format!(
                "./rules/{}.mrs",
                sanitize_component(provider_name)
            )),
        );
        mapping.insert(
            serde_yaml::Value::String("interval".into()),
            serde_yaml::Value::Number(serde_yaml::Number::from(86400)),
        );
        mapping.insert(
            serde_yaml::Value::String("format".into()),
            serde_yaml::Value::String(provider.format),
        );
        workspace.rule_providers.insert(
            serde_yaml::Value::String(provider_name.to_string()),
            serde_yaml::Value::Mapping(mapping),
        );
    }

    let mut retained = Vec::new();
    for rule in std::mem::take(&mut workspace.rules) {
        let Some(text) = rule.as_str() else {
            retained.push(rule);
            continue;
        };
        let trimmed = text.trim();
        if trimmed.starts_with("MATCH,") {
            continue;
        }
        let mut parts = trimmed.split(',');
        if parts.next() == Some("RULE-SET") {
            if let Some(provider) = parts.next() {
                if provider_names.contains(provider) {
                    continue;
                }
            }
        }
        retained.push(rule);
    }

    let mut next_rules = Vec::new();
    for rule in rules {
        let provider = rule.provider.trim();
        let target = rule.target.trim();
        if provider.is_empty() || target.is_empty() {
            return Err("模板规则缺少规则集或目标".into());
        }
        let mut text = format!("RULE-SET,{provider},{target}");
        if rule.no_resolve {
            text.push_str(",no-resolve");
        }
        next_rules.push(serde_yaml::Value::String(text));
    }
    next_rules.extend(retained);
    next_rules.push(serde_yaml::Value::String(format!("MATCH,{match_target}")));
    workspace.rules = next_rules;

    workspace.normalize();
    save_workspace_files(&workspace, Some("group-template"))?;
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
fn create_chain_node(
    base_name: String,
    dialer: String,
    name: Option<String>,
) -> Result<ConfigStatus, String> {
    let mut workspace = load_workspace()?;
    let base = workspace
        .proxies
        .iter()
        .find(|value| proxy_name(value).as_deref() == Some(base_name.as_str()))
        .ok_or_else(|| format!("基础节点不存在：{base_name}"))?;
    let mut mapping = base
        .as_mapping()
        .cloned()
        .ok_or_else(|| "基础节点不是 mapping".to_string())?;
    let final_name = name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("{base_name} → {dialer}"));
    if workspace
        .proxies
        .iter()
        .any(|value| proxy_name(value).as_deref() == Some(final_name.as_str()))
    {
        return Err(format!("节点 name 重复：{final_name}"));
    }
    let mut known: BTreeSet<String> = workspace.proxies.iter().filter_map(proxy_name).collect();
    for group in &workspace.proxy_groups {
        if let Some(group_name) = proxy_name(group) {
            known.insert(group_name);
        }
    }
    for builtin in ["DIRECT", "REJECT", "REJECT-DROP", "PASS"] {
        known.insert(builtin.to_string());
    }
    if !known.contains(&dialer) {
        return Err(format!("前置节点/出口不存在：{dialer}"));
    }
    mapping.insert(
        serde_yaml::Value::String("name".into()),
        serde_yaml::Value::String(final_name),
    );
    mapping.insert(
        serde_yaml::Value::String("dialer-proxy".into()),
        serde_yaml::Value::String(dialer),
    );
    workspace.proxies.push(serde_yaml::Value::Mapping(mapping));
    workspace.normalize();
    save_workspace_files(&workspace, Some("chain-create"))?;
    config_status()
}

#[tauri::command]
async fn controller_dns_query(name: String, kind: String) -> Result<String, String> {
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
    client.query_dns(&name, &kind)
}

#[tauri::command]
async fn controller_flush_dns() -> Result<String, String> {
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
    client.flush_dns()?;
    Ok("DNS 缓存已清空".into())
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
async fn controller_close_connection(id: String) -> Result<String, String> {
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
    client.close_connection(&id)?;
    Ok("连接已断开".into())
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
fn latest_export() -> Result<Option<String>, String> {
    let dir = exports_dir()?;
    if !dir.exists() {
        return Ok(None);
    }
    let mut files: Vec<PathBuf> = fs::read_dir(&dir)
        .map_err(|error| format!("failed to read {}: {error}", dir.display()))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|extension| extension.to_str()) == Some("yaml"))
        .collect();
    files.sort_by_key(|path| path.metadata().and_then(|meta| meta.modified()).ok());
    let Some(last) = files.last() else {
        return Ok(None);
    };
    read_text(last).map(Some)
}

#[tauri::command]
fn delete_export(path: String) -> Result<(), String> {
    let root = exports_dir()?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let target = PathBuf::from(&path)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !target.starts_with(&root) || target == root {
        return Err("只能删除导出目录内的文件".into());
    }
    fs::remove_file(&target)
        .map_err(|error| format!("failed to delete {}: {error}", target.display()))
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
    let (yaml, _) = portable_external_yaml(&workspace)?;
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
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let icon = app
                .default_window_icon()
                .cloned()
                .expect("YamlVim window icon is missing");
            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .tooltip("YamlVim")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            data_dir,
            probe_core,
            config_status,
            workspace_view,
            workspace_dns_yaml,
            apply_dns_yaml,
            save_dns_default,
            load_dns_default,
            import_config,
            validate_config,
            apply_dns_config,
            save_workspace_yaml,
            add_node_yaml,
            export_config,
            import_source,
            import_config_text,
            import_node_links,
            clash_verge_profiles,
            import_clash_verge,
            export_to_clash_verge,
            share_to_clash_verge,
            open_external_url,
            controller_get,
            controller_delay,
            controller_dns_query,
            controller_flush_dns,
            controller_close_connection,
            save_controller,
            list_exports,
            latest_export,
            delete_export,
            read_export,
            load_export_as_workspace,
            switch_proxy,
            node_yaml,
            update_node_yaml,
            delete_nodes,
            set_nodes_disabled,
            add_rule_sets,
            delete_node,
            toggle_node,
            exit_yaml,
            save_exit_yaml,
            delete_exit,
            apply_group_template,
            save_rules,
            create_chain_node
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
    fn builtin_dns_default_has_wbu_policy() {
        assert!(DEFAULT_DNS_YAML.contains("+.wbu.edu.cn"));
        assert!(DEFAULT_DNS_YAML.contains("218.199.208.8"));
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
        let node_text = node_yaml("node-c".into()).unwrap();
        let renamed_status = update_node_yaml(
            "node-c".into(),
            node_text.replace("name: node-c", "name: node-c2"),
        )
        .unwrap();
        let rule_status = save_rules(vec!["MATCH,DIRECT".to_string()]).unwrap();
        let chain_status =
            create_chain_node("node-c2".into(), "DIRECT".into(), Some("chain-c".into())).unwrap();
        delete_node("chain-c".into()).unwrap();
        let final_status = delete_node("node-c2".into()).unwrap();
        let batch_node = add_node_yaml(
            "name: node-d\ntype: ss\nserver: d.example.com\nport: 443\ncipher: aes-128-gcm\npassword: secret\n"
                .into(),
        )
        .unwrap();
        let disabled_status = set_nodes_disabled(vec!["node-d".into()], true).unwrap();
        let batch_deleted = delete_nodes(vec!["node-d".into()]).unwrap();
        let exit_created = save_exit_yaml(
            None,
            "name: Test Group\ntype: select\nproxies:\n  - DIRECT\n".into(),
        )
        .unwrap();
        let exit_deleted = delete_exit("Test Group".into()).unwrap();
        let rule_set_status = add_rule_sets(
            vec![RuleCatalogItem {
                slug: "test".into(),
                provider_name: "geosite-test".into(),
                kind: "geosite".into(),
                behavior: "domain".into(),
                url: "https://example.com/test.mrs".into(),
                format: "mrs".into(),
                popular: false,
            }],
            "DIRECT".into(),
        )
        .unwrap();
        let template_status = apply_group_template(
            vec![
                serde_yaml::from_str::<serde_yaml::Value>(
                    "name: Auto\ntype: select\nproxies: [Auto2, DIRECT]\n",
                )
                .unwrap(),
                serde_yaml::from_str::<serde_yaml::Value>(
                    "name: Auto2\ntype: url-test\nproxies: [DIRECT]\nurl: https://example.com\ninterval: 300\n",
                )
                .unwrap(),
            ],
            vec![TemplateProviderInput {
                name: "template-test".into(),
                behavior: "domain".into(),
                url: "https://example.com/template.mrs".into(),
                format: "mrs".into(),
            }],
            vec![TemplateRuleInput {
                provider: "template-test".into(),
                target: "Auto".into(),
                no_resolve: true,
            }],
            "Auto2".into(),
        )
        .unwrap();
        let template_workspace_text = fs::read_to_string(data.join("workspace.json")).unwrap();
        let default_path = save_dns_default("dns:\n  enable: true\n".into()).unwrap();
        assert!(Path::new(&default_path).is_file());
        assert!(load_dns_default().unwrap().unwrap().contains("enable"));
        let batch_status = import_source(
            "ss://YWVzLTI1Ni1nY206dGVzdA==@a.example.com:443#batch-a\nss://YWVzLTI1Ni1nY206dGVzdA==@b.example.com:443#batch-b\n\u{65e0}\u{6548}\u{884c}\n"
                .into(),
        )
        .unwrap();
        assert_eq!(batch_status.added_nodes, 2);
        assert_eq!(batch_status.errors.len(), 1);
        assert!(batch_status.errors[0].contains("\u{7b2c} 3 \u{884c}"));
        assert_eq!(batch_status.status.node_count, 2);

        let previous_verge = std::env::var_os("YAMLVIM_VERGE_DIR");
        let verge_dir = root.join("verge");
        let verge_profiles = verge_dir.join("profiles");
        fs::create_dir_all(&verge_profiles).unwrap();
        fs::write(
            verge_dir.join("profiles.yaml"),
            "current: abc123\nitems:\n  - uid: abc123\n    name: \u{6d4b}\u{8bd5}\u{8ba2}\u{9605}\n    file: abc.yaml\n    type: remote\n    url: https://example.com/sub\n",
        )
        .unwrap();
        fs::write(
            verge_dir.join("config.yaml"),
            "external-controller: 127.0.0.1:9090\nsecret: verge-secret\n",
        )
        .unwrap();
        fs::write(
            verge_profiles.join("abc.yaml"),
            "proxies:\n  - name: verge-node\n    type: ss\n    server: v.example.com\n    port: 8388\n    cipher: aes-128-gcm\n    password: pw\nproxy-groups:\n  - name: VergeAuto\n    type: select\n    proxies: [verge-node]\nrules:\n  - MATCH,VergeAuto\nrule-providers:\n  verge-private:\n    type: file\n    behavior: domain\n    path: verge-private.yaml\n",
        )
        .unwrap();
        fs::write(verge_profiles.join("verge-private.yaml"), "payload:\n  - '+.local'\n").unwrap();
        std::env::set_var("YAMLVIM_VERGE_DIR", &verge_dir);
        let verge_view = clash_verge_profiles().unwrap();
        assert_eq!(verge_view.profiles.len(), 1);
        assert!(verge_view.profiles[0].current);
        let verge_result = import_clash_verge(None).unwrap();
        assert_eq!(verge_result.profile, "\u{6d4b}\u{8bd5}\u{8ba2}\u{9605}");
        assert_eq!(verge_result.status.node_count, 1);
        assert_eq!(verge_result.controller_set.as_deref(), Some("127.0.0.1:9090"));
        assert_eq!(load_settings().unwrap().controller_endpoint, "127.0.0.1:9090");
        let verge_export = export_to_clash_verge(Some("\u{6d4b}\u{8bd5}\u{5bfc}\u{51fa}".into())).unwrap();
        assert_eq!(verge_export.profile, "\u{6d4b}\u{8bd5}\u{5bfc}\u{51fa}");
        assert!(verge_export.file.starts_with("yamlvim-"));
        assert!(verge_profiles.join(&verge_export.file).is_file());
        let verge_profiles_text = fs::read_to_string(verge_dir.join("profiles.yaml")).unwrap();
        assert!(verge_profiles_text.contains(&verge_export.file));
        assert!(verge_profiles_text.contains("current: yamlvim-"));
        let verge_profile_yaml =
            fs::read_to_string(verge_profiles.join(&verge_export.file)).unwrap();
        assert!(verge_profile_yaml.contains("./rules/verge-private.yaml"));
        assert!(verge_dir.join("rules").join("verge-private.yaml").is_file());
        match previous_verge {
            Some(value) => std::env::set_var("YAMLVIM_VERGE_DIR", value),
            None => std::env::remove_var("YAMLVIM_VERGE_DIR"),
        }

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
        assert_eq!(template_status.exit_count, 2);
        assert_eq!(template_status.rule_count, 3);
        let template_workspace: Workspace =
            serde_json::from_str(&template_workspace_text).unwrap();
        let auto_group = template_workspace
            .proxy_groups
            .iter()
            .find(|group| proxy_name(group).as_deref() == Some("Auto"))
            .unwrap();
        let auto_members = auto_group
            .as_mapping()
            .and_then(|mapping| mapping.get("proxies"))
            .and_then(serde_yaml::Value::as_sequence)
            .unwrap();
        assert!(auto_members
            .iter()
            .any(|member| member.as_str() == Some("Auto2")));
        let template_rules: Vec<&str> = template_workspace
            .rules
            .iter()
            .filter_map(serde_yaml::Value::as_str)
            .collect();
        assert_eq!(template_rules.first().copied(), Some("RULE-SET,template-test,Auto,no-resolve"));
        assert_eq!(template_rules.last().copied(), Some("MATCH,Auto2"));
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
        assert_eq!(renamed_status.node_count, 1);
        assert_eq!(rule_status.rule_count, 1);
        assert_eq!(chain_status.node_count, 2);
        assert_eq!(final_status.node_count, 0);
        assert_eq!(batch_node.node_count, 1);
        assert_eq!(disabled_status.node_count, 1);
        assert_eq!(batch_deleted.node_count, 0);
        assert_eq!(exit_created.exit_count, 2);
        assert_eq!(exit_deleted.exit_count, 1);
        assert_eq!(rule_set_status.rule_count, 2);
        let _ = fs::remove_dir_all(root);
    }
}
