import { useCallback, useEffect, useState } from 'react';
import { Activity, Gauge, Save } from 'lucide-react';

import {
  controllerDelay,
  controllerGet,
  errorMessage,
  isTauriRuntime,
  saveController,
  switchProxy,
} from '../api';
import { Select } from '../components/Select';
import { useApp } from '../store/app';

interface RawConnection {
  id: string;
  metadata: { host?: string; destinationPort?: string; network?: string };
  upload: number;
  download: number;
  chains: string[];
  start: string;
}

interface RawProxy {
  type?: string;
  now?: string;
  all?: string[];
  alive?: boolean;
  history?: Array<{ delay?: number }>;
}

interface ProxyGroup {
  name: string;
  now: string;
  all: string[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function LivePage() {
  const settings = useApp((state) => state.settings);
  const setControllerEndpoint = useApp((state) => state.setControllerEndpoint);
  const setControllerSecret = useApp((state) => state.setControllerSecret);
  const [connections, setConnections] = useState<RawConnection[]>([]);
  const [groups, setGroups] = useState<ProxyGroup[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [delays, setDelays] = useState<Record<string, number | null>>({});
  const [attached, setAttached] = useState(false);
  const [attachError, setAttachError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const browser = !isTauriRuntime();

  const endpoint = settings.controllerEndpoint.trim();
  const secret = settings.controllerSecret;

  const poll = useCallback(async () => {
    if (browser || !endpoint) return;
    try {
      const [connectionsRaw, proxiesRaw] = await Promise.all([
        controllerGet('/connections'),
        controllerGet('/proxies'),
      ]);
      const connectionsData = JSON.parse(connectionsRaw) as { connections?: RawConnection[] };
      setConnections(connectionsData.connections ?? []);

      const proxiesData = JSON.parse(proxiesRaw) as { proxies?: Record<string, RawProxy> };
      const nextGroups = Object.entries(proxiesData.proxies ?? {})
        .filter(([, proxy]) => proxy.type === 'Selector' && Array.isArray(proxy.all))
        .map(([name, proxy]) => ({
          name,
          now: proxy.now ?? '',
          all: proxy.all ?? [],
        }));
      setGroups(nextGroups);
      setAttached(true);
      setAttachError('');
    } catch (reason) {
      setAttached(false);
      setAttachError(errorMessage(reason));
    }
  }, [browser, endpoint]);

  useEffect(() => {
    if (browser || !endpoint) return;
    void poll();
    const timer = window.setInterval(() => void poll(), 5_000);
    return () => window.clearInterval(timer);
  }, [poll, endpoint, browser]);

  const persistController = async () => {
    setBusy(true);
    setAttachError('');
    setMessage('');
    try {
      await saveController(endpoint, secret);
      setMessage('控制器设置已保存');
      await poll();
    } catch (reason) {
      setAttachError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const handleSwitch = async (group: string, name: string) => {
    setBusy(true);
    setMessage('');
    try {
      await switchProxy(group, name);
      setMessage(`已切换 ${group} → ${name}`);
      await poll();
    } catch (reason) {
      setAttachError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const handleDelay = async (group: string) => {
    try {
      const result = await controllerDelay(group);
      setDelays((current) => ({
        ...current,
        [group]: result.delayMs ?? null,
      }));
    } catch {
      setDelays((current) => ({ ...current, [group]: null }));
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
            <h2 className="card-title">控制器</h2>
            <span className={`chip ${attached ? 'chip-managed' : 'chip-muted'}`}>
              {attached ? 'attached' : 'not connected'}
            </span>
          </div>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>控制器地址</span>
            <input
              className="input mono"
              value={settings.controllerEndpoint}
              onChange={(event) => setControllerEndpoint(event.target.value)}
              placeholder="127.0.0.1:9090"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>密钥</span>
            <input
              className="input mono"
              type="password"
              value={settings.controllerSecret}
              onChange={(event) => setControllerSecret(event.target.value)}
              placeholder="secret"
              spellCheck={false}
            />
          </label>
        </div>
        <div className="inline-actions">
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => void persistController()}
            disabled={busy || browser || !endpoint}
          >
            <Save size={15} />
            保存控制器
          </button>
          {message ? <span className="hint">{message}</span> : null}
        </div>
        {attachError ? <p className="notice notice-warn">{attachError}</p> : null}
        <p className="hint">只读连接。编辑只生成 YAML，不会修改运行中的 mihomo。</p>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title-row">
            <h2 className="card-title">实时连接</h2>
            <span className="chip chip-muted">{connections.length} connections</span>
          </div>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => void poll()}
            disabled={busy || browser || !endpoint}
          >
            <Activity size={15} />
            刷新
          </button>
        </div>

        {connections.length ? (
          <div className="data-list">
            {connections.slice(0, 50).map((connection) => {
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
            <p>请确认 mihomo 正在运行，并且控制器地址正确。</p>
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
          <p className="hint">当前链路：{selected.chains.join(' → ') || '直连'}</p>
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
                    onClick={() => void handleDelay(group.name)}
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
