import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';

import {
  deleteExit,
  errorMessage,
  getExitYaml,
  saveExitYaml,
} from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { YamlEditorDialog } from '../components/YamlEditorDialog';
import { asArray, asRecord, asText } from '../lib/workspace';
import { useWorkspaceData } from '../store/workspace';

interface EditingExit {
  originalName: string | null;
  yaml: string;
}

const NEW_EXIT = `name: New Group
type: select
proxies:
  - DIRECT
`;

export function ExitsPage() {
  const view = useWorkspaceData((state) => state.view);
  const error = useWorkspaceData((state) => state.error);
  const load = useWorkspaceData((state) => state.load);
  const [editing, setEditing] = useState<EditingExit | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void load();
  }, [load]);

  const exits = view?.exits ?? [];

  const openEdit = async (name: string) => {
    try {
      const yaml = await getExitYaml(name);
      setEditing({ originalName: name, yaml });
    } catch (reason) {
      setMessage(errorMessage(reason));
    }
  };

  const saveExit = async (yaml: string) => {
    await saveExitYaml(editing?.originalName ?? null, yaml);
    await load();
    setEditing(null);
    setMessage('出口已保存');
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    await deleteExit(deleting);
    await load();
    setDeleting(null);
    setMessage('出口已删除');
  };

  return (
    <section className="page">
      <div className="card">
        <div className="card-head">
          <div className="card-title-row">
            <h2 className="card-title">出口</h2>
            <span className="chip chip-muted">{view ? `${view.exitCount}` : '—'}</span>
          </div>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => setEditing({ originalName: null, yaml: NEW_EXIT })}
          >
            <Plus size={15} />
            新增策略组
          </button>
        </div>

        {error ? <p className="notice notice-info">{error}</p> : null}
        {message ? <p className="notice notice-ok">{message}</p> : null}

        {exits.length ? (
          <div className="data-list">
            {exits.map((exit, index) => {
              const entry = asRecord(exit);
              const name = asText(entry.name) || `exit-${index + 1}`;
              const type = asText(entry.type) || 'unknown';
              const members = asArray(entry.proxies);
              return (
                <div className="data-row" key={`${name}-${index}`}>
                  <span className="data-index">{String(index + 1).padStart(2, '0')}</span>
                  <div className="data-main">
                    <strong>{name}</strong>
                    <span>
                      {type} · {members.length} members
                    </span>
                  </div>
                  <span className="chip chip-muted">{type}</span>
                  <div className="inline-actions row-actions">
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => void openEdit(name)}
                    >
                      <Pencil size={14} />
                      编辑
                    </button>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => setDeleting(name)}
                      aria-label="删除出口"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty">
            <strong>还没有出口</strong>
          </div>
        )}
      </div>

      {editing ? (
        <YamlEditorDialog
          title={editing.originalName ? `编辑出口 · ${editing.originalName}` : '新增策略组'}
          value={editing.yaml}
          onSave={saveExit}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="删除出口"
          message={`确定删除 ${deleting}？其他策略组对它的引用会被清理。`}
          confirmLabel="删除"
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </section>
  );
}
