import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';

import { errorMessage, getDataDir } from '../api';
import { useApp } from '../store/app';
import type { CoreProbe } from '../types';

function ProbeResult({ probe }: { probe: CoreProbe }) {
  const managed = probe.kind === 'managed';
  const unusable = probe.kind === 'unusable';
  const Icon = managed ? CheckCircle2 : unusable ? XCircle : AlertTriangle;
  const title = managed ? '可管理内核' : unusable ? '不可用内核' : '仅可连接内核';

  return (
    <div className={`probe-result ${managed ? 'ok' : unusable ? 'bad' : 'warn'}`}>
      <div className="probe-head">
        <Icon size={20} />
        <div>
          <strong>{title}</strong>
          <span>{probe.path}</span>
        </div>
        <span className="mono">{probe.version ?? 'unknown version'}</span>
      </div>
      {probe.reason ? <p className="notice notice-warn">{probe.reason}</p> : null}
      {probe.output ? (
        <details className="probe-output">
          <summary>探测输出</summary>
          <pre className="code-block">{probe.output}</pre>
        </details>
      ) : null}
    </div>
  );
}

export function CorePage() {
  const settings = useApp((state) => state.settings);
  const probe = useApp((state) => state.probe);
  const setCorePath = useApp((state) => state.setCorePath);
  const runProbe = useApp((state) => state.runProbe);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dataDir, setDataDir] = useState('');

  useEffect(() => {
    void getDataDir()
      .then(setDataDir)
      .catch((reason) => setDataDir(errorMessage(reason)));
  }, []);

  const handleProbe = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await runProbe();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">CORE</p>
          <h1>mihomo 内核</h1>
          <p className="lead">
            YamlVim 只读取内核信息。安全模式下不启动、不停止、不重载 mihomo；实时数据通过
            只读 attach 接入，编辑只会生成新的 YAML。
          </p>
        </div>
        <span className={`chip ${probe?.managed ? 'chip-managed' : 'chip-muted'}`}>
          {probe?.managed ? 'managed ready' : 'not probed'}
        </span>
      </header>

      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">内核可执行文件</h2>
            <p className="card-sub">支持标准 mihomo；会自动执行 -v 与 -t 兼容性探测。</p>
          </div>
        </div>
        <form className="inline-form" onSubmit={handleProbe}>
          <label className="field grow">
            <span>二进制路径</span>
            <input
              className="input mono"
              value={settings.corePath}
              onChange={(event) => setCorePath(event.target.value)}
              placeholder="mihomo 或 C:\path\to\mihomo.exe"
              spellCheck={false}
            />
          </label>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            <RefreshCw size={15} className={busy ? 'spin' : undefined} />
            {busy ? '探测中…' : '探测内核'}
          </button>
        </form>
        {error ? <p className="notice notice-warn">{error}</p> : null}
        <p className="hint">
          也可以把 <code>mihomo.exe</code> 放到应用目录 <code>data/bin/</code> 下，或使用
          环境变量 <code>YAMLVIM_MIHOMO</code>。
        </p>
      </div>

      {probe ? <ProbeResult probe={probe} /> : null}

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h2 className="card-title">当前数据目录</h2>
          </div>
          <p className="mono muted break">{dataDir || '读取中…'}</p>
        </div>
        <div className="card">
          <div className="card-head">
            <h2 className="card-title">安全模式</h2>
          </div>
          <p className="muted">
            不启动或停止 mihomo，不写入运行中的控制器。编辑与导出只生成新的 YAML
            文件。只读 attach 和实时连接是下一步。
          </p>
        </div>
      </div>
    </section>
  );
}
