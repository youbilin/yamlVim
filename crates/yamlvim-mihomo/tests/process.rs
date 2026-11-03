use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use yamlvim_mihomo::{build_args, CoreProcess};

#[test]
fn args_are_d_and_f() {
    let args = build_args(Path::new("config.yaml"), Path::new("core"));
    assert_eq!(args, vec!["-d", "core", "-f", "config.yaml"]);
}

#[test]
fn fake_core_starts_and_stops() {
    let exe = env!("CARGO_BIN_EXE_yamlvim-fake-core");
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("yamlvim-process-{nanos}"));
    fs::create_dir_all(&dir).unwrap();
    let config = dir.join("config.yaml");
    fs::write(&config, "mixed-port: 7890\n").unwrap();
    let data = dir.join("core");
    let log = dir.join("logs").join("core.log");

    let mut process = CoreProcess::start(Path::new(exe), &config, &data, &log).unwrap();
    let status = process.status().unwrap();
    assert!(status.running);
    assert!(status.pid.is_some());
    assert!(status.log_path.ends_with("core.log"));

    process.stop().unwrap();
    assert!(!process.status().unwrap().running);
    assert!(log.exists());

    let _ = fs::remove_dir_all(dir);
}
