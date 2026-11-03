import { useEffect, useState } from 'react';
import { Download, FileUp, ShieldCheck } from 'lucide-react';

import {
  errorMessage,
  exportConfig,
  getConfigStatus,
  importConfig,
  isTauriRuntime,
  saveWorkspaceYaml,
  validateConfig,
} from '../api';
import { useWorkspaceData } from '../store/workspace';
import type { ConfigStatus, ConfigValidation } from '../types';

export function ConfigPage() {
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [validation, setValidation] = useState<ConfigValidation | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftYaml, setDraftYaml] = useState('');
  const browser = !isTauriRuntime();

  const refresh = async () => {
    try {
      setStatus(await getConfigStatus());
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!editing) setDraftYaml(status?.configYaml ?? '');
  }, [status?.configYaml, editing]);

  const handleImport = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    setValidation(null);
    try {
      const next = await importConfig(source.trim());
      setStatus(next);
      setEditing(false);
      setDraftYaml(next.configYaml ?? '');
      void useWorkspaceData.getState().load();
      setMessage(
        `已导入 workspace：${next.nodeCount} 个节点 / ${next.exitCount} 个出口 / ${next.ruleCount} 条规则${
          next.geodata.length ? ` · GeoData ${next.geodata.length} 个` : ''
        }`,
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const handleValidate = async () => {
    const yaml = editing ? draftYaml : status?.configYaml;
    if (!yaml) return;
    setBusy(true);
    setError('');
    setValidation(null);
    try {
      setValidation(await validateConfig(yaml));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    setValidation(null);
    try {
      const next = await saveWorkspaceYaml(draftYaml);
      setStatus(next);
      setEditing(false);
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

  const handleExport = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const path = await exportConfig();
      setMessage(`已导出新的 YAML：${path}`);
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const yaml = status?.configYaml ?? '';

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">WORKSPACE</p>
          <h1>配置</h1>
          <p className="lead">
            把现有 mihomo YAML 导入当前 workspace。之后所有页面和导出都只使用这份 workspace，
            不再保留隐藏的原始节点；旧版本只保存在历史快照里。
          </p>
        </div>
        <span className={`chip ${status?.hasWorkspace ? 'chip-managed' : 'chip-muted'}`}>
          {status?.hasWorkspace ? 'workspace ready' : 'no workspace'}
        </span>
      </header>

      {browser ? (
        <p className="notice notice-info">
          浏览器模式不能读写应用目录或调用 mihomo。请运行
          <code> npm run desktop:dev </code> 使用桌面版。
        </p>
      ) : null}

      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">应用目录</h2>
            <p className="card-sub">所有配置、快照和导出都保存在这里，不使用 AppData。</p>
          </div>
        </div>
        <p className="mono muted break">{status?.dataDir ?? '读取中…'}</p>
        <div className="meta-list">
          <div>
            <span>WORKSPACE</span>
            <code>{status?.workspacePath || '—'}</code>
          </div>
          <div>
            <span>ACTIVE</span>
            <code>{status?.configPath || '—'}</code>
          </div>
          <div>
            <span>CORE</span>
            <code>{status?.coreDir || '—'}</code>
          </div>
          <div>
            <span>GEODATA</span>
            <code>{status?.geodata.length ? status.geodata.join(', ') : '未发现'}</code>
          </div>
          <div>
            <span>NODES / EXITS / RULES</span>
            <code>
              {status?.nodeCount ?? 0} / {status?.exitCount ?? 0} / {status?.ruleCount ?? 0}
            </code>
          </div>
          <div>
            <span>HISTORY</span>
            <code>{status?.historyCount ?? 0} snapshots</code>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">导入现有 mihomo YAML</h2>
            <p className="card-sub">
              导入会生成 data/workspace.json 与 data/config.yaml；旧状态写入
              data/history。rule-providers / proxy-providers 的本地文件会复制到
              data/core/providers 并重写路径。YAML 会规范化（注释可能丢失），源文件不修改。
            </p>
          </div>
        </div>
        <form className="inline-form" onSubmit={handleImport}>
          <label className="field grow">
            <span>源文件路径</span>
            <input
              className="input mono"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder="D:\path\to\config.yaml"
              spellCheck={false}
            />
          </label>
          <button className="btn btn-primary" type="submit" disabled={busy || browser}>
            <FileUp size={15} />
            {busy ? '导入中…' : '导入到 workspace'}
          </button>
        </form>
        {message ? <p className="hint">{message}</p> : null}
        {error ? <p className="notice notice-warn">{error}</p> : null}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">当前 workspace</h2>
            <p className="card-sub">
              导出只从当前 workspace 重新生成，不合并隐藏的 base；节点、出口和规则的修改都会反映到新 YAML。
            </p>
          </div>
          <div className="inline-actions">
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => setEditing((current) => !current)}
              disabled={busy || !status?.hasWorkspace || browser}
            >
              {editing ? '取消编辑' : '编辑 YAML'}
            </button>
            {editing ? (
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => void handleSave()}
                disabled={busy || !draftYaml.trim() || browser}
              >
                保存 workspace
              </button>
            ) : null}
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => void handleValidate()}
              disabled={busy || !yaml || browser}
            >
              <ShieldCheck size={15} />
              校验
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => void handleExport()}
              disabled={busy || !status?.hasWorkspace || browser || editing}
            >
              <Download size={15} />
              导出新 YAML
            </button>
          </div>
        </div>

        {validation ? (
          <div className={validation.ok ? 'notice notice-ok' : 'notice notice-warn'}>
            <strong>{validation.ok ? 'mihomo -t 通过' : '校验未通过'}</strong>
            <details>
              <summary>查看输出</summary>
              <pre className="code-block output-block">{validation.output}</pre>
            </details>
          </div>
        ) : null}

        {editing ? (
          <textarea
            className="textarea mono config-editor"
            value={draftYaml}
            onChange={(event) => setDraftYaml(event.target.value)}
            spellCheck={false}
          />
        ) : (
          <pre className="code-block config-code">
            {yaml || '导入 mihomo YAML 后，这里会显示当前 workspace 生成的完整配置。'}
          </pre>
        )}
        <p className="hint">
          编辑只会保存到 workspace 并生成新的 config.yaml，不会修改运行中的 mihomo；导出会写入一个新的 YAML 文件。
        </p>
      </div>
    </section>
  );
}
