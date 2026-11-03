# YamlVim

Standalone mihomo routing and DNS workbench. See [PLAN.md](PLAN.md) for the design.

## Current status (2026-11-04)

- **M0 shell**: Tauri 2 + React 19 + Vite application shell with a monochrome,
  collapsible sidebar and a built-in NSIS installer target.
- **Workspace ownership**: importing YAML or node links populates nodes, exits,
  rules and chains. Export regenerates a brand-new YAML from the current workspace
  only. There is no hidden base config and no history layer.
- **Visual editors**: Nodes, Exits, Rules and Chains support add/edit/delete;
  nodes can be disabled, renamed or removed with group references normalized.
  Rule and exit creation use right-side sheets with node selection, presets and
  batch input.
- **Rule catalog**: the Rules sheet bundles the MetaCubeX/meta-rules-dat catalog
  with Chinese names, descriptions and categories, searches locally (for example
  `抖音`), and adds http `.mrs` providers plus matching `RULE-SET` rules.
- **Export page**: the full YAML is editable, `mihomo -t` can validate it, a line
  diff compares it with the latest export, and a new timestamped YAML is written.
- **Files page**: lists every exported YAML, previews it, deletes it, or loads it
  as a fresh workspace for a new editing session.
- **Live page**: read-only attach to a running mihomo controller; lists connections,
  switches Selector groups, runs delay tests and supports DNS query/cache flush.
- **Topbar core drawer**: the Cpu button opens a right-side drawer with mihomo probe
  and controller settings; the Live page remains a full page in the sidebar.
- **Safe mode**: no core start/stop, no profile reload, no writes to another client.
  Selector switches and cache flushes are explicit runtime actions.
- **DNS**: collapsible raw DNS/hosts YAML editor plus a visual override form;
  applying validates with `mihomo -t` before writing the workspace.
- **Providers**: local `rule-providers`/`proxy-providers` files and GeoData are
  copied into `data/core`, with provider paths rewritten to the app folder.
- **Rust core**: 41 tests + 1 Tauri integration test. Frontend build, fmt and clippy
  pass. `mihomo v1.19.32` accepts the generated YAML with `-t`.
- **Packaging**: NSIS installer builds successfully
  (`src-tauri/target/release/bundle/nsis/YamlVim_0.1.0_x64-setup.exe`).
- **Not yet wired**: WebSocket streaming (live data currently polls every 5s),
  portable provider-path rewriting and code signing.

## Data directory

YamlVim is portable and app-local. It does not use `%APPDATA%`.

```text
data/                         # debug: project/data; release: next to the exe
├── settings.json
├── workspace.json            # source of truth: settings, nodes, exits, rules, DNS
├── config.yaml               # generated from the workspace
├── exports/                  # timestamped YAML files; list/preview/re-edit in Files
└── core/                     # GeoData + copied providers
```

`YAMLVIM_DATA_DIR` overrides the location. `data/` is gitignored because it can
contain node credentials and controller secrets.

## One-click import

Use the topbar **导入** action once. It auto-detects:

- a local mihomo YAML file path
- a subscription URL
- node share links (`ss`, `ssr`, `vmess`, `vless`, `trojan`, `hysteria2`,
  `tuic`, `socks5`)
- pasted mihomo YAML

A full config replaces the workspace and populates every page. A list of node links
adds nodes to the current workspace. The only import entry is the topbar button.

## Known limitations

- Live data is polled every 5 seconds; WebSocket push is not implemented yet.
- A read-only attached kernel can only delay-test proxies already present in its
  config. Brand-new workspace nodes need a direct probe or a temporary test core.
- YamlVim does not start or stop mihomo in safe mode, so TUN/ports are not changed
  by the app.
- Import copies provider and GeoData snapshots; re-import to refresh them.
- Import normalizes YAML and can drop comments; the source file is never modified.
- Export strips controller/secret but keeps app-local provider paths; portable export
  path rewriting is a follow-up.

## Repository layout

```text
src/                    React UI (core, live, nodes, exits, chains, rules, DNS, export, files)
src-tauri/              Tauri 2 shell, IPC commands, tray and single instance
crates/yamlvim-core/    workspace model, DNS compiler, link parser, config generation
crates/yamlvim-mihomo/  probe, config validation, controller client, process runner
fixtures/               base config and DNS golden inputs
PLAN.md                 product and architecture plan
```

## Web shell

```bash
npm install
npm run dev          # http://127.0.0.1:5273
npm run build        # typecheck + production assets
```

The browser build uses mock probe/workspace responses so the UI can be developed
without a Tauri window. It never starts a core or writes a config.

## Desktop shell

```bash
npm run desktop:dev
npm run desktop:build
```

Windows prerequisites: Rust stable, MSVC Build Tools with the C++ workload, Windows
SDK 10 and WebView2 Runtime. The desktop shell was compiled and tested with VS 2026
Build Tools via `vcvarsall.bat x64`. If `tauri info` does not detect VS 18, run the
desktop commands from a Developer Command Prompt.

Verified end-to-end: probe a standard mihomo → import YAML → nodes/exits/rules
populate → edit nodes/exits/rules/chains → `mihomo -t` → export a new YAML → file
list preview/re-edit. Closing the window hides it to the tray; single instance is
enabled.

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
