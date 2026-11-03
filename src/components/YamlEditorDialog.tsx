import { useState } from 'react';
import { Save } from 'lucide-react';

import { Dialog } from './Dialog';

interface YamlEditorDialogProps {
  title: string;
  value: string;
  onSave: (yaml: string) => Promise<void>;
  onClose: () => void;
}

export function YamlEditorDialog({ title, value, onSave, onClose }: YamlEditorDialogProps) {
  const [yaml, setYaml] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave(yaml);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
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
          {error ? <p className="notice notice-warn">{error}</p> : null}
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
