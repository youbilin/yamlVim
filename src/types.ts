export type CoreKind = 'managed' | 'attach-only' | 'unusable';

export interface CoreProbe {
  path: string;
  kind: CoreKind;
  version?: string;
  managed: boolean;
  attachOnly: boolean;
  reason?: string;
  output: string;
}

export interface AppSettings {
  corePath: string;
  controllerEndpoint: string;
  controllerSecret: string;
}

export interface WorkspaceView {
  settings: Record<string, unknown>;
  nodes: Array<Record<string, unknown>>;
  exits: Array<Record<string, unknown>>;
  rules: unknown[];
  ruleProviders: Record<string, unknown>;
  proxyProviders: Record<string, unknown>;
  dns?: unknown;
  hosts: Record<string, unknown>;
  nodeCount: number;
  exitCount: number;
  ruleCount: number;
}

export interface DnsWarning {
  code: string;
  message: string;
  rule?: string;
}

export interface DnsPreview {
  enabled: boolean;
  yaml: string;
  warnings: DnsWarning[];
}

export type MatchType = 'exact' | 'suffix' | 'geosite' | 'rule-set';
export type ActionType = 'nameserver' | 'fixed-ip' | 'bypass-fake-ip' | 'block';

export interface DnsRuleDraft {
  id: string;
  enabled: boolean;
  matchType: MatchType;
  matchValue: string;
  actionType: ActionType;
  actionValue: string;
}

export interface DnsDraftSettings {
  enable: boolean;
  listen: string;
  enhancedMode: 'fake-ip' | 'redir-host';
  fakeIpRange: string;
  fakeIpFilter: string;
  nameserver: string;
  defaultNameserver: string;
  proxyServerNameserver: string;
  fallback: string;
  useHosts: boolean;
  useSystemHosts: boolean;
}

export interface DnsDraft {
  enabled: boolean;
  settings: DnsDraftSettings;
  rules: DnsRuleDraft[];
  rulesets: string;
}

export interface DnsRuleInput {
  id: string;
  match: { type: MatchType; value: string };
  action: Record<string, unknown>;
}

export interface DnsInput {
  enabled: boolean;
  settings: Record<string, unknown>;
  rules: DnsRuleInput[];
  hosts: Record<string, string | string[]>;
  'rule-sets': string[];
}

export interface ConfigValidation {
  ok: boolean;
  status?: number;
  timedOut: boolean;
  output: string;
}

export interface ConfigStatus {
  dataDir: string;
  workspacePath: string;
  configPath: string;
  coreDir: string;
  geodata: string[];
  hasWorkspace: boolean;
  nodeCount: number;
  exitCount: number;
  ruleCount: number;
  historyCount: number;
  configYaml?: string;
}

export interface DnsConfigPreview {
  enabled: boolean;
  yaml: string;
  warnings: DnsWarning[];
}

export interface ConfigApplyResult {
  ok: boolean;
  yaml: string;
  warnings: DnsWarning[];
  validation: ConfigValidation;
  snapshot?: string;
}
