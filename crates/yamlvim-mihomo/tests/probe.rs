use std::io;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use yamlvim_mihomo::{
    probe_core, CommandOutput, CommandRunner, CommandSpec, CoreKind, ProbeOptions, RunnerError,
};

#[derive(Clone)]
struct FakeRunner {
    version_ok: bool,
    test_ok: bool,
    spawn_fail: bool,
    test_timeout: bool,
    seen_config: Arc<Mutex<Option<String>>>,
    specs: Arc<Mutex<Vec<Vec<String>>>>,
}

impl FakeRunner {
    fn new(version_ok: bool, test_ok: bool) -> Self {
        Self {
            version_ok,
            test_ok,
            spawn_fail: false,
            test_timeout: false,
            seen_config: Arc::new(Mutex::new(None)),
            specs: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn spawn_failure() -> Self {
        Self {
            spawn_fail: true,
            ..Self::new(false, false)
        }
    }

    fn timed_out() -> Self {
        Self {
            test_timeout: true,
            ..Self::new(true, false)
        }
    }
}

impl CommandRunner for FakeRunner {
    fn run(&self, spec: &CommandSpec) -> Result<CommandOutput, RunnerError> {
        self.specs.lock().unwrap().push(spec.args.clone());
        if self.spawn_fail {
            return Err(RunnerError::Spawn(io::Error::new(
                io::ErrorKind::NotFound,
                "missing core",
            )));
        }

        let is_version = spec.args.iter().any(|arg| arg == "-v");
        if !is_version {
            if let Some(index) = spec.args.iter().position(|arg| arg == "-f") {
                if let Some(path) = spec.args.get(index + 1) {
                    let text = std::fs::read_to_string(path).unwrap_or_default();
                    *self.seen_config.lock().unwrap() = Some(text);
                }
            }
        }

        let ok = if is_version {
            self.version_ok
        } else {
            self.test_ok
        };
        let timed_out = !is_version && self.test_timeout;

        Ok(CommandOutput {
            status: Some(if ok && !timed_out { 0 } else { 1 }),
            stdout: if is_version {
                "Mihomo Meta v1.19.0".into()
            } else {
                String::new()
            },
            stderr: if ok {
                String::new()
            } else {
                "probe failed".into()
            },
            timed_out,
        })
    }
}

#[test]
fn managed_core_passes_both_probes() {
    let runner = FakeRunner::new(true, true);
    let result = probe_core(&runner, Path::new("mihomo.exe"), &ProbeOptions::default());

    assert_eq!(result.kind, CoreKind::Managed);
    assert!(result.managed);
    assert!(!result.attach_only);
    assert!(result
        .version
        .as_deref()
        .unwrap_or_default()
        .contains("v1.19.0"));

    let config = runner.seen_config.lock().unwrap().clone();
    assert!(config.unwrap_or_default().contains("MATCH,DIRECT"));

    let specs = runner.specs.lock().unwrap();
    assert!(specs.iter().any(|args| args.contains(&"-t".to_string())));
    assert!(specs.iter().any(|args| args.contains(&"-f".to_string())));
    assert!(specs.iter().any(|args| args.contains(&"-d".to_string())));
}

#[test]
fn probe_json_uses_camel_case_fields() {
    let result = probe_core(
        &FakeRunner::new(true, true),
        Path::new("mihomo.exe"),
        &ProbeOptions::default(),
    );
    let value = serde_json::to_value(&result).unwrap();
    assert_eq!(
        value.get("kind").and_then(|kind| kind.as_str()),
        Some("managed")
    );
    assert_eq!(
        value.get("attachOnly").and_then(|attach| attach.as_bool()),
        Some(false)
    );
    assert!(value.get("managed").and_then(|managed| managed.as_bool()) == Some(true));
}

#[test]
fn failed_config_test_is_attach_only() {
    let runner = FakeRunner::new(true, false);
    let result = probe_core(
        &runner,
        Path::new("FlClashCore.exe"),
        &ProbeOptions {
            timeout: Duration::from_millis(500),
        },
    );

    assert_eq!(result.kind, CoreKind::AttachOnly);
    assert!(!result.managed);
    assert!(result.attach_only);
    assert!(result
        .reason
        .as_deref()
        .unwrap_or_default()
        .contains("config test failed"));
}

#[test]
fn spawn_failure_is_unusable() {
    let result = probe_core(
        &FakeRunner::spawn_failure(),
        Path::new("missing.exe"),
        &ProbeOptions::default(),
    );

    assert_eq!(result.kind, CoreKind::Unusable);
    assert!(!result.managed);
    assert!(!result.attach_only);
    assert!(result
        .reason
        .as_deref()
        .unwrap_or_default()
        .contains("cannot execute"));
}

#[test]
fn config_timeout_is_attach_only() {
    let result = probe_core(
        &FakeRunner::timed_out(),
        Path::new("slow-core.exe"),
        &ProbeOptions::default(),
    );

    assert_eq!(result.kind, CoreKind::AttachOnly);
    assert!(result
        .reason
        .as_deref()
        .unwrap_or_default()
        .contains("timed out"));
}
