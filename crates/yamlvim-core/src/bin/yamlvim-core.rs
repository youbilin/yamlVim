use std::env;
use std::fs;
use std::process::ExitCode;

use yamlvim_core::{compile_dns, config_hosts, merge_dns, parse_config, to_yaml, DnsInput};

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("dns") => run_dns(&args[1..]),
        Some("config") => run_config(&args[1..]),
        _ => {
            usage();
            ExitCode::from(2)
        }
    }
}

fn usage() {
    eprintln!("usage:");
    eprintln!("  yamlvim-core dns <dns-input.yaml> [--json]");
    eprintln!("  yamlvim-core config <base.yaml> <dns-input.yaml>");
}

fn read_file(path: &str) -> Result<String, ExitCode> {
    fs::read_to_string(path).map_err(|error| {
        eprintln!("failed to read {path}: {error}");
        ExitCode::FAILURE
    })
}

fn run_dns(args: &[String]) -> ExitCode {
    if args.is_empty() {
        usage();
        return ExitCode::from(2);
    }

    let path = &args[0];
    let as_json = args.iter().any(|arg| arg == "--json");
    let text = match read_file(path) {
        Ok(text) => text,
        Err(code) => return code,
    };

    let input: DnsInput = match serde_yaml::from_str(&text) {
        Ok(input) => input,
        Err(error) => {
            eprintln!("failed to parse {path}: {error}");
            return ExitCode::FAILURE;
        }
    };

    match compile_dns(&input) {
        Ok(compiled) => {
            if as_json {
                match serde_json::to_string_pretty(&compiled) {
                    Ok(output) => println!("{output}"),
                    Err(error) => {
                        eprintln!("failed to render JSON: {error}");
                        return ExitCode::FAILURE;
                    }
                }
            } else {
                for warning in &compiled.warnings {
                    eprintln!("warning: [{}] {}", warning.code, warning.message);
                }
                match serde_yaml::to_string(&compiled.output()) {
                    Ok(output) => print!("{output}"),
                    Err(error) => {
                        eprintln!("failed to render YAML: {error}");
                        return ExitCode::FAILURE;
                    }
                }
            }
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("dns compile error: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run_config(args: &[String]) -> ExitCode {
    if args.len() < 2 {
        usage();
        return ExitCode::from(2);
    }

    let base_path = &args[0];
    let dns_path = &args[1];
    let base_text = match read_file(base_path) {
        Ok(text) => text,
        Err(code) => return code,
    };
    let base = match parse_config(&base_text) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("failed to parse {base_path}: {error}");
            return ExitCode::FAILURE;
        }
    };
    let dns_text = match read_file(dns_path) {
        Ok(text) => text,
        Err(code) => return code,
    };
    let mut input: DnsInput = match serde_yaml::from_str(&dns_text) {
        Ok(input) => input,
        Err(error) => {
            eprintln!("failed to parse {dns_path}: {error}");
            return ExitCode::FAILURE;
        }
    };
    input.hosts = config_hosts(&base);

    let compiled = match compile_dns(&input) {
        Ok(compiled) => compiled,
        Err(error) => {
            eprintln!("dns compile error: {error}");
            return ExitCode::FAILURE;
        }
    };
    for warning in &compiled.warnings {
        eprintln!("warning: [{}] {}", warning.code, warning.message);
    }

    let merged = match merge_dns(&base, &compiled) {
        Ok(merged) => merged,
        Err(error) => {
            eprintln!("config merge error: {error}");
            return ExitCode::FAILURE;
        }
    };
    match to_yaml(&merged) {
        Ok(yaml) => {
            print!("{yaml}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("failed to render YAML: {error}");
            ExitCode::FAILURE
        }
    }
}
