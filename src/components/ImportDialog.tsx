import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { errorMessage, importSource, isTauriRuntime } from '../api';
import { Dialog } from '../components/Dialog';
import { useImportDialog } from '../store/dialogs';
import { useWorkspaceData } from '../store/workspace';

export function ImportDialog() {
  const open = useImportDialog((state) => state.open);
  const hide = useImportDialog((state) => state.hide);
  const navigate = useNavigate();
  const [input, setInput] = useState('');
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
      const next = await importSource(input.trim());
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
    <Dialog title="导入" onClose={hide}>
      <form onSubmit={handleImport}>
        <div className="dialog-body">
          <p className="lead">配置文件路径、订阅链接、节点分享链接、粘贴 YAML，自动识别。</p>
          <label className="field">
            <textarea
              className="textarea mono node-editor"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={'D:\\path\\to\\config.yaml\nhttps://example.com/subscribe\nss://… vmess://…\n或直接粘贴 mihomo YAML'}
              rows={8}
              spellCheck={false}
              autoFocus
            />
          </label>
          {browser ? <p className="notice notice-info">浏览器模式请使用桌面版。</p> : null}
          {message ? <p className="notice notice-ok">{message}</p> : null}
          {error ? <p className="notice notice-warn">{error}</p> : null}
        </div>
        <div className="dialog-foot">
          {message ? (
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => { hide(); navigate('/nodes'); }}
            >
              查看节点
            </button>
          ) : (
            <button
              className="btn btn-primary"
              type="submit"
              disabled={busy || browser || !input.trim()}
            >
              {busy ? '导入中…' : '导入'}
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
