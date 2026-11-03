import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { errorMessage, importSource, isTauriRuntime } from '../api';
import { Dialog } from '../components/Dialog';
import { useImportDialog } from '../store/dialogs';
import { toast } from '../store/toast';
import { useWorkspaceData } from '../store/workspace';

export function ImportDialog() {
  const open = useImportDialog((state) => state.open);
  const hide = useImportDialog((state) => state.hide);
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const browser = !isTauriRuntime();

  if (!open) return null;

  const handleImport = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const next = await importSource(input.trim());
      await useWorkspaceData.getState().load();
      toast.success(
        `已导入：${next.nodeCount} 个节点 / ${next.exitCount} 个出口 / ${next.ruleCount} 条规则`,
      );
      hide();
      navigate('/nodes');
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="导入" onClose={hide}>
      <form onSubmit={handleImport}>
        <div className="dialog-body">
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
        </div>
        <div className="dialog-foot">
          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy || browser || !input.trim()}
          >
            {busy ? '导入中…' : '导入'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={hide}>
            关闭
          </button>
        </div>
      </form>
    </Dialog>
  );
}
