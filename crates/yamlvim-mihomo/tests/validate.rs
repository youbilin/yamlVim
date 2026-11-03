use std::io;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use yamlvim_mihomo::{validate_config, CommandOutput, CommandRunner, CommandSpec, RunnerError};

struct FakeRunner {
    status: Option<i32>,
    timed_out: bool,
    spawn_fail: bool,
    seen_config: Mutex<Option<String>>,
    seen_data_dir: Mutex<Option<String>>,
}

impl FakeRunner {
    fn new(status: i32) -> Self {
        Self {
            status: Some(status),
            timed_out: false,
            spawn_fail: false,
            seen_config: Mutex::new(None),
            seen_data_dir: Mutex::new(None),
        }
    }
}

impl CommandRunner for FakeRunner {
    fn run(&self, spec: &CommandSpec) -> Result<CommandOutput, RunnerError> {
        if self.spawn_fail {
            return Err(RunnerError::Spawn(io::Error::new(
                io::ErrorKind::NotFound,
                "missing core",
            )));
        }
        if let Some(index) = spec.args.iter().position(|arg| arg == "-f") {
            if let Some(path) = spec.args.get(index + 1) {
                *self.seen_config.lock().unwrap() =
                    Some(std::fs::read_to_string(path).unwrap_or_default());
            }
        }
        if let Some(index) = spec.args.iter().position(|arg| arg == "-d") {
            *self.seen_data_dir.lock().unwrap() = spec.args.get(index + 1).cloned();
        }
        Ok(CommandOutput {
            status: self.status,
            stdout: "configuration is valid".into(),
            stderr: if self.status == Some(0) {
                String::new()
            } else {
                "configuration test failed".into()
            },
            timed_out: self.timed_out,
        })
    }
}

fn temp_dir() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("yamlvim-validate-{}", std::process::id()))
}

#[test]
fn valid_config_passes() {
    let runner = FakeRunner::new(0);
    let dir = temp_dir();
    let result = validate_config(
        &runner,
        Path::new("mihomo.exe"),
        "mixed-port: 7890\n",
        &dir,
        Duration::from_secs(1),
    );
    assert!(result.ok);
    assert_eq!(result.status, Some(0));
    assert!(result.output.contains("valid"));
    assert!(runner
        .seen_config
        .lock()
        .unwrap()
        .as_deref()
        .unwrap_or_default()
        .contains("mixed-port"));
    assert!(runner
        .seen_data_dir
        .lock()
        .unwrap()
        .as_deref()
        .unwrap_or_default()
        .contains("yamlvim-validate"));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn failed_config_is_reported() {
    let runner = FakeRunner::new(1);
    let result = validate_config(
        &runner,
        Path::new("mihomo.exe"),
        "invalid: [",
        &temp_dir(),
        Duration::from_secs(1),
    );
    assert!(!result.ok);
    assert_eq!(result.status, Some(1));
    assert!(result.output.contains("failed"));
}

#[test]
fn timeout_is_reported() {
    let runner = FakeRunner {
        timed_out: true,
        ..FakeRunner::new(0)
    };
    let result = validate_config(
        &runner,
        Path::new("mihomo.exe"),
        "mixed-port: 7890\n",
        &temp_dir(),
        Duration::from_millis(10),
    );
    assert!(!result.ok);
    assert!(result.timed_out);
}

#[test]
fn spawn_failure_is_reported() {
    let runner = FakeRunner {
        spawn_fail: true,
        ..FakeRunner::new(0)
    };
    let result = validate_config(
        &runner,
        Path::new("missing.exe"),
        "mixed-port: 7890\n",
        &temp_dir(),
        Duration::from_millis(100),
    );
    assert!(!result.ok);
    assert!(result.output.contains("failed to start"));
}
