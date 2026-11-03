import { useEffect, useState } from 'react';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';

import {
  applyDnsConfig,
  compileDnsPreview,
  errorMessage,
  isTauriRuntime,
  previewDnsConfig,
} from '../api';
import { toDnsInput } from '../lib/dns';
import { useWorkspaceData } from '../store/workspace';
import type {
  ActionType,
  ConfigApplyResult,
  DnsConfigPreview,
  DnsDraft,
  DnsDraftSettings,
  DnsPreview,
  DnsRuleDraft,
  MatchType,
} from '../types';

const DEFAULT_DRAFT: DnsDraft = {
  enabled: true,
  settings: {
    enable: true,
    listen: '127.0.0.1:1053',
    enhancedMode: 'fake-ip',
    fakeIpRange: '198.18.0.1/16',
    fakeIpFilter: '*.lan\n+.local',
    nameserver: 'https://doh.pub/dns-query\ntls://dns.alidns.com',
    defaultNameserver: '223.5.5.5\n119.29.29.29',
    proxyServerNameserver: 'https://doh.pub/dns-query',
    fallback: 'tls://8.8.4.4',
    useHosts: true,
    useSystemHosts: true,
  },
  rules: [
    {
      id: 'rule-openai',
      enabled: true,
      matchType: 'suffix',
      matchValue: 'openai.com',
      actionType: 'nameserver',
      actionValue: 'https://dns.google/dns-query',
    },
    {
      id: 'rule-pin',
      enabled: true,
      matchType: 'exact',
      matchValue: 'example.com',
      actionType: 'fixed-ip',
      actionValue: '93.184.216.34',
    },
    {
      id: 'rule-ads',
      enabled: true,
      matchType: 'geosite',
      matchValue: 'category-ads-all',
      actionType: 'block',
      actionValue: '',
    },
    {
      id: 'rule-lan',
      enabled: true,
      matchType: 'suffix',
      matchValue: 'lan',
      actionType: 'bypass-fake-ip',
      actionValue: '',
    },
  ],
  rulesets: '',
};

const matchOptions: Array<{ value: MatchType; label: string }> = [
  { value: 'exact', label: '精确域名' },
  { value: 'suffix', label: '域名后缀' },
  { value: 'geosite', label: 'geosite' },
  { value: 'rule-set', label: 'rule-set' },
];

const actionOptions: Array<{ value: ActionType; label: string }> = [
  { value: 'nameserver', label: '指定上游' },
  { value: 'fixed-ip', label: '固定 IP' },
  { value: 'bypass-fake-ip', label: '绕过 fake-IP' },
  { value: 'block', label: '拦截' },
];

function needsValue(action: ActionType): boolean {
  return action === 'nameserver' || action === 'fixed-ip';
}

export function DnsPage() {
  const [draft, setDraft] = useState<DnsDraft>(DEFAULT_DRAFT);
  const [preview, setPreview] = useState<DnsPreview | null>(null);
  const [fullPreview, setFullPreview] = useState<DnsConfigPreview | null>(null);
  const [applyResult, setApplyResult] = useState<ConfigApplyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [applyError, setApplyError] = useState('');
  const browser = !isTauriRuntime();

  const runPreview = async (next: DnsDraft = draft) => {
    setBusy(true);
    setError('');
    setFullPreview(null);
    setApplyResult(null);
    setApplyError('');
    try {
      setPreview(await compileDnsPreview(toDnsInput(next)));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const runFullPreview = async () => {
    setBusy(true);
    setError('');
    setApplyResult(null);
    setApplyError('');
    try {
      setFullPreview(await previewDnsConfig(toDnsInput(draft)));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    setApplyError('');
    setApplyResult(null);
    setFullPreview(null);
    try {
      const result = await applyDnsConfig(toDnsInput(draft));
      setApplyResult(result);
      if (result.ok) {
        setFullPreview({
          enabled: true,
          yaml: result.yaml,
          warnings: result.warnings,
        });
        void useWorkspaceData.getState().load();
      } else {
        setApplyError('mihomo -t 校验未通过，配置未写入。');
      }
    } catch (reason) {
      setApplyError(errorMessage(reason));
    } finally {
      setApplying(false);
    }
  };

  const activeYaml =
    fullPreview?.yaml ?? preview?.yaml ?? '点击“编译预览”生成 YAML';
  const activeWarnings = fullPreview?.warnings ?? preview?.warnings ?? [];

  useEffect(() => {
    void runPreview(DEFAULT_DRAFT);
    // Only compile the initial draft once; later changes use the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSettings = (patch: Partial<DnsDraftSettings>) => {
    setDraft((current) => ({
      ...current,
      settings: { ...current.settings, ...patch },
    }));
  };

  const updateRule = (id: string, patch: Partial<DnsRuleDraft>) => {
    setDraft((current) => ({
      ...current,
      rules: current.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    }));
  };

  const addRule = () => {
    setDraft((current) => ({
      ...current,
      rules: [
        ...current.rules,
        {
          id: `rule-${Date.now()}`,
          enabled: true,
          matchType: 'suffix',
          matchValue: '',
          actionType: 'nameserver',
          actionValue: '',
        },
      ],
    }));
  };

  const removeRule = (id: string) => {
    setDraft((current) => ({
      ...current,
      rules: current.rules.filter((rule) => rule.id !== id),
    }));
  };

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">DNS OVERRIDE</p>
          <h1>DNS 覆写</h1>
          <p className="lead">
            替换完整 dns 配置，或按域名指定上游、固定 IP、绕过 fake-IP 与拦截。预览由真实
            Rust 编译器生成。
          </p>
        </div>
        <span className="chip chip-muted">{browser ? 'browser preview' : 'rust compiler'}</span>
      </header>

      <div className="dns-layout">
        <div className="stack">
          <div className="card">
            <label className="switch-row">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, enabled: event.target.checked }))
                }
              />
              <span>
                <strong>启用 DNS 覆写</strong>
                <small>关闭时保留导入配置里的基础 dns 块，不生成替换块。</small>
              </span>
            </label>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h2 className="card-title">基础设置</h2>
                <p className="card-sub">对应 mihomo dns 块的全局字段。</p>
              </div>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>监听地址</span>
                <input
                  className="input mono"
                  value={draft.settings.listen}
                  onChange={(event) => updateSettings({ listen: event.target.value })}
                  placeholder="127.0.0.1:1053"
                />
              </label>
              <label className="field">
                <span>增强模式</span>
                <select
                  className="select"
                  value={draft.settings.enhancedMode}
                  onChange={(event) =>
                    updateSettings({
                      enhancedMode: event.target.value as DnsDraftSettings['enhancedMode'],
                    })
                  }
                >
                  <option value="fake-ip">fake-ip</option>
                  <option value="redir-host">redir-host</option>
                </select>
              </label>
              <label className="field">
                <span>fake-IP 网段</span>
                <input
                  className="input mono"
                  value={draft.settings.fakeIpRange}
                  onChange={(event) => updateSettings({ fakeIpRange: event.target.value })}
                  placeholder="198.18.0.1/16"
                />
              </label>
              <label className="field">
                <span>fake-IP 过滤</span>
                <textarea
                  className="textarea mono"
                  value={draft.settings.fakeIpFilter}
                  onChange={(event) => updateSettings({ fakeIpFilter: event.target.value })}
                  rows={3}
                  placeholder="每行一个，例如 *.lan"
                />
              </label>
            </div>
            <div className="check-row">
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.settings.useHosts}
                  onChange={(event) => updateSettings({ useHosts: event.target.checked })}
                />
                use-hosts
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.settings.useSystemHosts}
                  onChange={(event) =>
                    updateSettings({ useSystemHosts: event.target.checked })
                  }
                />
                use-system-hosts
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.settings.enable}
                  onChange={(event) => updateSettings({ enable: event.target.checked })}
                />
                dns.enable
              </label>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h2 className="card-title">上游</h2>
                <p className="card-sub">每行一个；支持 system、udp/tcp/tls/https/quic。</p>
              </div>
            </div>
            <div className="form-grid two">
              <label className="field">
                <span>nameserver</span>
                <textarea
                  className="textarea mono"
                  rows={4}
                  value={draft.settings.nameserver}
                  onChange={(event) => updateSettings({ nameserver: event.target.value })}
                />
              </label>
              <label className="field">
                <span>default-nameserver</span>
                <textarea
                  className="textarea mono"
                  rows={4}
                  value={draft.settings.defaultNameserver}
                  onChange={(event) =>
                    updateSettings({ defaultNameserver: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>proxy-server-nameserver</span>
                <textarea
                  className="textarea mono"
                  rows={3}
                  value={draft.settings.proxyServerNameserver}
                  onChange={(event) =>
                    updateSettings({ proxyServerNameserver: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>fallback</span>
                <textarea
                  className="textarea mono"
                  rows={3}
                  value={draft.settings.fallback}
                  onChange={(event) => updateSettings({ fallback: event.target.value })}
                />
              </label>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h2 className="card-title">覆写规则</h2>
                <p className="card-sub">按顺序解析；重复或重叠会在预览里提示。</p>
              </div>
              <button className="btn btn-ghost" type="button" onClick={addRule}>
                <Plus size={15} />
                添加规则
              </button>
            </div>

            <div className="rule-list">
              {draft.rules.map((rule) => (
                <div className="rule-row" key={rule.id}>
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(event) => updateRule(rule.id, { enabled: event.target.checked })}
                    aria-label="启用规则"
                  />
                  <select
                    className="select"
                    value={rule.matchType}
                    onChange={(event) =>
                      updateRule(rule.id, { matchType: event.target.value as MatchType })
                    }
                  >
                    {matchOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input mono"
                    value={rule.matchValue}
                    onChange={(event) => updateRule(rule.id, { matchValue: event.target.value })}
                    placeholder="example.com"
                  />
                  <select
                    className="select"
                    value={rule.actionType}
                    onChange={(event) =>
                      updateRule(rule.id, { actionType: event.target.value as ActionType })
                    }
                  >
                    {actionOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input mono"
                    value={rule.actionValue}
                    onChange={(event) =>
                      updateRule(rule.id, { actionValue: event.target.value })
                    }
                    placeholder={needsValue(rule.actionType) ? '上游或 IP' : '无需填写'}
                    disabled={!needsValue(rule.actionType)}
                  />
                  <button
                    className="btn btn-icon"
                    type="button"
                    onClick={() => removeRule(rule.id)}
                    aria-label="删除规则"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>

            <label className="field">
              <span>rule-sets（逗号或换行分隔）</span>
              <input
                className="input mono"
                value={draft.rulesets}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, rulesets: event.target.value }))
                }
                placeholder="private, cn"
              />
            </label>
          </div>
        </div>

        <aside className="stack">
          <div className="card preview-card">
            <div className="card-head">
              <div>
                <h2 className="card-title">YAML 预览</h2>
                <p className="card-sub">
                  {fullPreview
                    ? '基于当前 workspace 生成的完整配置。'
                    : 'dns 与 hosts 片段；不写入内核。'}
                </p>
              </div>
              <div className="preview-actions">
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => void runPreview()}
                  disabled={busy || applying}
                >
                  <RefreshCw size={15} className={busy ? 'spin' : undefined} />
                  片段
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => void runFullPreview()}
                  disabled={busy || applying}
                >
                  完整配置
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => void handleApply()}
                  disabled={busy || applying}
                >
                  {applying ? '应用中…' : '应用'}
                </button>
              </div>
            </div>

            {error ? <p className="notice notice-warn">{error}</p> : null}
            {applyError ? <p className="notice notice-warn">{applyError}</p> : null}
            {applyResult ? (
              <div className={applyResult.ok ? 'notice notice-ok' : 'notice notice-warn'}>
                <strong>
                  {applyResult.ok
                    ? browser
                      ? '浏览器预览：未写入磁盘'
                      : '已更新 workspace 并生成 config.yaml'
                    : '校验未通过，未写入'}
                </strong>
                {applyResult.snapshot ? (
                  <span className="mono break">历史快照：{applyResult.snapshot}</span>
                ) : null}
                <details>
                  <summary>mihomo -t 输出</summary>
                  <pre className="code-block output-block">{applyResult.validation.output}</pre>
                </details>
              </div>
            ) : null}
            {(fullPreview && !fullPreview.enabled) || (preview && !preview.enabled) ? (
              <p className="notice notice-info">覆写已关闭：基础 DNS 将保持不变。</p>
            ) : null}
            {activeWarnings.length ? (
              <ul className="warnings">
                {activeWarnings.map((warning) => (
                  <li key={`${warning.code}-${warning.message}`}>
                    <strong>{warning.code}</strong>
                    <span>{warning.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            <pre className="code-block preview-code">{activeYaml}</pre>
            <p className="hint">
              片段预览只显示 DNS 编译结果；“完整配置”和“应用”会基于当前 workspace
              生成完整 YAML 并调用 mihomo -t。浏览器模式展示的是模拟结果。
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
