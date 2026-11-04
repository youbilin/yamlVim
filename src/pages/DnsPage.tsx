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
  loadDnsDefault,
  saveDnsDefault,
} from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { toast } from '../store/toast';
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

const FAKE_IP_FILTER = [
  '*.lan',
  'stun.*.*.*',
  'stun.*.*',
  'time.windows.com',
  'time.nist.gov',
  'time.apple.com',
  'time.asia.apple.com',
  '*.ntp.org.cn',
  '*.openwrt.pool.ntp.org',
  'time1.cloud.tencent.com',
  'time.ustc.edu.cn',
  'pool.ntp.org',
  'ntp.ubuntu.com',
  'ntp.aliyun.com',
  'ntp1.aliyun.com',
  'ntp2.aliyun.com',
  'ntp3.aliyun.com',
  'ntp4.aliyun.com',
  'ntp5.aliyun.com',
  'ntp6.aliyun.com',
  'ntp7.aliyun.com',
  'time1.aliyun.com',
  'time2.aliyun.com',
  'time3.aliyun.com',
  'time4.aliyun.com',
  'time5.aliyun.com',
  'time6.aliyun.com',
  'time7.aliyun.com',
  '*.time.edu.cn',
  'time1.apple.com',
  'time2.apple.com',
  'time3.apple.com',
  'time4.apple.com',
  'time5.apple.com',
  'time6.apple.com',
  'time7.apple.com',
  'time1.google.com',
  'time2.google.com',
  'time3.google.com',
  'time4.google.com',
  'music.163.com',
  '*.music.163.com',
  '*.126.net',
  'musicapi.taihe.com',
  'music.taihe.com',
  'songsearch.kugou.com',
  'trackercdn.kugou.com',
  '*.kuwo.cn',
  'api-jooxtt.sanook.com',
  'api.joox.com',
  'joox.com',
  'y.qq.com',
  '*.y.qq.com',
  'streamoc.music.tc.qq.com',
  'mobileoc.music.tc.qq.com',
  'isure.stream.qqmusic.qq.com',
  'dl.stream.qqmusic.qq.com',
  'aqqmusic.tc.qq.com',
  'amobile.music.tc.qq.com',
  '*.xiami.com',
  '*.music.migu.cn',
  'music.migu.cn',
  '*.msftconnecttest.com',
  '*.msftncsi.com',
  'localhost.ptlogin2.qq.com',
  '*.*.*.srv.nintendo.net',
  '*.*.stun.playstation.net',
  'xbox.*.*.microsoft.com',
  '*.ipv6.microsoft.com',
  '*.*.xboxlive.com',
  'speedtest.cros.wr.pvp.net',
].join('\n');

const NAMESERVER = [
  '180.76.76.76',
  '119.29.29.29',
  '180.184.1.1',
  '223.5.5.5',
  '8.8.8.8',
  'https://223.6.6.6/dns-query#h3=true',
  'https://dns.alidns.com/dns-query',
  'https://cloudflare-dns.com/dns-query',
  'https://doh.pub/dns-query',
].join('\n');

const DEFAULT_NAMESERVER = ['180.76.76.76', '182.254.118.118', '8.8.8.8', '180.184.2.2'].join(
  '\n',
);

const FALLBACK = [
  'https://000000.dns.nextdns.io/dns-query#h3=true',
  'https://dns.alidns.com/dns-query',
  'https://doh.pub/dns-query',
  'https://public.dns.iij.jp/dns-query',
  'https://101.101.101.101/dns-query',
  'https://208.67.220.220/dns-query',
  'tls://8.8.4.4',
  'tls://1.0.0.1:853',
  'https://cloudflare-dns.com/dns-query',
  'https://dns.google/dns-query',
].join('\n');

const DEFAULT_DRAFT: DnsDraft = {
  enabled: true,
  settings: {
    enable: true,
    listen: '127.0.0.1:5335',
    enhancedMode: 'fake-ip',
    fakeIpRange: '198.18.0.1/16',
    fakeIpFilter: FAKE_IP_FILTER,
    nameserver: NAMESERVER,
    defaultNameserver: DEFAULT_NAMESERVER,
    proxyServerNameserver: '',
    fallback: FALLBACK,
    useHosts: true,
    useSystemHosts: false,
  },
  rules: [
    {
      id: 'rule-wbu',
      enabled: true,
      matchType: 'suffix',
      matchValue: 'wbu.edu.cn',
      actionType: 'nameserver',
      actionValue: '218.199.208.8',
    },
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

function applyFailedMessage(result: ConfigApplyResult): string {
  const firstLine =
    result.validation.output.split('\n').find((line) => line.trim()) ?? '';
  return firstLine ? `mihomo -t 校验未通过：${firstLine}` : 'mihomo -t 校验未通过';
}

function appliedLabel(result: ConfigApplyResult, prefix: string): string {
  return result.validation.output.includes('跳过')
    ? `${prefix}（未找到内核，跳过 mihomo -t 校验）`
    : `${prefix}`;
}

export function DnsPage() {
  const [draft, setDraft] = useState<DnsDraft>(DEFAULT_DRAFT);
  const [applying, setApplying] = useState(false);
  const [dnsYaml, setDnsYaml] = useState('');
  const [rawOpen, setRawOpen] = useState(false);
  const [rawBusy, setRawBusy] = useState(false);
  const [defaultBusy, setDefaultBusy] = useState(false);
  const [queryName, setQueryName] = useState('');
  const [queryType, setQueryType] = useState('A');
  const [queryResult, setQueryResult] = useState('');
  const [queryBusy, setQueryBusy] = useState(false);
  const [flushOpen, setFlushOpen] = useState(false);
  const browser = !isTauriRuntime();

  const loadDnsYaml = async () => {
    try {
      setDnsYaml(await getDnsYaml());
    } catch (reason) {
      toast.error(errorMessage(reason));
    }
  };

  useEffect(() => {
    void loadDnsYaml();
  }, []);

  const saveDefault = async () => {
    if (!dnsYaml.trim()) {
      toast.error('DNS YAML 为空');
      return;
    }
    setDefaultBusy(true);
    try {
      await saveDnsDefault(dnsYaml);
      toast.success('默认 DNS 已保存');
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setDefaultBusy(false);
    }
  };

  const applyDefault = async () => {
    setDefaultBusy(true);
    try {
      const yaml = await loadDnsDefault();
      if (!yaml) {
        toast.error('还没有保存默认 DNS');
        return;
      }
      const result = await applyDnsYaml(yaml);
      if (result.ok) {
        toast.success(appliedLabel(result, '默认 DNS 已应用'));
        await useWorkspaceData.getState().load();
        await loadDnsYaml();
      } else {
        toast.error(applyFailedMessage(result));
      }
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setDefaultBusy(false);
    }
  };

  const handleApplyYaml = async () => {
    setRawBusy(true);
    try {
      const result = await applyDnsYaml(dnsYaml);
      if (result.ok) {
        toast.success(appliedLabel(result, 'DNS YAML 已应用'));
        await useWorkspaceData.getState().load();
        await loadDnsYaml();
      } else {
        toast.error(applyFailedMessage(result));
      }
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setRawBusy(false);
    }
  };

  const runQuery = async () => {
    setQueryBusy(true);
    setQueryResult('');
    try {
      const raw = await controllerDnsQuery(queryName.trim(), queryType);
      try {
        setQueryResult(JSON.stringify(JSON.parse(raw), null, 2));
      } catch {
        setQueryResult(raw);
      }
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setQueryBusy(false);
    }
  };

  const flushCache = async () => {
    try {
      toast.success(await controllerFlushDns());
      setFlushOpen(false);
    } catch (reason) {
      toast.error(errorMessage(reason));
      setFlushOpen(false);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    try {
      const result = await applyDnsConfig(toDnsInput(draft));
      if (result.ok) {
        toast.success(appliedLabel(result, 'DNS 覆写已应用'));
        await useWorkspaceData.getState().load();
        await loadDnsYaml();
      } else {
        toast.error(applyFailedMessage(result));
      }
    } catch (reason) {
      toast.error(errorMessage(reason));
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
          </div>
          <div className="inline-actions">
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => void saveDefault()}
              disabled={defaultBusy || browser}
            >
              保存为默认
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => void applyDefault()}
              disabled={defaultBusy || browser}
            >
              应用默认
            </button>
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
                <h2 className="card-title">域名解析策略</h2>
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
