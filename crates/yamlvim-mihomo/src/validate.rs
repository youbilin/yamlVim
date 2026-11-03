use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::runner::{CommandRunner, CommandSpec};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigValidation {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<i32>,
    pub timed_out: bool,
    pub output: String,
}

/// Validate a complete mihomo config with the real core using `mihomo -t`.
///
/// The temporary config is written inside the app data directory and removed
/// afterwards. The data directory is passed as `-d` so local GeoIP/GeoSite
/// assets can be found.
pub fn validate_config<R: CommandRunner>(
    runner: &R,
    binary: &Path,
    config_text: &str,
    data_dir: &Path,
    timeout: Duration,
) -> ConfigValidation {
    if let Err(error) = fs::create_dir_all(data_dir) {
        return failure(format!(
            "failed to create data directory {}: {error}",
            data_dir.display()
        ));
    }

    let dir = data_dir
        .join("validation")
        .join(format!("run-{}-{}", std::process::id(), nanos()));
    if let Err(error) = fs::create_dir_all(&dir) {
        return failure(format!(
            "failed to create validation directory {}: {error}",
            dir.display()
        ));
    }

    let config_path = dir.join("config.yaml");
    if let Err(error) = fs::write(&config_path, config_text) {
        let _ = fs::remove_dir_all(&dir);
        return failure(format!(
            "failed to write validation config {}: {error}",
            config_path.display()
        ));
    }

    let result = runner.run(&CommandSpec {
        program: binary.to_path_buf(),
        args: vec![
            "-t".into(),
            "-f".into(),
            config_path.display().to_string(),
            "-d".into(),
            data_dir.display().to_string(),
        ],
        timeout,
    });

    let _ = fs::remove_dir_all(&dir);

    match result {
        Ok(output) => ConfigValidation {
            ok: output.success(),
            status: output.status,
            timed_out: output.timed_out,
            output: truncate(output.combined(), 4_000),
        },
        Err(error) => failure(error.to_string()),
    }
}

fn failure(message: String) -> ConfigValidation {
    ConfigValidation {
        ok: false,
        status: None,
        timed_out: false,
        output: message,
    }
}

fn nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}

fn truncate(value: String, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value;
    }
    value.chars().take(limit).collect::<String>() + "…"
}
