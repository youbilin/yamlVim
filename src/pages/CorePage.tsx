import { useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';

import { errorMessage } from '../api';
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
      <div className="card">
        <form className="inline-form" onSubmit={handleProbe}>
          <label className="field grow">
            <span>mihomo 路径</span>
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
            {busy ? '探测中…' : '探测'}
          </button>
        </form>
        {error ? <p className="notice notice-warn">{error}</p> : null}
        <p className="hint">安全模式 · 只探测，不启动或修改 mihomo</p>
      </div>

      {probe ? <ProbeResult probe={probe} /> : null}
    </section>
  );
}
