import { useCallback, useEffect, useState } from 'react';
import { Activity, Check, Unplug } from 'lucide-react';

import { errorMessage } from '../api';
import { SideSheet } from '../components/SideSheet';
import { useApp } from '../store/app';
import { useLive } from '../store/live';
import { toast } from '../store/toast';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleTimeString() : value;
}

export function LivePage() {
  const endpoint = useApp((state) => state.settings.controllerEndpoint);
  const connections = useLive((state) => state.connections);
  const groups = useLive((state) => state.groups);
  const attached = useLive((state) => state.attached);
  const connectionError = useLive((state) => state.error);
  const poll = useLive((state) => state.poll);
  const switchGroup = useLive((state) => state.switchGroup);
  const closeConnection = useLive((state) => state.closeConnection);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    await poll();
  }, [poll]);

  useEffect(() => {
    if (!endpoint.trim()) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [refresh, endpoint]);

  const selected = connections.find((connection) => connection.id === selectedId) ?? null;
  const chainGroup = selected
    ? ([...selected.chains]
        .reverse()
        .find((name) => groups.some((group) => group.name === name)) ?? null)
    : null;
  const currentGroup = chainGroup
    ? (groups.find((group) => group.name === chainGroup) ?? null)
    : null;

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

  return (
    <section className="page">
      <div className="card">
        <div className="card-head">
          <div className="card-title-row">
            <span className={`chip ${attached ? 'chip-managed' : 'chip-muted'}`}>
              {attached ? `${connections.length} 条连接` : '未连接控制器'}
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

        {connections.length ? (
          <div className="data-list">
            {connections.slice(0, 80).map((connection) => {
              const meta = connection.metadata ?? {};
              return (
                <button
                  type="button"
                  className={`data-row connection-row ${connection.id === selectedId ? 'selected' : ''}`}
                  key={connection.id}
                  onClick={() => setSelectedId(connection.id)}
                >
                  <div className="data-main">
                    <strong>{meta.host || meta.destinationPort || 'unknown'}</strong>
                    <span>{[meta.network, ...connection.chains].filter(Boolean).join(' → ')}</span>
                  </div>
                  <div className="data-main data-numbers">
                    <span>↑ {formatBytes(connection.upload)}</span>
                    <span>↓ {formatBytes(connection.download)}</span>
                  </div>
                </button>
              );
            })}
          </div>
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
                <span>命中规则</span>
                <code>{[selected.rule, selected.rulePayload].filter(Boolean).join(' ') || '—'}</code>
              </div>
              <div>
                <span>链路</span>
                <code>{selected.chains.join(' → ') || '直连'}</code>
              </div>
              <div>
                <span>流量</span>
                <code>
                  ↑ {formatBytes(selected.upload)} · ↓ {formatBytes(selected.download)}
                </code>
              </div>
              <div>
                <span>开始时间</span>
                <code>{formatTime(selected.start)}</code>
              </div>
            </div>
            <div className="inline-actions">
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
