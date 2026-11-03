# YamlVim

Standalone mihomo routing and DNS workbench. See [PLAN.md](PLAN.md) for the design.

## Current status (2026-11-04)

- **M0 shell**: Tauri 2 + React 19 + Vite application shell with a monochrome layout.
- **M2 workspace ownership**: importing a mihomo YAML populates nodes, exits and rules;
  export regenerates a brand-new YAML from the current workspace only. There is no
  hidden base config. Old versions live only in `data/history`.
- **Editing**: a raw workspace YAML editor on the Config page can add, remove or edit
  nodes, exits and rules. Saving only writes the workspace and a new `config.yaml`;
  it never modifies a running mihomo.
- **Safe mode only**: no core start/stop, no profile reload, no writes to another
  client or controller. Read-only controller attach and live data are the next step.
- **DNS**: visual DNS override compiler, full-config preview, `mihomo -t` validation
  and workspace apply.
- **Providers**: local `rule-providers`/`proxy-providers` files and GeoData are
  copied into `data/core`, with provider paths rewritten to the app folder.
- **Rust core**: 39 tests + 1 Tauri integration test. Frontend build, fmt and clippy
  pass. `mihomo v1.19.32` accepts the generated YAML with `-t`.
- **Not yet wired**: read-only controller attach, live connections, delay tests,
  dedicated visual node/exit/rule editors and packaging.

## Data directory

YamlVim is portable and app-local. It does not use `%APPDATA%`.

```text
data/                         # debug: project/data; release: next to the exe
├── settings.json
├── workspace.json            # source of truth: settings, nodes, exits, rules, DNS
├── config.yaml               # generated from the workspace
├── history/                  # full YAML snapshots of imports, edits and exports
├── exports/                  # new timestamped YAML files
└── core/                     # GeoData + copied providers
```

`YAMLVIM_DATA_DIR` overrides the location. `data/` is gitignored because it can
contain node credentials and controller secrets.

## One-click import

Use **Config → import** once. The YAML is parsed into the workspace and all the
workspace pages update:

- **Nodes** shows `proxies`.
- **Exits** shows `proxy-groups`.
- **Rules** shows `rules` and `rule-providers`.
- **DNS** can apply a new DNS override to the workspace.
- **Config** shows and edits the generated full YAML.

Exporting writes a new file under `data/exports`. It does not merge the original
YAML, so deleted nodes stay deleted and the only remaining copy of the old version
is in `data/history`.

## Known limitations (M2)

- Controller live data and attach mode are not wired yet.
- A read-only attached kernel can only delay-test proxies already present in its
  config. Brand-new workspace nodes cannot be tested by that kernel; they need a
  direct probe or a temporary test core.
- YamlVim does not start or stop mihomo in safe mode, so TUN/ports are not changed
  by the app.
- Import copies provider and GeoData snapshots; re-import to refresh them.
- Import normalizes YAML and can drop comments; the source file is never modified.
- Export strips controller/secret but keeps app-local provider paths; portable export
  path rewriting is a follow-up.

## Repository layout

```text
src/                    React UI (core, DNS, config, nodes, exits, rules)
src-tauri/              Tauri 2 shell and IPC commands
crates/yamlvim-core/    workspace model, DNS compiler, config generation
crates/yamlvim-mihomo/  probe, config validation, process runner (reserved)
fixtures/               base config and DNS golden inputs
PLAN.md                 product and architecture plan
```

## Web shell

```bash
npm install
npm run dev          # http://127.0.0.1:5273
npm run build        # typecheck + production assets
```

The browser build uses mock probe/preview/workspace responses so the UI can be
developed without a Tauri window. It never starts a core or writes a config.

## Desktop shell

```bash
npm run desktop:dev
npm run desktop:build
```

Windows prerequisites: Rust stable, MSVC Build Tools with the C++ workload, Windows
SDK 10 and WebView2 Runtime. The desktop shell was compiled and tested with VS 2026
Build Tools via `vcvarsall.bat x64`. If `tauri info` does not detect VS 18, run the
desktop commands from a Developer Command Prompt.

Verified end-to-end: probe a managed core → import YAML into the workspace → nodes,
exits and rules populate → `mihomo -t` validation → apply DNS → edit YAML → export a
new file. No core process is started or reloaded.

## Rust checks

```bash
cargo test --workspace
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
```

Tauri library tests and build (from a Developer Command Prompt or after
`vcvarsall.bat x64`):

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo build --manifest-path src-tauri/Cargo.toml
```

If MSVC Build Tools are unavailable, run the Rust tests with the installed GNU
toolchain:

```bash
cargo +stable-x86_64-pc-windows-gnu test --workspace
```

## CLI helpers

```bash
# DNS fragment
cargo run -p yamlvim-core --bin yamlvim-core -- dns fixtures/dns/basic.yaml

# base + DNS merge
cargo run -p yamlvim-core --bin yamlvim-core -- config fixtures/config-basic.yaml fixtures/dns/merge.yaml

# core compatibility probe
cargo run -p yamlvim-mihomo --bin yamlvim-probe -- /path/to/mihomo
```
