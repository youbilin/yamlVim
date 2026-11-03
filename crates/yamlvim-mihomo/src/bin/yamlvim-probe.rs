use std::env;
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;

use yamlvim_mihomo::{probe_core, CoreKind, ProbeOptions, SystemRunner};

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!("usage: yamlvim-probe <path-to-mihomo> [--json] [--timeout-ms N]");
        return ExitCode::from(2);
    }

    let path = PathBuf::from(&args[0]);
    let as_json = args.iter().any(|arg| arg == "--json");
    let timeout = args
        .windows(2)
        .find(|pair| pair[0] == "--timeout-ms")
        .and_then(|pair| pair[1].parse::<u64>().ok())
        .map(Duration::from_millis)
        .unwrap_or(Duration::from_secs(5));

    let result = probe_core(&SystemRunner, &path, &ProbeOptions { timeout });

    if as_json {
        match serde_json::to_string_pretty(&result) {
            Ok(output) => println!("{output}"),
            Err(error) => {
                eprintln!("failed to render JSON: {error}");
                return ExitCode::FAILURE;
            }
        }
    } else {
        println!("path: {}", result.path);
        println!("kind: {:?}", result.kind);
        println!("managed: {}", result.managed);
        println!("attach-only: {}", result.attach_only);
        if let Some(version) = &result.version {
            println!("version: {version}");
        }
        if let Some(reason) = &result.reason {
            println!("reason: {reason}");
        }
        if !result.output.is_empty() {
            println!("output:\n{}", result.output);
        }
    }

    match result.kind {
        CoreKind::Managed => ExitCode::SUCCESS,
        CoreKind::AttachOnly => ExitCode::from(2),
        CoreKind::Unusable => ExitCode::FAILURE,
    }
}
