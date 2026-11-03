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
      toast.success('控制器设置已保存');
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
          <span className={`chip ${attached ? 'chip-managed' : 'chip-muted'}`}>
            {attached ? `${connections.length} 条连接` : '未连接'}
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
