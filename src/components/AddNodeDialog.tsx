import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';

import { addNodeYaml, errorMessage } from '../api';
import { Dialog } from './Dialog';
import { useWorkspaceData } from '../store/workspace';

interface AddNodeDialogProps {
  open: boolean;
  onClose: () => void;
  onAdded: (message: string) => void;
}

const SAMPLE = `name: node-c
type: ss
server: c.example.com
port: 443
cipher: aes-128-gcm
password: secret
`;

export function AddNodeDialog({ open, onClose, onAdded }: AddNodeDialogProps) {
  const [yaml, setYaml] = useState(SAMPLE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) setError('');
  }, [open]);

  if (!open) return null;

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const next = await addNodeYaml(yaml);
      await useWorkspaceData.getState().load();
      setYaml(SAMPLE);
      setError('');
      onAdded(`节点已添加：当前共 ${next.nodeCount} 个节点`);
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="新增节点" onClose={onClose}>
      <form onSubmit={handleAdd}>
        <div className="dialog-body">
          <label className="field">
            <span>节点 YAML</span>
            <textarea
              className="textarea mono node-editor"
              value={yaml}
              onChange={(event) => setYaml(event.target.value)}
              rows={12}
              spellCheck={false}
            />
          </label>
          {error ? <p className="notice notice-warn">{error}</p> : null}
        </div>
        <div className="dialog-foot">
          <button className="btn btn-primary" type="submit" disabled={busy || !yaml.trim()}>
            <Plus size={15} />
            {busy ? '添加中…' : '添加节点'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            取消
          </button>
        </div>
      </form>
    </Dialog>
  );
}
