import { invoke } from '@tauri-apps/api/core';

import type {
  AppSettings,
  ConfigApplyResult,
  ConfigStatus,
  ConfigValidation,
  CoreProbe,
  DnsConfigPreview,
  DnsInput,
  DnsPreview,
  WorkspaceView,
} from './types';

const SETTINGS_KEY = 'yamlvim.settings.v1';
const DEFAULT_SETTINGS: AppSettings = { corePath: 'mihomo' };

export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

export async function loadSettings(): Promise<AppSettings> {
  if (!isTauriRuntime()) {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    try {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      return { corePath: parsed.corePath || DEFAULT_SETTINGS.corePath };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }
  return invoke<AppSettings>('load_settings');
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  if (!isTauriRuntime()) {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return;
  }
  await invoke('save_settings', { settings });
}

export async function getDataDir(): Promise<string> {
  if (!isTauriRuntime()) return 'Browser localStorage (no app data directory)';
  return invoke<string>('data_dir');
}

export async function probeCore(path: string): Promise<CoreProbe> {
  if (!isTauriRuntime()) {
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    return {
      path,
      kind: 'managed',
      version: 'browser-mock',
      managed: true,
      attachOnly: false,
      output: 'Browser preview only. Run the Tauri app to probe a real mihomo binary.',
    };
  }
  return invoke<CoreProbe>('probe_core', { path });
}

export async function compileDnsPreview(input: DnsInput): Promise<DnsPreview> {
  if (!isTauriRuntime()) {
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    return mockPreview(input);
  }
  return invoke<DnsPreview>('compile_dns_preview', { input });
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function mockPreview(input: DnsInput): DnsPreview {
  if (!input.enabled) {
    return {
      enabled: false,
      yaml: '# DNS override is disabled\n# The base dns block remains in effect.\n',
      warnings: [],
    };
  }

  const lines = [
    '# Browser preview — the Rust DNS compiler is not attached',
    'dns:',
    `  enable: ${Boolean(input.settings.enable)}`,
  ];

  for (const key of ['listen', 'enhanced-mode', 'fake-ip-range']) {
    const value = input.settings[key];
    if (typeof value === 'string' && value) lines.push(`  ${key}: ${value}`);
  }

  const nameservers = stringList(input.settings.nameserver);
  if (nameservers.length) {
    lines.push('  nameserver:');
    for (const server of nameservers) lines.push(`    - ${server}`);
  }

  const filters = stringList(input.settings['fake-ip-filter']);
  if (filters.length) {
    lines.push('  fake-ip-filter:');
    for (const filter of filters) lines.push(`    - ${filter}`);
  }

  const policy: string[] = [];
  const hosts: string[] = [];
  for (const rule of input.rules) {
    const key =
      rule.match.type === 'suffix'
        ? `+.${rule.match.value}`
        : rule.match.type === 'geosite'
          ? `geosite:${rule.match.value}`
          : rule.match.type === 'rule-set'
            ? `rule-set:${rule.match.value}`
            : rule.match.value;
    const type = typeof rule.action.type === 'string' ? rule.action.type : '';
    if (type === 'nameserver') {
      const servers = stringList(rule.action.servers);
      policy.push(`    '${key}': ${servers[0] ?? 'system'}`);
    }
    if (type === 'block') policy.push(`    '${key}': rcode://refused`);
    if (type === 'fixed-ip') {
      const ips = stringList(rule.action.ips);
      hosts.push(`  ${rule.match.value}: ${ips[0] ?? '127.0.0.1'}`);
    }
  }

  if (policy.length) {
    lines.push('  nameserver-policy:');
    lines.push(...policy);
  }
  if (hosts.length) {
    lines.push('hosts:');
    lines.push(...hosts);
  }

  return {
    enabled: input.enabled,
    yaml: lines.join('\n') + '\n',
    warnings: [
      {
        code: 'browser-preview',
        message:
          'Browser preview only. Base config merging and the Rust compiler run in the Tauri app.',
      },
    ],
  };
}


export async function getConfigStatus(): Promise<ConfigStatus> {
  if (!isTauriRuntime()) {
    return {
      dataDir: 'Browser preview (data is not written)',
      workspacePath: '',
      configPath: '',
      coreDir: '',
      geodata: [],
      hasWorkspace: false,
      nodeCount: 0,
      exitCount: 0,
      ruleCount: 0,
      historyCount: 0,
    };
  }
  return invoke<ConfigStatus>('config_status');
}

export async function importConfig(source: string): Promise<ConfigStatus> {
  if (!isTauriRuntime()) {
    throw new Error('Browser mode cannot read local files. Use the Tauri app.');
  }
  return invoke<ConfigStatus>('import_config', { source });
}

export async function previewDnsConfig(input: DnsInput): Promise<DnsConfigPreview> {
  if (!isTauriRuntime()) {
    const preview = mockPreview(input);
    return {
      enabled: preview.enabled,
      yaml: '# Browser preview — base config merging is only available in Tauri\n' + preview.yaml,
      warnings: preview.warnings,
    };
  }
  return invoke<DnsConfigPreview>('preview_dns_config', { input });
}

export async function validateConfig(yaml: string): Promise<ConfigValidation> {
  if (!isTauriRuntime()) {
    return {
      ok: true,
      timedOut: false,
      output: 'Browser preview: mihomo -t was not executed.',
    };
  }
  return invoke<ConfigValidation>('validate_config', { yaml });
}

export async function applyDnsConfig(input: DnsInput): Promise<ConfigApplyResult> {
  if (!isTauriRuntime()) {
    const preview = mockPreview(input);
    return {
      ok: true,
      yaml: preview.yaml,
      warnings: preview.warnings,
      validation: {
        ok: true,
        timedOut: false,
        output: 'Browser preview: nothing was written to disk.',
      },
    };
  }
  return invoke<ConfigApplyResult>('apply_dns_config', { input });
}


export async function saveWorkspaceYaml(yaml: string): Promise<ConfigStatus> {
  if (!isTauriRuntime()) {
    throw new Error('Browser mode cannot save the workspace.');
  }
  return invoke<ConfigStatus>('save_workspace_yaml', { yaml });
}

export async function exportConfig(): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error('Browser mode cannot export into the app data folder.');
  }
  return invoke<string>('export_config');
}


const BROWSER_WORKSPACE: WorkspaceView = {
  settings: { 'mixed-port': 7890, mode: 'rule', 'log-level': 'info' },
  nodes: [
    {
      name: 'Demo Node A',
      type: 'ss',
      server: 'a.example.com',
      port: 443,
    },
    {
      name: 'Demo Node B',
      type: 'trojan',
      server: 'b.example.com',
      port: 443,
    },
  ],
  exits: [
    {
      name: 'Auto',
      type: 'url-test',
      proxies: ['Demo Node A', 'Demo Node B'],
    },
  ],
  rules: ['DOMAIN-SUFFIX,openai.com,Auto', 'MATCH,DIRECT'],
  ruleProviders: {},
  proxyProviders: {},
  hosts: {},
  nodeCount: 2,
  exitCount: 1,
  ruleCount: 2,
};

export async function getWorkspaceView(): Promise<WorkspaceView> {
  if (!isTauriRuntime()) return BROWSER_WORKSPACE;
  return invoke<WorkspaceView>('workspace_view');
}

export { errorMessage };
