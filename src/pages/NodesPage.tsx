import { useEffect, useState } from 'react';
import { Pencil, Power, Trash2 } from 'lucide-react';

import {
  deleteNode,
  errorMessage,
  getNodeYaml,
  toggleNode,
  updateNodeYaml,
} from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { YamlEditorDialog } from '../components/YamlEditorDialog';
import { asRecord, asText } from '../lib/workspace';
import { useWorkspaceData } from '../store/workspace';

interface EditingNode {
  name: string;
  yaml: string;
}

export function NodesPage() {
  const view = useWorkspaceData((state) => state.view);
  const error = useWorkspaceData((state) => state.error);
  const load = useWorkspaceData((state) => state.load);
  const [editing, setEditing] = useState<EditingNode | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void load();
  }, [load]);

  const nodes = view?.nodes ?? [];

  const openEdit = async (name: string) => {
    try {
      const yaml = await getNodeYaml(name);
      setEditing({ name, yaml });
    } catch (reason) {
      setMessage(errorMessage(reason));
    }
  };

  const saveNode = async (yaml: string) => {
    if (!editing) return;
    await updateNodeYaml(editing.name, yaml);
    await load();
    setEditing(null);
    setMessage('节点已保存');
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    await deleteNode(deleting);
    await load();
    setDeleting(null);
    setMessage('节点已删除');
  };

  const handleToggle = async (name: string, disabled: boolean) => {
    try {
      await toggleNode(name, !disabled);
      await load();
    } catch (reason) {
      setMessage(errorMessage(reason));
    }
  };

  return (
    <section className="page">
      <div className="card">
        <div className="card-head">
          <div className="card-title-row">
            <h2 className="card-title">节点</h2>
            <span className="chip chip-muted">{view ? `${view.nodeCount}` : '—'}</span>
          </div>
        </div>

        {error ? <p className="notice notice-info">{error}</p> : null}
        {message ? <p className="notice notice-ok">{message}</p> : null}

        {nodes.length ? (
          <div className="data-list">
            {nodes.map((node, index) => {
              const entry = asRecord(node);
              const name = asText(entry.name) || `node-${index + 1}`;
              const type = asText(entry.type) || 'unknown';
              const server = asText(entry.server);
              const port = asText(entry.port);
              const disabled = entry.disabled === true;
              return (
                <div className="data-row" key={`${name}-${index}`}>
                  <span className="data-index">{String(index + 1).padStart(2, '0')}</span>
                  <div className="data-main">
                    <strong>{name}</strong>
                    <span>
                      {type}
                      {server ? ` · ${server}${port ? `:${port}` : ''}` : ''}
                      {disabled ? ' · 已禁用' : ''}
                    </span>
                  </div>
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
                      onClick={() => void handleToggle(name, disabled)}
                    >
                      <Power size={14} />
                      {disabled ? '启用' : '禁用'}
                    </button>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => setDeleting(name)}
                      aria-label="删除节点"
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
            <strong>还没有节点</strong>
          </div>
        )}
      </div>

      {editing ? (
        <YamlEditorDialog
          title={`编辑节点 · ${editing.name}`}
          value={editing.yaml}
          onSave={saveNode}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="删除节点"
          message={`确定删除 ${deleting}？引用它的策略组成员会被自动清理。`}
          confirmLabel="删除"
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </section>
  );
}
