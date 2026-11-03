import { useCallback, useEffect, useState } from 'react';
import { Activity, Gauge } from 'lucide-react';

import { errorMessage } from '../api';
import { Select } from '../components/Select';
import { useApp } from '../store/app';
import { useLive } from '../store/live';
import { toast } from '../store/toast';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function LivePage() {
  const endpoint = useApp((state) => state.settings.controllerEndpoint);
  const connections = useLive((state) => state.connections);
  const groups = useLive((state) => state.groups);
  const attached = useLive((state) => state.attached);
  const delays = useLive((state) => state.delays);
  const poll = useLive((state) => state.poll);
  const switchGroup = useLive((state) => state.switchGroup);
  const testDelay = useLive((state) => state.testDelay);
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

  const handleSwitch = async (group: string, name: string) => {
    setBusy(true);
    try {
      await switchGroup(group, name);
      toast.success(`已切换 ${group} → ${name}`);
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const selected = connections.find((connection) => connection.id === selectedId) ?? null;
  const orderedGroups = selected
    ? [...groups].sort(
        (left, right) =>
          Number(selected.chains.includes(right.name)) - Number(selected.chains.includes(left.name)),
      )
    : groups;

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
                  className={`data-row connection-row ${
                    connection.id === selectedId ? 'selected' : ''
                  }`}
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
            <strong>暂无活动连接</strong>
          </div>
        )}
      </div>

      {selected ? (
        <div className="card">
          <div className="card-head">
            <div className="card-title-row">
              <h2 className="card-title">切换出口</h2>
              <span className="chip chip-muted">
                {selected.metadata?.host || selected.id.slice(0, 8)}
              </span>
            </div>
          </div>
          <p className="hint">链路：{selected.chains.join(' → ') || '直连'}</p>
          {orderedGroups.length ? (
            <div className="proxy-groups">
              {orderedGroups.map((group) => (
                <div className="proxy-row" key={group.name}>
                  <div className="data-main">
                    <strong>{group.name}</strong>
                    <span>{selected.chains.includes(group.name) ? '当前链路' : '策略组'}</span>
                  </div>
                  <Select
                    value={group.now}
                    options={group.all.map((name) => ({ value: name, label: name }))}
                    onChange={(value) => void handleSwitch(group.name, value)}
                    ariaLabel={`切换 ${group.name}`}
                  />
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => void testDelay(group.name)}
                    disabled={busy}
                  >
                    <Gauge size={14} />
                    {delays[group.name] === undefined
                      ? '测速'
                      : delays[group.name] === null
                        ? '失败'
                        : `${delays[group.name]} ms`}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">
              <strong>没有可切换的 Selector 组</strong>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
