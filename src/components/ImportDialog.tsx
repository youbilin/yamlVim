import { useEffect, useState } from 'react';
import { FileUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { isTauriRuntime, errorMessage, importConfig } from '../api';
import { Dialog } from '../components/Dialog';
import { useImportDialog } from '../store/dialogs';
import { useWorkspaceData } from '../store/workspace';

export function ImportDialog() {
  const open = useImportDialog((state) => state.open);
  const hide = useImportDialog((state) => state.hide);
  const navigate = useNavigate();
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const browser = !isTauriRuntime();

  useEffect(() => {
    if (open) {
      setError('');
      setMessage('');
    }
  }, [open]);

  if (!open) return null;

  const handleImport = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const next = await importConfig(source.trim());
      await useWorkspaceData.getState().load();
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

  return (
    <Dialog title="导入 mihomo YAML" onClose={hide}>
      <form onSubmit={handleImport}>
        <div className="dialog-body">
          <label className="field">
            <span>源文件路径</span>
            <input
              className="input mono"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder="D:\path\to\config.yaml"
              spellCheck={false}
              autoFocus
            />
          </label>
          {browser ? (
            <p className="notice notice-info">浏览器模式不能读取本地文件，请使用桌面版。</p>
          ) : null}
          {message ? <p className="notice notice-ok">{message}</p> : null}
          {error ? <p className="notice notice-warn">{error}</p> : null}
        </div>
        <div className="dialog-foot">
          {message ? (
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => {
                hide();
                navigate('/nodes');
              }}
            >
              查看节点
            </button>
          ) : (
            <button className="btn btn-primary" type="submit" disabled={busy || browser || !source.trim()}>
              <FileUp size={15} />
              {busy ? '导入中…' : '导入到 workspace'}
            </button>
          )}
          <button className="btn btn-ghost" type="button" onClick={hide}>
            关闭
          </button>
        </div>
      </form>
    </Dialog>
  );
}
