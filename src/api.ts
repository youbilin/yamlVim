import { invoke } from '@tauri-apps/api/core';

import type {
  AppSettings,
  ConfigApplyResult,
  ConfigStatus,
  ConfigValidation,
  CoreProbe,
  DnsInput,
  ExportFile,
  WorkspaceView,
} from './types';

const SETTINGS_KEY = 'yamlvim.settings.v1';
const DEFAULT_SETTINGS: AppSettings = {
  corePath: 'mihomo',
  controllerEndpoint: '',
  controllerSecret: '',
};

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
      return {
        corePath: parsed.corePath || DEFAULT_SETTINGS.corePath,
        controllerEndpoint: parsed.controllerEndpoint ?? '',
        controllerSecret: parsed.controllerSecret ?? '',
      };
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


export interface ControllerConfig {
  endpoint: string;
  secret: string;
}

export interface ControllerConnection {
  id: string;
  host: string;
  destination: string;
  network: string;
  proxyChain: string[];
  upload: number;
  download: number;
  start: string;
}

export async function controllerDnsQuery(name: string, kind: string): Promise<string> {
  if (!isTauriRuntime()) throw new Error('Browser mode: controller not available.');
  return invoke<string>('controller_dns_query', { name, kind });
}

export async function controllerFlushDns(): Promise<string> {
  if (!isTauriRuntime()) throw new Error('Browser mode: controller not available.');
  return invoke<string>('controller_flush_dns');
}

export async function saveController(endpoint: string, secret: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke('save_controller', { endpoint, secret });
}

export async function controllerGet(path: string): Promise<string> {
  if (!isTauriRuntime()) throw new Error('Browser mode: controller not available.');
  return invoke<string>('controller_get', { path });
}

export async function controllerDelay(name: string): Promise<{ name: string; delayMs?: number; error?: string }> {
  if (!isTauriRuntime()) throw new Error('Browser mode: controller not available.');
  return invoke<{ name: string; delayMs?: number; error?: string }>('controller_delay', { name });
}

export async function switchProxy(group: string, name: string): Promise<string> {
  if (!isTauriRuntime()) throw new Error('Browser mode: controller not available.');
  return invoke<string>('switch_proxy', { group, name });
}

export async function listExports(): Promise<ExportFile[]> {
  if (!isTauriRuntime()) return [];
  return invoke<ExportFile[]>('list_exports');
}

export async function latestExport(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  return invoke<string | null>('latest_export');
}

export async function deleteExport(path: string): Promise<void> {
  if (!isTauriRuntime()) throw new Error('Browser mode cannot delete files.');
  await invoke('delete_export', { path });
}

export async function readExport(path: string): Promise<string> {
  if (!isTauriRuntime()) return '';
  return invoke<string>('read_export', { path });
}

export async function loadExportAsWorkspace(path: string): Promise<ConfigStatus> {
  if (!isTauriRuntime()) {
    throw new Error('Browser mode cannot load files.');
  }
  return invoke<ConfigStatus>('load_export_as_workspace', { path });
}

export async function deleteNodes(names: string[]): Promise<ConfigStatus> {
  return invoke<ConfigStatus>('delete_nodes', { names });
}

export async function setNodesDisabled(
  names: string[],
  disabled: boolean,
): Promise<ConfigStatus> {
  return invoke<ConfigStatus>('set_nodes_disabled', { names, disabled });
}

export async function getNodeYaml(name: string): Promise<string> {
  return invoke<string>('node_yaml', { name });
}

export async function updateNodeYaml(oldName: string, yaml: string): Promise<ConfigStatus> {
  return invoke<ConfigStatus>('update_node_yaml', { oldName, yaml });
}

export async function deleteNode(name: string): Promise<ConfigStatus> {
  return invoke<ConfigStatus>('delete_node', { name });
}

export async function toggleNode(name: string, disabled: boolean): Promise<ConfigStatus> {
  return invoke<ConfigStatus>('toggle_node', { name, disabled });
}

export async function getExitYaml(name: string): Promise<string> {
  return invoke<string>('exit_yaml', { name });
}

export async function saveExitYaml(
  originalName: string | null,
  yaml: string,
): Promise<ConfigStatus> {
  return invoke<ConfigStatus>('save_exit_yaml', { originalName, yaml });
}

export async function deleteExit(name: string): Promise<ConfigStatus> {
  return invoke<ConfigStatus>('delete_exit', { name });
}

export async function createChainNode(
  baseName: string,
  dialer: string,
  name: string | null,
): Promise<ConfigStatus> {
  return invoke<ConfigStatus>('create_chain_node', { baseName, dialer, name });
}

export async function saveRules(rules: string[]): Promise<ConfigStatus> {
  return invoke<ConfigStatus>('save_rules', { rules });
}

export async function exportConfig(): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error('Browser mode cannot export into the app data folder.');
  }
  return invoke<string>('export_config');
}

export { formatError as errorMessage };
