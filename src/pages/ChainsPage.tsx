import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';

import {
  createChainNode,
  deleteNode,
  errorMessage,
  getNodeYaml,
  updateNodeYaml,
} from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Select } from '../components/Select';
import { YamlEditorDialog } from '../components/YamlEditorDialog';
import { asRecord, asText } from '../lib/workspace';
import { toast } from '../store/toast';
import { useWorkspaceData } from '../store/workspace';

interface EditingChain {
  name: string;
  yaml: string;
}

export function ChainsPage() {
  const view = useWorkspaceData((state) => state.view);
  const load = useWorkspaceData((state) => state.load);
  const [baseName, setBaseName] = useState('');
  const [dialer, setDialer] = useState('');
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<EditingChain | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const nodes = view?.nodes ?? [];
  const nodeNames = nodes
    .map((node) => asText(asRecord(node).name))
    .filter((value): value is string => Boolean(value));
  const exitNames = (view?.exits ?? [])
    .map((exit) => asText(asRecord(exit).name))
    .filter((value): value is string => Boolean(value));
  const chains = nodes.filter((node) => Boolean(asText(asRecord(node)['dialer-proxy'])));

  const create = async () => {
    setBusy(true);
    try {
      await createChainNode(baseName, dialer, name.trim() || null);
      await load();
      toast.success('链路节点已创建');
      setName('');
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const openEdit = async (nodeName: string) => {
    try {
      const yaml = await getNodeYaml(nodeName);
      setEditing({ name: nodeName, yaml });
    } catch (reason) {
      toast.error(errorMessage(reason));
    }
  };

  const saveChain = async (yaml: string) => {
    if (!editing) return;
    await updateNodeYaml(editing.name, yaml);
    await load();
    setEditing(null);
    toast.success('链路节点已保存');
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteNode(deleting);
      await load();
      setDeleting(null);
      toast.success('链路节点已删除');
    } catch (reason) {
      toast.error(errorMessage(reason));
    }
  };

  return (
    <section className="page">
      <div className="card">
        <div className="card-head">
          <div className="card-title-row">
            <h2 className="card-title">新增链路</h2>
            <span className="chip chip-muted">dialer-proxy</span>
          </div>
        </div>
        <div className="chain-form">
          <label className="field">
            <span>基础节点</span>
            <Select
              value={baseName}
              options={nodeNames.map((value) => ({ value, label: value }))}
              onChange={setBaseName}
              placeholder="选择节点"
              ariaLabel="基础节点"
            />
          </label>
          <label className="field">
            <span>前置节点 / 出口</span>
            <Select
              value={dialer}
              options={[...nodeNames, ...exitNames, 'DIRECT'].map((value) => ({
                value,
                label: value,
              }))}
              onChange={setDialer}
              placeholder="选择前置"
              ariaLabel="前置节点或出口"
            />
          </label>
          <label className="field">
            <span>名称（可选）</span>
            <input
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="自动生成"
            />
          </label>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => void create()}
            disabled={busy || !baseName || !dialer}
          >
            <Plus size={15} />
            创建
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title-row">
            <h2 className="card-title">现有链路</h2>
            <span className="chip chip-muted">{chains.length}</span>
          </div>
        </div>

        {chains.length ? (
          <div className="data-list">
            {chains.map((node, index) => {
              const entry = asRecord(node);
              const chainName = asText(entry.name) || `chain-${index + 1}`;
              const dialerName = asText(entry['dialer-proxy']);
              return (
                <div className="data-row" key={`${chainName}-${index}`}>
                  <span className="data-index">{String(index + 1).padStart(2, '0')}</span>
                  <div className="data-main">
                    <strong>{chainName}</strong>
                    <span>
                      {asText(entry.type) || 'unknown'} · 前置 {dialerName}
                    </span>
                  </div>
                  <div className="inline-actions row-actions">
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => void openEdit(chainName)}
                    >
                      <Pencil size={14} />
                      编辑
                    </button>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => setDeleting(chainName)}
                      aria-label="删除链路"
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
            <strong>还没有链路</strong>
          </div>
        )}
      </div>

      {editing ? (
        <YamlEditorDialog
          title={`编辑链路 · ${editing.name}`}
          value={editing.yaml}
          onSave={saveChain}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="删除链路"
          message={`确定删除链路节点 ${deleting}？`}
          confirmLabel="删除"
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </section>
  );
}
