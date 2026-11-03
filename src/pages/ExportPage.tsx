import { useEffect, useState } from 'react';
import { Download, RefreshCw, Save, ShieldCheck } from 'lucide-react';

import {
  errorMessage,
  exportConfig,
  getConfigStatus,
  isTauriRuntime,
  saveWorkspaceYaml,
  validateConfig,
} from '../api';
import { useImportDialog } from '../store/dialogs';
import { useWorkspaceData } from '../store/workspace';
import type { ConfigStatus, ConfigValidation } from '../types';

export function ExportPage() {
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [draftYaml, setDraftYaml] = useState('');
  const [loadedYaml, setLoadedYaml] = useState('');
  const [validation, setValidation] = useState<ConfigValidation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const version = useWorkspaceData((state) => state.version);
  const browser = !isTauriRuntime();
  const dirty = draftYaml !== loadedYaml;

  const refresh = async () => {
    try {
      const next = await getConfigStatus();
      setStatus(next);
      setLoadedYaml(next.configYaml ?? '');
      setDraftYaml(next.configYaml ?? '');
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  useEffect(() => {
    void refresh();
    // Refresh when another page imports, saves or applies DNS.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const handleSave = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const next = await saveWorkspaceYaml(draftYaml);
      setStatus(next);
      setLoadedYaml(next.configYaml ?? '');
      setDraftYaml(next.configYaml ?? '');
      void useWorkspaceData.getState().load();
      setMessage(
        `workspace 已保存：${next.nodeCount} 个节点 / ${next.exitCount} 个出口 / ${next.ruleCount} 条规则`,
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const handleValidate = async () => {
    if (!draftYaml.trim()) return;
    setBusy(true);
    setError('');
    setValidation(null);
    try {
      setValidation(await validateConfig(draftYaml));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (dirty) {
        const next = await saveWorkspaceYaml(draftYaml);
        setStatus(next);
        setLoadedYaml(next.configYaml ?? '');
        setDraftYaml(next.configYaml ?? '');
        void useWorkspaceData.getState().load();
      }
      const path = await exportConfig();
      setMessage(`已导出新的 YAML：${path}`);
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  if (!status) {
    return (
      <section className="page">
        <div className="empty">读取中…</div>
      </section>
    );
  }

  if (!status.hasWorkspace) {
    return (
      <section className="page">
        <div className="empty">
          <strong>还没有 workspace</strong>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => useImportDialog.getState().show()}
          >
            导入 mihomo YAML
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="page">
      <div className="card">
        <div className="card-head">
          <div className="card-title-row">
            <h2 className="card-title">完整 YAML</h2>
            <span className={`chip ${dirty ? 'chip-attach' : 'chip-muted'}`}>
              {dirty ? '未保存' : `${status.historyCount} history`}
            </span>
            <span className="chip chip-muted">
              {status.nodeCount} / {status.exitCount} / {status.ruleCount}
            </span>
          </div>
          <div className="inline-actions">
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => void refresh()}
              disabled={busy}
            >
              <RefreshCw size={15} />
              重新载入
            </button>
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => void handleSave()}
              disabled={busy || !dirty || browser}
            >
              <Save size={15} />
              保存到 workspace
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => void handleValidate()}
              disabled={busy || !draftYaml.trim() || browser}
            >
              <ShieldCheck size={15} />
              校验
            </button>
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => void handleExport()}
              disabled={busy || browser}
            >
              <Download size={15} />
              导出新 YAML
            </button>
          </div>
        </div>

        {message ? <p className="notice notice-ok">{message}</p> : null}
        {error ? <p className="notice notice-warn">{error}</p> : null}
        {validation ? (
          <div className={validation.ok ? 'notice notice-ok' : 'notice notice-warn'}>
            <strong>{validation.ok ? 'mihomo -t 通过' : '校验未通过'}</strong>
            <details>
              <summary>查看输出</summary>
              <pre className="code-block output-block">{validation.output}</pre>
            </details>
          </div>
        ) : null}

        <textarea
          className="textarea mono export-editor"
          value={draftYaml}
          onChange={(event) => setDraftYaml(event.target.value)}
          spellCheck={false}
          aria-label="完整 YAML"
        />

      </div>
    </section>
  );
}
