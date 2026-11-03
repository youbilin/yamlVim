import { useState } from 'react';
import { Save } from 'lucide-react';

import { Dialog } from './Dialog';
import { toast } from '../store/toast';

interface YamlEditorDialogProps {
  title: string;
  value: string;
  onSave: (yaml: string) => Promise<void>;
  onClose: () => void;
}

export function YamlEditorDialog({ title, value, onSave, onClose }: YamlEditorDialogProps) {
  const [yaml, setYaml] = useState(value);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await onSave(yaml);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="dialog-body">
          <label className="field">
            <textarea
              className="textarea mono node-editor"
              value={yaml}
              onChange={(event) => setYaml(event.target.value)}
              rows={14}
              spellCheck={false}
              autoFocus
            />
          </label>
        </div>
        <div className="dialog-foot">
          <button className="btn btn-primary" type="submit" disabled={busy || !yaml.trim()}>
            <Save size={15} />
            {busy ? '保存中…' : '保存'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            取消
          </button>
        </div>
      </form>
    </Dialog>
  );
}
