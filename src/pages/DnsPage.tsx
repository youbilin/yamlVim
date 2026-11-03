import { useEffect, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';

import {
  applyDnsConfig,
  applyDnsYaml,
  controllerDnsQuery,
  controllerFlushDns,
  errorMessage,
  getDnsYaml,
  isTauriRuntime,
} from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Select } from '../components/Select';
import { toDnsInput } from '../lib/dns';
import { useWorkspaceData } from '../store/workspace';
import type {
  ActionType,
  ConfigApplyResult,
  DnsDraft,
  DnsDraftSettings,
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
  const [applyResult, setApplyResult] = useState<ConfigApplyResult | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');
  const [dnsYaml, setDnsYaml] = useState('');
  const [rawOpen, setRawOpen] = useState(false);
  const [rawBusy, setRawBusy] = useState(false);
  const [rawError, setRawError] = useState('');
  const [rawMessage, setRawMessage] = useState('');
  const [queryName, setQueryName] = useState('');
  const [queryType, setQueryType] = useState('A');
  const [queryResult, setQueryResult] = useState('');
  const [queryError, setQueryError] = useState('');
  const [queryBusy, setQueryBusy] = useState(false);
  const [flushMessage, setFlushMessage] = useState('');
  const [flushOpen, setFlushOpen] = useState(false);
  const browser = !isTauriRuntime();

  const loadDnsYaml = async () => {
    try {
      setDnsYaml(await getDnsYaml());
    } catch (reason) {
      setRawError(errorMessage(reason));
    }
  };

  useEffect(() => {
    void loadDnsYaml();
  }, []);

  const handleApplyYaml = async () => {
    setRawBusy(true);
    setRawError('');
    setRawMessage('');
    try {
      const result = await applyDnsYaml(dnsYaml);
      if (result.ok) {
        setRawMessage('DNS YAML 已应用到 workspace');
        await useWorkspaceData.getState().load();
        await loadDnsYaml();
      } else {
        setRawError(`mihomo -t 校验未通过：${result.validation.output}`);
      }
    } catch (reason) {
      setRawError(errorMessage(reason));
    } finally {
      setRawBusy(false);
    }
  };

  const runQuery = async () => {
    setQueryBusy(true);
    setQueryError('');
    setQueryResult('');
    try {
      const raw = await controllerDnsQuery(queryName.trim(), queryType);
      try {
        setQueryResult(JSON.stringify(JSON.parse(raw), null, 2));
      } catch {
        setQueryResult(raw);
      }
    } catch (reason) {
      setQueryError(errorMessage(reason));
    } finally {
      setQueryBusy(false);
    }
  };

  const flushCache = async () => {
    try {
      setFlushMessage(await controllerFlushDns());
      setFlushOpen(false);
    } catch (reason) {
      setQueryError(errorMessage(reason));
      setFlushOpen(false);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    setApplyError('');
    setApplyResult(null);
    try {
      const result = await applyDnsConfig(toDnsInput(draft));
      setApplyResult(result);
      if (result.ok) {
        await useWorkspaceData.getState().load();
        await loadDnsYaml();
      } else {
        setApplyError('mihomo -t 校验未通过，配置未写入。');
      }
    } catch (reason) {
      setApplyError(errorMessage(reason));
    } finally {
      setApplying(false);
    }
  };

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
      <div className="card">
        <div className="card-head">
          <div className="card-title-row">
            <h2 className="card-title">DNS YAML</h2>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => setRawOpen((current) => !current)}
            >
              {rawOpen ? '收起' : '展开编辑'}
            </button>
          </div>
        </div>
        {rawOpen ? (
          <>
            <label className="field">
              <span>直接编辑 dns / hosts</span>
              <textarea
                className="textarea mono export-editor"
                value={dnsYaml}
                onChange={(event) => setDnsYaml(event.target.value)}
                rows={14}
                spellCheck={false}
              />
            </label>
            {rawMessage ? <p className="notice notice-ok">{rawMessage}</p> : null}
            {rawError ? <p className="notice notice-warn">{rawError}</p> : null}
            <div className="inline-actions">
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => void loadDnsYaml()}
                disabled={rawBusy}
              >
                载入当前
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => void handleApplyYaml()}
                disabled={rawBusy || !dnsYaml.trim() || browser}
              >
                应用 YAML
              </button>
            </div>
          </>
        ) : null}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title-row">
            <h2 className="card-title">DNS 查询</h2>
            <span className="chip chip-muted">controller</span>
          </div>
        </div>
        <div className="dns-query-form">
          <label className="field grow">
            <span>域名</span>
            <input
              className="input mono"
              value={queryName}
              onChange={(event) => setQueryName(event.target.value)}
              placeholder="example.com"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>类型</span>
            <Select
              value={queryType}
              options={['A', 'AAAA', 'CNAME', 'TXT'].map((value) => ({ value, label: value }))}
              onChange={setQueryType}
              ariaLabel="DNS 查询类型"
            />
          </label>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => void runQuery()}
            disabled={queryBusy || browser || !queryName.trim()}
          >
            <Search size={15} />
            查询
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => setFlushOpen(true)}
            disabled={browser}
          >
            清空缓存
          </button>
        </div>
        {queryError ? <p className="notice notice-warn">{queryError}</p> : null}
        {flushMessage ? <p className="notice notice-ok">{flushMessage}</p> : null}
        {queryResult ? <pre className="code-block output-block">{queryResult}</pre> : null}
      </div>

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
              </span>
            </label>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h2 className="card-title">基础设置</h2>
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
                <Select
                  value={draft.settings.enhancedMode}
                  options={[
                    { value: 'fake-ip', label: 'fake-ip' },
                    { value: 'redir-host', label: 'redir-host' },
                  ]}
                  onChange={(value) =>
                    updateSettings({ enhancedMode: value as DnsDraftSettings['enhancedMode'] })
                  }
                  ariaLabel="增强模式"
                />
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
                  <Select
                    value={rule.matchType}
                    options={matchOptions}
                    onChange={(value) =>
                      updateRule(rule.id, { matchType: value as MatchType })
                    }
                    ariaLabel="匹配方式"
                  />
                  <input
                    className="input mono"
                    value={rule.matchValue}
                    onChange={(event) => updateRule(rule.id, { matchValue: event.target.value })}
                    placeholder="example.com"
                  />
                  <Select
                    value={rule.actionType}
                    options={actionOptions}
                    onChange={(value) =>
                      updateRule(rule.id, { actionType: value as ActionType })
                    }
                    ariaLabel="动作类型"
                  />
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

        <div className="card">
          <div className="card-head">
            <div className="card-title-row">
              <h2 className="card-title">应用</h2>
              <span className="chip chip-muted">{applying ? 'applying' : 'safe mode'}</span>
            </div>
          </div>
          <div className="inline-actions">
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => void handleApply()}
              disabled={applying}
            >
              {applying ? '应用中…' : '应用 DNS 覆写'}
            </button>
          </div>
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
      </div>
      {flushOpen ? (
        <ConfirmDialog
          title="清空 DNS 缓存"
          message="确定清空运行中 mihomo 的 DNS 缓存？"
          confirmLabel="清空"
          onConfirm={flushCache}
          onClose={() => setFlushOpen(false)}
        />
      ) : null}
    </section>
  );
}
