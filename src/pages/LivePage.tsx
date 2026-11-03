import { useCallback, useEffect, useState } from 'react';
import { Activity } from 'lucide-react';

import { controllerGet, errorMessage, isTauriRuntime } from '../api';
import { useApp } from '../store/app';

interface RawConnection {
  id: string;
  metadata: { host?: string; destinationPort?: string; network?: string };
  upload: number;
  download: number;
  chains: string[];
  start: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function LivePage() {
  const settings = useApp((state) => state.settings);
  const setControllerEndpoint = useApp((state) => state.setControllerEndpoint);
  const [connections, setConnections] = useState<RawConnection[]>([]);
  const [attached, setAttached] = useState(false);
  const [attachError, setAttachError] = useState('');
  const browser = !isTauriRuntime();

  const endpoint = settings.controllerEndpoint || '127.0.0.1:9090';
  const secret = settings.controllerSecret || '';

  const poll = useCallback(async () => {
    if (browser || !endpoint.trim()) return;
    try {
      const raw = await controllerGet('/connections');
      const data = JSON.parse(raw) as { connections?: RawConnection[] };
      setConnections(data.connections ?? []);
      setAttached(true);
      setAttachError('');
    } catch (reason) {
      setAttached(false);
      setAttachError(errorMessage(reason));
    }
  }, [browser, endpoint]);

  useEffect(() => {
    if (browser || !endpoint.trim()) return;
    void poll();
    const timer = window.setInterval(() => void poll(), 3_000);
    return () => window.clearInterval(timer);
  }, [poll, endpoint, browser]);

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
              value={endpoint}
              onChange={(e) => setControllerEndpoint(e.target.value)}
              placeholder="127.0.0.1:9090"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>密钥</span>
            <input
              className="input mono"
              type="password"
              value={secret}
              placeholder="secret"
              readOnly
            />
          </label>
        </div>
        {attachError ? <p className="notice notice-warn">{attachError}</p> : null}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title-row">
            <h2 className="card-title">实时连接</h2>
            <span className="chip chip-muted">{connections.length} connections</span>
          </div>
          <button className="btn btn-ghost" type="button" onClick={() => void poll()} disabled={browser}>
            <Activity size={15} />
            刷新
          </button>
        </div>

        {connections.length ? (
          <div className="data-list">
            {connections.slice(0, 50).map((connection) => {
              const meta = connection.metadata ?? {};
              return (
                <div className="data-row" key={connection.id}>
                  <div className="data-main">
                    <strong>{meta.host || meta.destinationPort || 'unknown'}</strong>
                    <span>
                      {[meta.network, ...connection.chains].filter(Boolean).join(' → ')}
                    </span>
                  </div>
                  <div className="data-main">
                    <span>↑ {formatBytes(connection.upload)}</span>
                    <span>↓ {formatBytes(connection.download)}</span>
                  </div>
                </div>
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
    </section>
  );
}
