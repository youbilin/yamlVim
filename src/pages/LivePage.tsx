import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Check, Copy, Search, Unplug } from 'lucide-react';

import { errorMessage } from '../api';
import { SideSheet } from '../components/SideSheet';
import { Select } from '../components/Select';
import { useApp } from '../store/app';
import { useLive, type LiveConnection } from '../store/live';
import { toast } from '../store/toast';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatRate(bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) return '0 B/s';
  return `${formatBytes(bytesPerSecond)}/s`;
}

function formatTime(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleTimeString() : value;
}

function connectionText(connection: LiveConnection): string {
  const meta = connection.metadata ?? {};
  return [
    meta.host,
    meta.destinationIP,
    meta.destinationPort,
    meta.process,
    meta.processPath,
    connection.rule,
    connection.rulePayload,
    ...connection.chains,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

type SortMode = 'rate' | 'traffic' | 'name';

const SORT_OPTIONS = [
  { value: 'rate', label: '活动速率' },
  { value: 'traffic', label: '累计流量' },
  { value: 'name', label: '域名' },
];

export function LivePage() {
  const endpoint = useApp((state) => state.settings.controllerEndpoint);
  const connections = useLive((state) => state.connections);
  const groups = useLive((state) => state.groups);
  const attached = useLive((state) => state.attached);
  const connectionError = useLive((state) => state.error);
  const rates = useLive((state) => state.rates);
  const upRate = useLive((state) => state.upRate);
  const downRate = useLive((state) => state.downRate);
  const poll = useLive((state) => state.poll);
  const switchGroup = useLive((state) => state.switchGroup);
  const closeConnection = useLive((state) => state.closeConnection);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('rate');
  const [activeOnly, setActiveOnly] = useState(false);

  const refresh = useCallback(async () => {
    await poll();
  }, [poll]);

  useEffect(() => {
    if (!endpoint.trim()) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1_000);
    return () => window.clearInterval(timer);
  }, [refresh, endpoint]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const list = connections.filter((connection) => {
      if (keyword && !connectionText(connection).includes(keyword)) return false;
      if (activeOnly) {
        const rate = rates[connection.id];
        if (!rate || (rate.up === 0 && rate.down === 0)) return false;
      }
      return true;
    });
    const rateOf = (connection: LiveConnection) => {
      const rate = rates[connection.id];
      return rate ? rate.up + rate.down : 0;
    };
    return [...list].sort((left, right) => {
      if (sortMode === 'rate') {
        return (
          rateOf(right) - rateOf(left) ||
          right.download + right.upload - (left.download + left.upload)
        );
      }
      if (sortMode === 'traffic') {
        return right.download + right.upload - (left.download + left.upload);
      }
      const hostOf = (connection: LiveConnection) =>
        (connection.metadata?.host ?? connection.id).toLowerCase();
      return hostOf(left).localeCompare(hostOf(right));
    });
  }, [connections, rates, query, sortMode, activeOnly]);

  const selected = connections.find((connection) => connection.id === selectedId) ?? null;
  const chainGroup = selected
    ? ([...selected.chains]
        .reverse()
        .find((name) => groups.some((group) => group.name === name)) ?? null)
    : null;
  const currentGroup = chainGroup
    ? (groups.find((group) => group.name === chainGroup) ?? null)
    : null;
  const selectedRate = selected ? rates[selected.id] : undefined;

  const handleClose = async () => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await closeConnection(selected.id);
      toast.success('连接已断开');
      setSelectedId('');
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const handleSwitch = async (group: string, name: string) => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await switchGroup(group, name);
      await closeConnection(selected.id);
      toast.success(`已切换 ${group} → ${name}，连接将按新出口重连`);
      setSelectedId('');
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const copyHost = async () => {
    if (!selected) return;
    const host = selected.metadata?.host;
    if (!host) return;
    try {
      await navigator.clipboard.writeText(host);
      toast.success('域名已复制');
    } catch {
      toast.error('复制失败');
    }
  };

  return (
    <section className="page">
      <div className="card">
        <div className="card-head">
          <div className="card-title-row">
            <span className={`chip ${attached ? 'chip-managed' : 'chip-muted'}`}>
              {attached ? `${connections.length} 条连接` : '未连接控制器'}
            </span>
            <span className="chip chip-muted">
              ↑ {formatRate(upRate)} · ↓ {formatRate(downRate)}
            </span>
          </div>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => void refresh()}
            disabled={busy || !endpoint.trim()}
          >
            <Activity size={15} />
            刷新
          </button>
        </div>

        <div className="inline-actions" style={{ marginBottom: 12 }}>
          <div className="inline-form grow" style={{ display: 'flex', flex: 1 }}>
            <Search size={14} style={{ alignSelf: 'center', marginRight: 6, flexShrink: 0 }} />
            <input
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索域名、IP、规则、进程或出口"
              aria-label="搜索连接"
              spellCheck={false}
            />
          </div>
          <label className="check" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(event) => setActiveOnly(event.target.checked)}
            />
            仅活动
          </label>
          <Select
            value={sortMode}
            options={SORT_OPTIONS}
            onChange={(value) => setSortMode(value as SortMode)}
            ariaLabel="排序方式"
          />
        </div>

        {connections.length ? (
          <>
            <div className="data-list">
              {filtered.slice(0, 200).map((connection) => {
                const meta = connection.metadata ?? {};
                const rate = rates[connection.id];
                return (
                  <button
                    type="button"
                    className={`data-row connection-row ${connection.id === selectedId ? 'selected' : ''}`}
                    key={connection.id}
                    onClick={() => setSelectedId(connection.id)}
                  >
                    <div className="data-main">
                      <strong>{meta.host || meta.destinationIP || 'unknown'}</strong>
                      <span>
                        {[meta.network, connection.rule, ...connection.chains]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                    <div className="data-main data-numbers">
                      <span>↑ {formatRate(rate?.up ?? 0)}</span>
                      <span>↓ {formatRate(rate?.down ?? 0)}</span>
                    </div>
                    <div className="data-main data-numbers">
                      <span>{formatBytes(connection.upload)}</span>
                      <span>{formatBytes(connection.download)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
            {filtered.length === 0 ? (
              <div className="empty">
                <strong>没有匹配的连接</strong>
                <span>试试清除搜索关键词或取消「仅活动」。</span>
              </div>
            ) : null}
          </>
        ) : (
          <div className="empty">
            <strong>{attached ? '暂无活动连接' : '未连接控制器'}</strong>
            <span>
              {attached
                ? '访问网络后，活动连接会显示在这里。'
                : (connectionError ?? '在右上角内核面板中填写控制器地址和密钥后保存。')}
            </span>
          </div>
        )}
      </div>

      {selected ? (
        <SideSheet title="连接详情" onClose={() => { if (!busy) setSelectedId(''); }}>
          <div className="sheet-section">
            <div className="meta-list">
              <div>
                <span>域名</span>
                <code>{selected.metadata?.host || 'unknown'}</code>
              </div>
              <div>
                <span>网络 / 端口</span>
                <code>
                  {[selected.metadata?.network, selected.metadata?.destinationPort]
                    .filter(Boolean)
                    .join(' : ') || '—'}
                </code>
              </div>
              <div>
                <span>目标 IP</span>
                <code>{selected.metadata?.destinationIP || '—'}</code>
              </div>
              <div>
                <span>来源</span>
                <code>
                  {[selected.metadata?.sourceIP, selected.metadata?.sourcePort]
                    .filter(Boolean)
                    .join(':') || '—'}
                </code>
              </div>
              <div>
                <span>命中规则</span>
                <code>{[selected.rule, selected.rulePayload].filter(Boolean).join(' ') || '—'}</code>
              </div>
              <div>
                <span>链路</span>
                <code>{selected.chains.join(' → ') || '直连'}</code>
              </div>
              <div>
                <span>进程</span>
                <code>{selected.metadata?.process || selected.metadata?.processPath || '—'}</code>
              </div>
              <div>
                <span>开始时间</span>
                <code>{formatTime(selected.start)}</code>
              </div>
            </div>
            <p className="hint">
              ↑ {formatRate(selectedRate?.up ?? 0)} · ↓ {formatRate(selectedRate?.down ?? 0)} ·
              累计 ↑ {formatBytes(selected.upload)} · ↓ {formatBytes(selected.download)}
            </p>
            <div className="inline-actions">
              {selected.metadata?.host ? (
                <button className="btn btn-ghost" type="button" onClick={() => void copyHost()}>
                  <Copy size={14} />
                  复制域名
                </button>
              ) : null}
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => void handleClose()}
                disabled={busy}
              >
                <Unplug size={14} />
                断开连接
              </button>
            </div>
          </div>

          <div className="sheet-section">
            <div className="card-title-row">
              <h2 className="card-title">修改出口</h2>
            </div>
            {currentGroup ? (
              <>
                <span className="hint">
                  切换 {currentGroup.name} 的指向并断开此连接，重连后走新出口；同组其他连接也会受影响。
                </span>
                <div className="preset-list">
                  {currentGroup.all.map((name) => {
                    const isGroup = groups.some((group) => group.name === name);
                    const active = currentGroup.now === name;
                    return (
                      <button
                        key={name}
                        type="button"
                        className={active ? 'preset-row selected' : 'preset-row'}
                        onClick={() => void handleSwitch(currentGroup.name, name)}
                        disabled={busy}
                      >
                        <span className="preset-check">{active ? <Check size={12} /> : null}</span>
                        <span className="preset-main">
                          <strong>{name}</strong>
                        </span>
                        <span className="chip chip-muted">{isGroup ? '策略组' : '节点'}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <span className="hint">
                该连接不经过可切换的策略组，无法直接改出口；可在规则页为该域名添加规则。
              </span>
            )}
          </div>
        </SideSheet>
      ) : null}
    </section>
  );
}
