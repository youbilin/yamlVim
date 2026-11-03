import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';

import { errorMessage, getDataDir } from '../api';
import { useApp } from '../store/app';

export function SettingsPage() {
  const settings = useApp((state) => state.settings);
  const setCorePath = useApp((state) => state.setCorePath);
  const save = useApp((state) => state.save);
  const [dataDir, setDataDir] = useState('');
  const [saved, setSaved] = useState('');

  useEffect(() => {
    void getDataDir()
      .then(setDataDir)
      .catch((reason) => setDataDir(errorMessage(reason)));
  }, []);

  const handleSave = async () => {
    setSaved('');
    try {
      await save();
      setSaved('已保存');
    } catch (reason) {
      setSaved(errorMessage(reason));
    }
  };

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">SETTINGS</p>
          <h1>设置</h1>
          <p className="lead">本地优先。设置只写入应用目录的 data/，不使用 AppData，也不触碰任何客户端配置。</p>
        </div>
      </header>

      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">内核路径</h2>
            <p className="card-sub">留空时使用 PATH 中的 mihomo。</p>
          </div>
        </div>
        <label className="field">
          <span>mihomo 可执行文件</span>
          <input
            className="input mono"
            value={settings.corePath}
            onChange={(event) => setCorePath(event.target.value)}
            placeholder="mihomo"
            spellCheck={false}
          />
        </label>
        <div className="inline-actions">
          <button className="btn btn-primary" type="button" onClick={() => void handleSave()}>
            <Save size={15} />
            保存
          </button>
          {saved ? <span className="hint">{saved}</span> : null}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2 className="card-title">应用目录 data/</h2>
        </div>
        <p className="mono muted break">{dataDir || '读取中…'}</p>
        <p className="hint">可通过环境变量 YAMLVIM_DATA_DIR 覆盖。</p>
      </div>
    </section>
  );
}
