import { useEffect, useState } from 'react';
import { Pencil, Power, Trash2 } from 'lucide-react';

import {
  deleteNode,
  deleteNodes,
  errorMessage,
  getNodeYaml,
  setNodesDisabled,
  toggleNode,
  updateNodeYaml,
} from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { YamlEditorDialog } from '../components/YamlEditorDialog';
import { asRecord, asText } from '../lib/workspace';
import { toast } from '../store/toast';
import { useWorkspaceData } from '../store/workspace';

interface EditingNode {
  name: string;
  yaml: string;
}

export function NodesPage() {
  const view = useWorkspaceData((state) => state.view);
  const load = useWorkspaceData((state) => state.load);
  const [editing, setEditing] = useState<EditingNode | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const nodes = view?.nodes ?? [];
  const names = nodes
    .map((node) => asText(asRecord(node).name))
    .filter((value): value is string => Boolean(value));
  const allSelected = names.length > 0 && names.every((name) => selected.has(name));

  const enterSelect = () => {
    setSelectMode(true);
    setSelected(new Set());
  };

  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const toggleSelect = (name: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(names));
  };

  const openEdit = async (name: string) => {
    try {
      const yaml = await getNodeYaml(name);
      setEditing({ name, yaml });
    } catch (reason) {
      toast.error(errorMessage(reason));
    }
  };

  const saveNode = async (yaml: string) => {
    if (!editing) return;
    await updateNodeYaml(editing.name, yaml);
    await load();
    setEditing(null);
    toast.success('节点已保存');
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteNode(deleting);
      await load();
      setDeleting(null);
      toast.success('节点已删除');
    } catch (reason) {
      toast.error(errorMessage(reason));
    }
  };

  const handleToggle = async (name: string, disabled: boolean) => {
    try {
      await toggleNode(name, !disabled);
      await load();
    } catch (reason) {
      toast.error(errorMessage(reason));
    }
  };

  const batchDisable = async () => {
    if (!selected.size) return;
    setBusy(true);
    try {
      await setNodesDisabled([...selected], true);
      await load();
      toast.success(`已禁用 ${selected.size} 个节点`);
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const batchDelete = async () => {
    if (!selected.size) return;
    setBusy(true);
    try {
      await deleteNodes([...selected]);
      await load();
      toast.success(`已删除 ${selected.size} 个节点`);
      setBatchDeleteOpen(false);
      exitSelect();
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page">
      <div className="card">
        <div className="card-head">
          <div className="card-title-row">
            <span className="chip chip-muted">{view ? `${view.nodeCount} 个节点` : '—'}</span>
            {selectMode ? (
              <>
                <button className="btn btn-ghost" type="button" onClick={toggleAll}>
                  {allSelected ? '取消全选' : '全选'}
                </button>
                <span className="hint">{selected.size} 项已选</span>
              </>
            ) : null}
          </div>
          <div className="inline-actions">
            <button
              className="btn btn-ghost"
              type="button"
              onClick={selectMode ? exitSelect : enterSelect}
            >
              {selectMode ? '取消' : '选择'}
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => void batchDisable()}
              disabled={!selectMode || !selected.size || busy}
            >
              <Power size={14} />
              禁用
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => setBatchDeleteOpen(true)}
              disabled={!selectMode || !selected.size || busy}
            >
              <Trash2 size={14} />
              删除
            </button>
          </div>
        </div>

        {nodes.length ? (
          <div className="data-list">
            {nodes.map((node, index) => {
              const entry = asRecord(node);
              const name = asText(entry.name) || `node-${index + 1}`;
              const type = asText(entry.type) || 'unknown';
              const server = asText(entry.server);
              const port = asText(entry.port);
              const disabled = entry.disabled === true;
              const checked = selected.has(name);
              return (
                <div
                  className={`data-row ${selectMode ? 'selectable' : ''} ${
                    checked ? 'selected' : ''
                  }`}
                  key={`${name}-${index}`}
                  onClick={selectMode ? () => toggleSelect(name) : undefined}
                >
                  {selectMode ? (
                    <input
                      className="row-check"
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelect(name)}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`选择 ${name}`}
                    />
                  ) : null}
                  <span className="data-index">{String(index + 1).padStart(2, '0')}</span>
                  <div className="data-main">
                    <strong>{name}</strong>
                    <span>
                      {type}
                      {server ? ` · ${server}${port ? `:${port}` : ''}` : ''}
                      {disabled ? ' · 已禁用' : ''}
                    </span>
                  </div>
                  {selectMode ? null : (
                    <div className="inline-actions row-actions">
                      <button
                        className="btn btn-ghost"
                        type="button"
                        onClick={() => void openEdit(name)}
                        title="编辑节点"
                        aria-label="编辑节点"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="btn btn-ghost"
                        type="button"
                        onClick={() => void handleToggle(name, disabled)}
                        title={disabled ? '启用节点' : '禁用节点'}
                        aria-label={disabled ? '启用节点' : '禁用节点'}
                      >
                        <Power size={14} />
                      </button>
                      <button
                        className="btn btn-ghost"
                        type="button"
                        onClick={() => setDeleting(name)}
                        title="删除节点"
                        aria-label="删除节点"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
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

      {batchDeleteOpen ? (
        <ConfirmDialog
          title="批量删除节点"
          message={`确定删除选中的 ${selected.size} 个节点？引用它们的策略组成员会被自动清理。`}
          confirmLabel="删除"
          onConfirm={batchDelete}
          onClose={() => setBatchDeleteOpen(false)}
        />
      ) : null}
    </section>
  );
}
