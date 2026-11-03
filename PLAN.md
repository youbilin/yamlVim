# YamlVim — Standalone mihomo Routing & DNS Workbench

Status: draft v0.2 · 2026-11-03
Working folder: `yamlVim`
Working title: **YamlVim** (rename later if needed)

---

## 1. Product goal

YamlVim is a local-first desktop workbench for a **standard mihomo core**. It owns a
mihomo workspace, generates YAML, edits routing and DNS visually, and validates the
result with the real core. Safe mode never starts, stops or reloads the core.

It is **client-agnostic**. Clash Verge, FlClash or any other client is not a dependency;
the only runtime requirement is a standard mihomo binary (or an already-running mihomo
controller in attach mode). A client-embedded core may be a custom wrapper and is not
assumed to be CLI-compatible.

The differentiator versus the existing Clash RuleVis project is **DNS overwriting**:

- replace the complete `dns:` block, similar to Clash Verge's DNS overwrite;
- define per-domain resolution policies, fixed-IP hosts and fake-IP bypass rules;
- preview the effective resolution path;
- edit the generated YAML directly in the preview and write it back.

### Success definition

On a clean Windows machine a user can:

1. Install YamlVim.
2. Select a standard mihomo binary (or download one on demand).
3. Import an existing mihomo config, or start from a built-in template.
4. Edit nodes, exits, chains, rules and DNS overrides in the UI.
5. Preview the complete YAML, optionally edit it by hand, and sync it back.
6. Validate the config with `mihomo -t`.
7. Attach read-only to a running mihomo controller and see live connections.
8. Test DNS resolution and delay for proxies the controller already knows.
9. Edit the workspace and export a new standalone YAML without touching the running core.

---

## 2. Scope

### v1 in scope

- Standard mihomo binary for compatibility probe and `mihomo -t` validation.
  Safe mode does not start, stop or reload a process.
- Attach mode: connect to an already-running mihomo controller over TCP, Windows named
  pipe or Unix socket, read-only.
- Workspace ownership: import an existing YAML into a curated workspace, preserve
  unknown top-level keys in settings, and generate a new YAML from the workspace.
- Routing parity with Clash RuleVis:
  - nodes and sources (subscription, YAML, paste, share links)
  - exits / policy groups
  - chain proxies (`dialer-proxy`)
  - rules and rule sets
  - live connections and delay tests
  - export, diff, history, snapshots
- DNS workbench:
  - DNS override toggle (full `dns:` block replacement)
  - global DNS settings
  - upstream groups (default / proxy / direct / fallback)
  - per-domain nameserver policies
  - hosts overrides (domain → fixed IP)
  - fake-IP filter and fake-IP filter mode
  - fallback filter
  - static effective-resolution preview
  - live DNS query through the controller
  - DNS / fake-IP cache flush (with confirmation)
- Editable workspace YAML:
  - Config page edits the generated workspace YAML
  - saving updates the workspace and config.yaml, never a running mihomo
  - DNS YAML editor that syncs with the DNS form and preserves unknown fields
- Core settings: ports, mode, log level, allow-lan, IPv6, controller endpoint.
- Workspace pipeline: validate → history snapshot → atomic write → export new YAML;
  no reload and no writes to a running controller.
- Tray, single instance, start-on-launch option.
- Windows x64 installer first; Rust core kept cross-platform where practical.

### Out of scope for v1

- Client-specific integrations (FlClash, Clash Verge profiles, profile switching,
  `clash://install-config`, client service management).
- Bundling a mihomo binary by default (licensing and version churn — see §12).
- System proxy toggling and Windows service installation.
- OS-level DNS changes. "DNS overwrite" means mihomo's own DNS configuration and
  per-domain policies, never rewriting Windows/macOS/Linux system DNS settings.
- Automatic core elevation for TUN; TUN is config-level and documented as requiring admin.
- Cloud sync, accounts, telemetry.
- Multi-hop chains beyond the current single `dialer-proxy` model.
- Proxy providers and advanced provider orchestration (preserve in workspace settings,
  do not edit yet).
- Full comment-preserving YAML round-trip. Import and save normalize the YAML and can
  drop comments; the source file is never modified.

---

## 3. Resolved decisions

These are the decisions taken after the initial plan review:

| # | Decision |
| --- | --- |
| 1 | **Core**: target a standard mihomo binary for probing and `mihomo -t` validation. Do not bundle one by default. Client-embedded cores are not assumed CLI-compatible. Safe mode never starts, stops or reloads a core; attach mode is read-only. |
| 2 | **DNS override**: support both a full `dns:` block replacement (like Clash Verge's DNS overwrite) and per-domain overrides. |
| 3 | **Preview**: visual editing is primary, but the preview is editable. The user can sync edited YAML back into the visual workspace or apply it as raw YAML. |
| 4 | **Operating modes**: safe mode only. YamlVim never starts, stops or reloads mihomo. It attaches read-only to an existing controller for live data; edits and exports only produce new YAML files. |
| 5 | **Export baseline**: the current workspace is the only source of truth. Import populates nodes/exits/rules/DNS; export regenerates a new YAML. There is no hidden base; old versions live only in history snapshots. |
| 6 | **Platform**: Windows first; macOS/Linux structurally supported and compile-checked, but not v1 release targets. |

### Core compatibility probe

Client-embedded cores are not guaranteed to accept standard mihomo flags. YamlVim uses
a probe before offering managed mode:

1. Run `<core> -v` and read the version.
2. Run `<core> -t -f <temp-config> -d <temp-dir>` against a minimal valid config.
3. If both succeed, the core is **managed-capable**.
4. If the probe fails, the core is treated as **attach-only**; YamlVim explains why and
   offers to select or download a standard mihomo binary.

This avoids a fragile assumption that "it has mihomo inside" means "it accepts mihomo
flags". It also gives a clear path for users who only have a client-bundled core.

---

## 4. Operating modes and core providers

### Safe mode (current)

YamlVim owns a workspace and generates YAML files. It does not start, stop or reload
mihomo, and does not write to another client's profile or controller.

```text
YamlVim
  ├── workspace.json       # source of truth
  ├── config.yaml          # generated from the workspace
  ├── history/             # full snapshots of old versions
  └── exports/             # new timestamped YAML files
```

Requirements:

- standard mihomo binary with `-v` and `-t` for probing and validation
- no process management in the current scope
- no writes to a running controller

### Attach mode (read-only)

Connect to an already-running mihomo controller:

- TCP: `host:port` + secret
- Windows named pipe: `\\?\pipe\...`
- Unix socket: `/path/to.sock`

Attach mode is for live connections, DNS queries, proxy inspection and delay tests.
It never writes the config or reloads the core. A read-only kernel can only delay-test
proxies already present in its config; new workspace nodes need a direct probe or a
temporary test core. Cache flush is allowed only after explicit confirmation because
it changes the running core's state. Attach mode is the next implementation slice.

### Core provider abstraction

`yamlvim-mihomo` exposes a provider trait with three implementations:

| Provider | Managed | Attach | Validation |
| --- | --- | --- | --- |
| `StandardMihomo` | no (safe mode) | yes | `mihomo -t` + controller health |
| `AttachOnlyController` | no | yes | controller health only |
| `IncompatibleCore` | no | no | reported to the user with probe output |

The UI selects a provider based on the probe result, not on the binary's filename.

### Core acquisition

1. User-selected binary path (persisted).
2. `YAMLVIM_MIHOMO` environment variable.
3. `PATH` lookup: `mihomo`, `mihomo.exe`, `clash-meta`.
4. App `bin/` directory.
5. Optional guided download from the official mihomo release, with:

   - explicit user consent
   - version pin and checksum
   - download progress and error handling
   - stored in the app data `bin/` directory

Download-on-demand is not bundling. It keeps the installer small and avoids shipping a
GPL binary inside an MIT application without a license review.

---

## 5. Data and configuration ownership

### Data directory

```text
<app folder>\data\                     # debug: project/data; release: next to the exe
├── settings.json                     # core path and app settings
├── workspace.json                    # source of truth: settings, nodes, exits, rules, DNS
├── config.yaml                       # generated from the workspace
├── history/                          # full YAML snapshots of imports, edits and exports
├── exports/                          # new timestamped YAML files
└── core/                             # GeoData, providers and temporary -t configs
```

The data directory is portable and app-local: `YAMLVIM_DATA_DIR` overrides it,
debug builds use the project `data/` folder, and release builds use `data/`
next to the executable. YamlVim does not use `%APPDATA%`.

### Workspace pipeline

```text
imported YAML
        │
        ├── settings (ports, tun, sniffer, profile, unknown keys)
        ├── proxies / proxy-groups / rules
        ├── rule-providers / proxy-providers
        └── dns / hosts

workspace
        │
        └── generator -> config.yaml -> mihomo -t -> export / edit snapshot
```

Rules:

- The workspace is the only source of truth. There is no hidden base config.
- Unknown top-level keys are preserved in settings.
- Nodes, exits and rules are regenerated from the workspace, so deletion is real.
- Provider paths are rewritten into `data/core/providers`; GeoData is copied into
  `data/core`.
- Exported YAML strips `external-controller` and `secret`.
- Import replaces the workspace and writes full history snapshots; old versions
  survive only in `data/history`.
- YamlVim never starts, stops or reloads mihomo in safe mode; edits only produce YAML.

### Workspace versioning

- `workspace.json` is validated on load; malformed JSON returns an error instead of
  overwriting the file.
- Legacy `config.yaml`/`base.yaml` data is migrated into the workspace once.
- Explicit schema versioning is planned; history snapshots provide the recovery path.

---

## 6. Feature scope in detail

### 6.1 Nodes and sources

Reuse the Clash RuleVis model and importers:

- subscription URLs, local YAML/text files, pasted YAML, pasted share links
- SS / SSR / VMess / VLESS / Trojan / Hysteria2 / TUIC / SOCKS5
- source refresh, traffic/expiry metadata, tags, bulk enable/disable
- duplicate merge, last speed-test results

No client-specific "read current profile" path. Replace it with:

- "Import a mihomo config file"
- "Import the currently applied YamlVim config"
- optional "read from running core" via controller only for nodes/groups introspection

### 6.2 Exits, chains, rules

- Policy groups: `select`, `url-test`, `fallback`, `load-balance`.
- Static member expansion at export time, same behavior as Clash RuleVis.
- Chain nodes via `dialer-proxy`, with validation that relay/landing nodes exist and
  are enabled.
- Rules: one ordered list containing plain rules, rule-set routes and subscription
  rules; drag to reorder; group collapse; batch enable/disable/delete.
- Rule-set inspection and refresh for local files and URLs.
- Live hit information when the core is connected.

### 6.3 DNS workbench

The DNS page has an **override switch** at the top, mirroring Clash Verge's DNS
overwrite behavior:

- **Override off**: the imported base `dns:` block is preserved as-is, and the DNS
  form is read-only ("inherited from base config").
- **Override on**: the editor's DNS block replaces the base `dns:` block. Known
  fields are rendered as forms; unknown fields live in an advanced YAML pane and are
  preserved on export.
- Turning override on offers "Initialize from base" so the user can start from the
  imported block instead of an empty template.
- Per-domain rules are active only while override is on.

#### Global DNS settings

| Field | UI | Notes |
| --- | --- | --- |
| `enable` | switch | required for DNS override features |
| `listen` | text | e.g. `127.0.0.1:1053`; warn on `0.0.0.0` |
| `ipv6` | switch | |
| `ipv6-timeout` | number | advanced |
| `prefer-h3` | switch | advanced |
| `enhanced-mode` | select | `fake-ip` / `redir-host` |
| `fake-ip-range` | text | validated CIDR |
| `fake-ip-range6` | text | IPv6 CIDR, advanced |
| `fake-ip-filter` | list editor | domain suffixes and geosite entries |
| `fake-ip-filter-mode` | select | `blacklist` / `whitelist` |
| `fake-ip-ttl` | number | advanced |
| `default-nameserver` | list | bootstrap resolvers, IP-only validation |
| `nameserver` | list | default upstreams |
| `proxy-server-nameserver` | list | resolves proxy server hostnames |
| `proxy-server-nameserver-policy` | structured editor | version-gated |
| `direct-nameserver` | list | version-gated |
| `direct-nameserver-follow-policy` | switch | version-gated |
| `fallback` | list | fallback upstreams |
| `fallback-filter` | structured editor | geoip, geoip-code, ipcidr, domain, geosite |
| `fallback-lazy-query` | switch | advanced |
| `cache-algorithm` | text | advanced |
| `cache-max-size` | number | advanced |
| `use-hosts` / `use-system-hosts` | switches | |
| `respect-rules` | switch | warn about interaction with routing rules |
| unknown DNS keys | advanced YAML pane | preserved on export |

The table is a coverage target, not a hardcoded schema. The editor is schema-driven and
keeps any field it does not understand in the advanced pane. Upstream syntax support:
`system`, `udp://`, `tcp://`, `tls://`, `https://`, `quic://`, `dhcp://`,
`rcode://` where supported by the detected core version.

#### Per-domain overrides

A unified ordered list of DNS override rules. Each rule has:

- **Match**: exact domain, domain suffix / wildcard (`+.example.com`), geosite
  (feature-gated), or rule-set reference. Keyword and regex are not part of mihomo's
  `nameserver-policy` syntax and are intentionally not offered.
- **Action**:
  - use specified upstream(s) → compiles into `nameserver-policy`
  - return fixed IP(s) → compiles into `hosts`
  - bypass fake-IP → compiles into `fake-ip-filter`
  - block → compiles into `rcode://refused` when supported, otherwise rejected
    with a clear validation error
- **Enabled**, **note**, **priority**.

Compilation rules:

- Fixed-IP actions always compile to `hosts`; values may be IPv4 or IPv6.
- Upstream actions compile to `nameserver-policy`; duplicate keys are merged or
  rejected, never silently overwritten.
- Fake-IP bypass compiles to `fake-ip-filter`.
- The app detects overlapping matches (suffix vs exact vs geosite) and shows which
  rule wins; mihomo's real matching behavior is the final source of truth.
- Rule-set references must exist in the workspace; missing providers block apply.
- `fallback-filter.geosite` is deprecated by mihomo 1.19. It is preserved for
  round-trip compatibility but the compiler emits a warning and the UI steers users
  toward `nameserver-policy`.
- `fallback-filter.geoip: true` requires a local GeoIP/MMDB database. The compiler
  warns; the managed-core bootstrap must provision the database or the user must
  disable GeoIP filtering.
- Every `rule-set:` policy key must correspond to a `rule-providers` entry in the
  generated config; the compiler validates the name and the generator emits the
  provider reference.

#### Effective DNS preview

For a domain, show a deterministic explanation:

1. Which override rule matches (or "no override").
2. Which upstream list will be used.
3. Whether fake-IP is active or bypassed.
4. Whether the domain is pinned by `hosts`.
5. The compiled YAML snippet for that decision.
6. Warnings for shadowed rules, duplicate keys, missing providers, or an
   override that can never win.

The preview is static and explains intent. The live query is authoritative.

#### Live DNS panel

When a controller is connected (managed or attach mode):

- Query `GET /dns/query?name=<domain>&type=<A|AAAA|...>`.
- Show answer, elapsed time, fake-IP vs real IP, and compare with the static preview.
- Flush DNS and fake-IP caches via the controller after confirmation.
- Show the currently loaded DNS settings from the core if the API exposes them;
  otherwise show the last applied snapshot with a timestamp.

### 6.4 Editable preview and two-way YAML sync

The preview is not a dead-end. It has two explicit paths so the visual state and the
YAML text never silently diverge.

#### Generated preview

- Full YAML generated from the current workspace.
- Copy / download actions.
- Syntax highlight and line numbers.

#### Edit mode

The YAML text area becomes editable.

1. **Save to workspace**
   - Parse the edited YAML.
   - Extract settings, nodes, exits, rules, providers, DNS and hosts into the workspace.
   - Normalize dangling proxy-group members.
   - Write a history snapshot of the previous YAML.
   - Atomically write `workspace.json` and `config.yaml`.
   - Never start, stop or reload mihomo.
2. **Validate and export**
   - `mihomo -t` validates the generated YAML.
   - Export writes a new timestamped YAML file.
   - No hidden base config is merged.

#### DNS YAML editor

The DNS tab has a dedicated YAML pane for the override block:

- Two-way sync with the DNS form.
- Unknown DNS keys are preserved.
- "Initialize from workspace" copies the current DNS block into the override.
- Validation runs before saving.

#### Comments

- Import and save normalize YAML and can drop comments.
- The source file is never modified.
- History snapshots preserve the generated YAML at each step.

### 6.5 Live connections and safe-mode core handling

- Safe mode (current): YamlVim probes and validates with a standard mihomo binary but
  never starts, stops or reloads a process.
- Read-only attach (next):
  - Controller client over HTTP and WebSocket:
    - `/connections`, `/traffic`, `/logs`, `/configs`, `/proxies`, delay tests.
  - Transports: TCP + secret, Windows named pipe, Unix socket.
  - No config writes and no reload.
  - Cache flush requires confirmation.
- Latency:
  - A read-only kernel can delay-test only proxies already in its config.
  - New workspace nodes are not present in that kernel; they need a direct app-side
    probe or a temporary test core (future option).
- TUN: if `tun.enable` is true in an exported config, document that using it requires
  administrator privileges; YamlVim never elevates.

### 6.6 Workspace save and export pipeline

```text
workspace change
  → generate candidate YAML
  → static validation (references, empty groups, duplicate rules, DNS conflicts)
  → mihomo -t validation (when applying DNS or validating)
  → history snapshot of the previous YAML
  → atomic write workspace.json + config.yaml
  → export writes a new timestamped YAML file
```

- No step starts, stops or reloads mihomo.
- Import, edit and export each write full history snapshots; only history preserves
  old versions.
- Export always regenerates from the current workspace; there is no hidden base.
- A failed `mihomo -t` blocks the DNS apply and leaves the workspace unchanged.
- Raw YAML editing is explicit; saving updates the workspace, not a running core.

---

## 7. Technical stack

### Desktop

- Tauri 2
- Rust stable, MSVC toolchain on Windows
- crates:
  - `yamlvim-core` — workspace model, normalization, YAML generation, link parsing,
    DNS schema/compiler, validation rules, history metadata
  - `yamlvim-mihomo` — core provider abstraction, binary discovery, compatibility
    probe, process manager, controller client (TCP / named pipe / Unix socket),
    `mihomo -t` validator, log capture
  - `src-tauri` — IPC shell, tray, single instance, window lifecycle

### Frontend

- React 19, TypeScript strict, Vite 8
- Zustand, dnd-kit, TanStack Virtual, lucide-react
- Existing Clash RuleVis visual system (monochrome, compact, virtualized lists)
- Chinese-first UI copy, English README; strings kept i18n-ready
- YAML editor component with syntax highlighting and diff view

### Testing

- Rust unit tests for model, generator, DNS compiler, merge/round-trip.
- Golden fixtures for DNS configurations.
- Core provider probe tests with fake binaries.
- Integration tests for process manager behind a trait; mocked controller HTTP/pipe.
- Optional real-mihomo smoke test (ignored by default), like Clash RuleVis.
- Playwright E2E against a mock controller with a temp data directory.
- CI: typecheck, unit, build, rust fmt/clippy/test, Windows desktop check, E2E.

---

## 8. Reuse map from Clash RuleVis

### Copy / adapt

| Source | Destination | Notes |
| --- | --- | --- |
| `rust/rulevis-core/src/model.rs` | `crates/yamlvim-core` | workspace model and normalization |
| `rust/rulevis-core/src/generator.rs` | `crates/yamlvim-core` | YAML generation and validation |
| `rust/rulevis-core/src/links.rs` | `crates/yamlvim-core` | share-link parsing |
| `rust/rulevis-core/src/resolve.rs`, `regions.rs`, `defaults.rs` | `crates/yamlvim-core` | helpers |
| `rust/rulevis-app/src/{storage,export,importer,fetcher,rulesets,probe,live}.rs` | `crates/yamlvim-*` | port, then remove client-specific assumptions |
| `src/pages/*`, `src/components/*`, `src/store/*`, `src/styles/*` | `src/` | keep visual system, replace API adapter |
| `shared/types.ts`, `shared/model.ts`, `shared/recommended.ts` | `shared/` | extend with DNS types |
| `fixtures/` | `fixtures/` | reuse as semantic contract, add DNS fixtures |

### Remove / rewrite

- `rust/rulevis-app/src/verge.rs`
- `rust/rulevis-app/src/verge_live.rs`
- Verge profile detection, `clash://install-config`, Verge base-template merge
- Verge-specific settings, paths and "open in Verge" actions
- `server/*` at runtime (may be kept only as a development reference)

### Add

- DNS override model, schema-driven editor, compiler, preview and live-query UI
- editable YAML preview with sync-to-visual and apply-raw paths
- core provider abstraction with compatibility probe
- mihomo binary discovery and process manager
- workspace ownership / history snapshots / safe export pipeline
- core settings page (ports, mode, log level, controller)

**Licensing:** Clash RuleVis is MIT; reuse is compatible. mihomo is GPL-3.0 — do not
bundle its binary without reviewing distribution obligations. A guided download is the
preferred acquisition path.

---

## 9. Proposed repository layout

```text
yamlVim/
├── PLAN.md
├── README.md
├── LICENSE
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
├── src/
│   ├── api.ts                 # Tauri invoke adapter
│   ├── pages/                 # live, nodes, exits, chains, rules, dns, export, settings
│   ├── components/
│   ├── store/
│   ├── lib/
│   ├── styles/
│   └── data/                  # generated rule catalog
├── shared/                    # TS types shared by UI and tests
├── crates/
│   ├── yamlvim-core/
│   └── yamlvim-mihomo/
├── src-tauri/
│   ├── src/
│   ├── capabilities/
│   └── tauri.conf.json
├── fixtures/
├── tests/e2e/
└── docs/
```

---

## 10. Milestones

### M0 — Scaffold and reuse audit

- Create Tauri 2 + React 19 + Vite project.
- Copy/adapt `rulevis-core` and the UI shell; strip all client-specific code.
- Set up CI and the data-directory layout.
- Import a sample mihomo config and export a semantically equivalent YAML.

**Done when:** app launches, imports `fixtures/config-basic.yaml`, and exports the
same known sections.

### M1 — Core probing and safe-mode validation

- Standard mihomo discovery and compatibility probe.
- `mihomo -t` validation against the app data directory.
- No process start/stop; no controller writes.
- Attach mode over TCP / named pipe / Unix socket is the next slice.

**Done when:** the app can identify a standard mihomo, validate generated YAML with
`mihomo -t`, and explain why a client-bundled core is attach-only.

### M2 — Workspace ownership and one-click import

- Workspace model: settings, nodes, exits, rules, providers, DNS and hosts.
- Import populates the Nodes, Exits and Rules pages in one action.
- Workspace-only export; no hidden base config.
- Raw YAML editor and history snapshots.
- Provider and GeoData copying with path rewriting.

**Done when:** deleting a node in the workspace removes it from the exported YAML,
and old versions exist only in `data/history`.

### M3 — DNS workbench

- DNS override toggle, global editor, per-domain rules, hosts, fake-IP filter,
  fallback filter.
- Schema-driven fields plus advanced DNS YAML pane; unknown-key preservation.
- Compiler to mihomo fields; conflict and shadow detection.
- Static preview + live `/dns/query` panel + cache flush.
- DNS fixtures and golden tests.

**Done when:** a config with fake-IP, DoH/DoT, `nameserver-policy`, hosts and
fallback-filter passes `mihomo -t`, and the preview matches live results on the
supported test matrix.

### M4 — Visual editors, history UI and packaging prep

- Dedicated node/exit/rule editors on top of the workspace model.
- History browser with restore.
- Export diff and portable provider-path rewriting.
- Tray, single instance and packaging.

**Done when:** a user can edit nodes/exits/rules without raw YAML, restore a history
snapshot, and export a portable YAML without touching a running mihomo.

### M5 — Packaging and docs

- Windows NSIS installer, unsigned initially.
- README, DNS guide, core compatibility notes, known limitations, demo data.
- Release workflow and checksums.

**Done when:** a clean Windows machine can install, select/download mihomo, import,
edit DNS, validate with `mihomo -t`, and export a new YAML in safe mode.

---

## 11. Testing strategy

### Unit / golden

- YAML import → workspace → generate round-trip (semantic comparison).
- Unknown-key preservation in base and DNS `extra`.
- DNS compilation:
  - fixed IP → `hosts`
  - upstream → `nameserver-policy`
  - fake-IP bypass → `fake-ip-filter`
  - block → `rcode://refused` (feature-gated)
  - duplicate and overlapping rules
  - missing rule-set providers
- DNS override off → base block preserved; override on → replacement block emitted.
- Generator validation: empty exits, disabled targets, duplicate rules, chain cycles.
- Share-link parsing (port existing 8-protocol suite).
- Raw YAML sync: parse edited YAML → workspace → regenerate; unsupported structure
  produces an error without state mutation.

### Integration

- Core provider probe with a fake standard binary and a fake incompatible binary.
- Process manager behind a `CoreRunner` trait.
- Controller client against a mock HTTP/WebSocket/pipe server.
- Attach mode read-only guarantees (no write/reload calls).
- Optional `mihomo` smoke job in CI; real-binary tests ignored by default.
- Workspace save/export with an injected history-write failure.

### E2E

- Playwright with a mock controller and temp data directory:
  - import config
  - create nodes and an exit
  - enable DNS override and add a per-domain rule
  - preview resolution
  - edit YAML in the preview and sync it back
  - import and verify nodes/exits/rules pages
  - edit workspace YAML, delete a node, save
  - export a new YAML and assert the deleted node is absent

### Matrix

- Windows 11 + mihomo latest stable (primary).
- Ubuntu CI for core logic and controller mocks.
- macOS compile check only, not a v1 release target.

---

## 12. Risks and mitigations

| Risk / decision | Impact | Proposed handling |
| --- | --- | --- |
| Client-embedded core is not CLI-compatible | Managed mode fails if the user only has a client-bundled core | Compatibility probe; attach-only fallback; guided standard-mihomo download; clear error |
| Standard mihomo acquisition | First-run friction | Auto-detect, user-selected binary, optional download with checksum |
| mihomo DNS fields vary by version | Compiler may emit unsupported keys | Feature-detect version; validate with `mihomo -t`; schema-driven editor + unknown-key preservation |
| Nameserver-policy order semantics | Preview may disagree with core | Show static preview as advisory; use live query as truth; warn on overlaps |
| YAML comments are lost on visual sync | Users may care about hand-edited comments | Explicit edit-mode banner; Apply raw preserves text; document the difference |
| Two-way YAML sync state divergence | Visual state may not match raw file | Sync-to-visual transaction + detached state + re-import; never silent overwrite |
| Attach mode writes | Could modify a config the app does not own | Read-only; apply disabled; cache flush requires confirmation |
| TUN requires admin | First-run failures on Windows | Detect `tun.enable`, warn, never silently elevate; document |
| Large configs / rule sets | UI performance | Keep TanStack Virtual, lazy catalog loading, batch operations |
| Reused code carries client-specific assumptions | Hidden coupling | Audit imports, delete Verge modules, add standalone tests |
| Windows-only testing | macOS/Linux regressions | Keep platform code behind traits; compile-check other targets |

---

## 13. Recommended first implementation step

Build the two riskiest pieces before the UI:

1. **DNS compiler + fixtures**
   - Define `DnsSettings` and `DnsOverrideRule` in `yamlvim-core`.
   - Write golden tests for fixed IP, upstream, fake-IP bypass, block, override on/off
     and overlap cases.
   - Validate compiled YAML with `mihomo -t` against a small fixture matrix.

2. **Core compatibility probe**
   - Implement `-v` and `-t` probing with a temp config.
   - Prove that a standard mihomo can be managed and that an incompatible client core
     is correctly downgraded to attach-only.

Only then build the editor, preview and process manager on top of the proven core.

This keeps the two highest-risk assumptions testable and prevents the UI from encoding
behaviors that the real core cannot validate.

---

## 14. Implementation status

2026-11-04 — first slice complete.

### `yamlvim-core`

- DNS override model: `DnsInput`, `DnsSettings`, `DnsRule`, `DnsMatch`, `DnsAction`.
- Compiler: full `dns:` block, `nameserver-policy`, top-level `hosts`,
  `fake-ip-filter`, and block rules via `rcode://refused`.
- Validation: domains, IPs, CIDRs, upstreams, rule-set references, duplicate
  policies/hosts, overlap warnings, deprecated `fallback-filter.geosite`, and
  GeoIP/MMDB warnings.
- Unknown DNS fields survive through `extra`.
- 18 DNS tests, 6 config tests and 4 workspace tests, plus golden fixtures.

### `yamlvim-mihomo`

- `CommandRunner` / `SystemRunner` with timeout, output capture and Windows
  `CREATE_NO_WINDOW`.
- `probe_core` classifies a binary as managed, attach-only or unusable.
- `validate_config` runs `mihomo -t` against the app data directory.
- Process runner is kept for a future optional test core, not used in safe mode.
- 5 probe tests, 4 validation tests and 2 process tests.

### Real-core verification

- `mihomo v1.19.32` accepted the compiled basic and advanced DNS configs with
  `-t` after adding the referenced rule provider and disabling GeoIP fallback
  that requires an MMDB.
- `FlClashCore.exe` was correctly classified as attach-only: it rejects
  standard mihomo flags and only accepts its client-specific invocation.

### Commands

```bash
cargo +stable-x86_64-pc-windows-gnu test --workspace   # 39 tests
cargo run -p yamlvim-core --bin yamlvim-core -- dns fixtures/dns/basic.yaml
cargo run -p yamlvim-mihomo --bin yamlvim-probe -- <path-to-mihomo>
```

### 2026-11-04 — M2 workspace ownership and safe mode

- Tauri 2 + React 19 + Vite application shell with a monochrome sidebar and pages
  for core, DNS, config, nodes, exits and rules.
- App-local, portable `data/`: debug uses `project/data`, release uses
  `<exe>/data`, and `YAMLVIM_DATA_DIR` overrides it. No AppData.
- **Workspace-only source of truth**: import parses `proxies`, `proxy-groups`,
  `rules`, `rule-providers`, `proxy-providers`, DNS and hosts into
  `workspace.json`. One import populates the Nodes, Exits and Rules pages.
- **No hidden base**: export regenerates a new YAML from the current workspace.
  Deleting a node removes it from the export; old versions live only in
  `data/history`.
- **Editable workspace**: the Config page has a raw YAML editor. Saving updates
  `workspace.json` and `config.yaml`; it never starts, stops or reloads mihomo.
- Provider files are copied into `data/core/providers` and their `path` fields are
  rewritten to the app folder. GeoData is copied into `data/core`.
- DNS override is compiled against the workspace, previewed as a full config,
  validated with `mihomo -t`, and only then written to the workspace.
- **Safe mode only**: the Core page probes a standard mihomo but does not start or
  stop a process. Read-only controller attach/live data is next.
- Tauri commands: settings, `probe_core`, `compile_dns_preview`,
  `config_status`, `workspace_view`, `import_config`,
  `preview_dns_config`, `validate_config`, `apply_dns_config`,
  `save_workspace_yaml`, `export_config`.
- 39 Rust tests + 1 Tauri library integration test, frontend build, fmt and
  clippy pass. `mihomo v1.19.32 -t` accepts the workspace-generated YAML.
- The Tauri shell compiled with MSVC Build Tools 18 (VS 2026) via
  `vcvarsall.bat x64`. End-to-end verification: probe → import (nodes/exits/rules
  populate) → `mihomo -t` → apply DNS (history snapshot) → edit YAML and delete a
  node → export a new YAML without that node. `tauri info` may not auto-detect
  VS 18; use a vcvars-initialized shell or Developer Command Prompt.
- Next: controller read-only attach/live data. A read-only kernel can only
  delay-test proxies already in its config; new workspace nodes need a direct
  probe or a temporary test core.

