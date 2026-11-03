use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::runner::{CommandOutput, CommandRunner, CommandSpec};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CoreKind {
    Managed,
    AttachOnly,
    Unusable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreProbe {
    pub path: String,
    pub kind: CoreKind,
    pub version: Option<String>,
    pub managed: bool,
    pub attach_only: bool,
    pub reason: Option<String>,
    pub output: String,
}

#[derive(Debug, Clone)]
pub struct ProbeOptions {
    pub timeout: Duration,
}

impl Default for ProbeOptions {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(5),
        }
    }
}

const PROBE_CONFIG: &str = "mixed-port: 0
mode: rule
log-level: silent
proxies: []
proxy-groups: []
rules:
  - MATCH,DIRECT
";

/// Probe a core binary before offering managed mode.
///
/// A standard mihomo must accept `-v` and `-t -f <config> -d <dir>`. Client
/// wrappers that expose mihomo internally usually fail this probe and are
/// treated as attach-only.
pub fn probe_core<R: CommandRunner>(runner: &R, path: &Path, options: &ProbeOptions) -> CoreProbe {
    let probe_dir = probe_dir();
    if let Err(error) = fs::create_dir_all(&probe_dir) {
        return unusable(path, format!("failed to create probe directory: {error}"));
    }

    let config_path = probe_dir.join("config.yaml");
    if let Err(error) = fs::write(&config_path, PROBE_CONFIG) {
        let _ = fs::remove_dir_all(&probe_dir);
        return unusable(path, format!("failed to write probe config: {error}"));
    }

    let version_output = match runner.run(&CommandSpec {
        program: path.to_path_buf(),
        args: vec!["-v".into()],
        timeout: options.timeout,
    }) {
        Ok(output) => output,
        Err(error) => {
            let _ = fs::remove_dir_all(&probe_dir);
            return unusable(path, format!("cannot execute core: {error}"));
        }
    };
    let version_ok = version_output.success();
    let version = if version_ok {
        parse_version(&version_output.combined())
    } else {
        None
    };

    let test_output = match runner.run(&CommandSpec {
        program: path.to_path_buf(),
        args: vec![
            "-t".into(),
            "-f".into(),
            config_path.display().to_string(),
            "-d".into(),
            probe_dir.display().to_string(),
        ],
        timeout: options.timeout,
    }) {
        Ok(output) => output,
        Err(error) => {
            let _ = fs::remove_dir_all(&probe_dir);
            return CoreProbe {
                path: path.display().to_string(),
                kind: CoreKind::AttachOnly,
                version,
                managed: false,
                attach_only: true,
                reason: Some(format!("cannot run config test: {error}")),
                output: render_output(&version_output, None),
            };
        }
    };

    let test_ok = test_output.success();
    let managed = version_ok && test_ok;
    let reason = if managed {
        None
    } else {
        let mut reasons = Vec::new();
        if !version_ok {
            reasons.push("version probe failed".to_string());
        }
        if !test_ok {
            if test_output.timed_out {
                reasons.push("config test timed out".to_string());
            } else {
                reasons.push("config test failed".to_string());
            }
        }
        Some(reasons.join("; "))
    };

    let result = CoreProbe {
        path: path.display().to_string(),
        kind: if managed {
            CoreKind::Managed
        } else {
            CoreKind::AttachOnly
        },
        version,
        managed,
        attach_only: !managed,
        reason,
        output: render_output(&version_output, Some(&test_output)),
    };

    let _ = fs::remove_dir_all(&probe_dir);
    result
}

fn unusable(path: &Path, reason: String) -> CoreProbe {
    CoreProbe {
        path: path.display().to_string(),
        kind: CoreKind::Unusable,
        version: None,
        managed: false,
        attach_only: false,
        reason: Some(reason),
        output: String::new(),
    }
}

fn probe_dir() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("yamlvim-probe-{}-{nanos}", std::process::id()))
}

fn parse_version(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .find(|line| {
            !line.is_empty()
                && (line.to_ascii_lowercase().contains("mihomo")
                    || line.to_ascii_lowercase().contains("meta")
                    || line.starts_with('v'))
        })
        .map(str::to_string)
        .or_else(|| {
            text.lines()
                .map(str::trim)
                .find(|line| !line.is_empty())
                .map(str::to_string)
        })
}

fn render_output(version: &CommandOutput, test: Option<&CommandOutput>) -> String {
    let mut text = String::new();
    push_output(&mut text, "version", version);
    if let Some(test) = test {
        push_output(&mut text, "test", test);
    }
    truncate_chars(&text, 2_000)
}

fn push_output(text: &mut String, label: &str, output: &CommandOutput) {
    if !text.is_empty() {
        text.push('\n');
    }
    text.push_str(&format!(
        "[{label}] status={:?} timed_out={}\n",
        output.status, output.timed_out
    ));
    if !output.stdout.trim().is_empty() {
        text.push_str(output.stdout.trim());
        text.push('\n');
    }
    if !output.stderr.trim().is_empty() {
        text.push_str(output.stderr.trim());
    }
}

fn truncate_chars(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }
    value.chars().take(limit).collect::<String>() + "…"
}
