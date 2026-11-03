import { invoke } from '@tauri-apps/api/core';

import type {
  AppSettings,
  ConfigApplyResult,
  ConfigStatus,
  ConfigValidation,
  CoreProbe,
  DnsInput,
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

export function formatError(error: unknown): string {
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

export async function getWorkspaceView(): Promise<WorkspaceView> {
  if (!isTauriRuntime()) {
    return {
      settings: { 'mixed-port': 7890, mode: 'rule', 'log-level': 'info' },
      nodes: [
        { name: 'Demo Node A', type: 'ss', server: 'a.example.com', port: 443 },
        { name: 'Demo Node B', type: 'trojan', server: 'b.example.com', port: 443 },
      ],
      exits: [
        { name: 'Auto', type: 'url-test', proxies: ['Demo Node A', 'Demo Node B'] },
      ],
      rules: ['DOMAIN-SUFFIX,openai.com,Auto', 'MATCH,DIRECT'],
      ruleProviders: {},
      proxyProviders: {},
      hosts: {},
      nodeCount: 2,
      exitCount: 1,
      ruleCount: 2,
    };
  }
  return invoke<WorkspaceView>('workspace_view');
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

export async function importSource(input: string): Promise<ConfigStatus> {
  if (!isTauriRuntime()) {
    throw new Error('Browser mode cannot read local files or network. Use the Tauri app.');
  }
  return invoke<ConfigStatus>('import_source', { input });
}

export async function importNodeLinks(text: string): Promise<ConfigStatus> {
  if (!isTauriRuntime()) {
    throw new Error('Browser mode cannot read local files. Use the Tauri app.');
  }
  return invoke<ConfigStatus>('import_node_links', { text });
}

export async function getDnsYaml(): Promise<string> {
  if (!isTauriRuntime()) return 'dns:\n  enable: true\n';
  return invoke<string>('workspace_dns_yaml');
}

export async function applyDnsYaml(yaml: string): Promise<ConfigApplyResult> {
  if (!isTauriRuntime()) {
    return {
      ok: true,
      yaml: 'dns: {}\n',
      warnings: [],
      validation: {
        ok: true,
        timedOut: false,
        output: 'Browser preview: nothing was written to disk.',
      },
    };
  }
  return invoke<ConfigApplyResult>('apply_dns_yaml', { yaml });
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
    return {
      ok: true,
      yaml: 'dns: {}\n',
      warnings: [],
      validation: {
        ok: true,
        timedOut: false,
        output: 'Browser preview: nothing was written to disk.',
      },
    };
  }
  return invoke<ConfigApplyResult>('apply_dns_config', { input });
}

export async function addNodeYaml(yaml: string): Promise<ConfigStatus> {
  if (!isTauriRuntime()) {
    throw new Error('Browser mode cannot add nodes to the desktop workspace.');
  }
  return invoke<ConfigStatus>('add_node_yaml', { yaml });
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

export { formatError as errorMessage };
