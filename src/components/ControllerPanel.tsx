import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';

import { errorMessage, saveController } from '../api';
import { useApp } from '../store/app';
import { useLive } from '../store/live';
import { toast } from '../store/toast';

export function ControllerPanel() {
  const settings = useApp((state) => state.settings);
  const setControllerEndpoint = useApp((state) => state.setControllerEndpoint);
  const setControllerSecret = useApp((state) => state.setControllerSecret);
  const attached = useLive((state) => state.attached);
  const error = useLive((state) => state.error);
  const connections = useLive((state) => state.connections);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void useLive.getState().poll();
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      await saveController(
        settings.controllerEndpoint.trim(),
        settings.controllerSecret,
      );
      await useLive.getState().poll();
      const live = useLive.getState();
      if (live.attached) {
        toast.success(
          live.connections.length
            ? `控制器已连接 · ${live.connections.length} 条连接`
            : '控制器已连接 · 当前没有活动连接',
        );
      } else {
        toast.error(live.error ?? '控制器未连接，请检查地址和密钥');
      }
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title-row">
          <h2 className="card-title">控制器</h2>
          <span
            className={`chip ${attached ? 'chip-managed' : 'chip-muted'}`}
            title={attached ? undefined : (error ?? undefined)}
          >
            {attached ? `${connections.length} 条连接` : error ? '连接失败' : '未连接'}
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
          <span className="hint">填 mihomo 的 external-controller 端口，不是代理端口。</span>
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
          onClick={() => void save()}
          disabled={busy || !settings.controllerEndpoint.trim()}
        >
          <Save size={15} />
          保存控制器
        </button>
      </div>
    </div>
  );
}
