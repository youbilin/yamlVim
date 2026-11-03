import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from 'lucide-react';

import { saveRules } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { YamlEditorDialog } from '../components/YamlEditorDialog';
import { asText } from '../lib/workspace';
import { useWorkspaceData } from '../store/workspace';

interface EditingRule {
  index: number | null;
  value: string;
}

export function RulesPage() {
  const view = useWorkspaceData((state) => state.view);
  const error = useWorkspaceData((state) => state.error);
  const load = useWorkspaceData((state) => state.load);
  const [editing, setEditing] = useState<EditingRule | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void load();
  }, [load]);

  const rules = (view?.rules ?? []).map((rule) => asText(rule) || String(rule));
  const ruleSets = Object.keys(view?.ruleProviders ?? {});

  const persist = async (next: string[]) => {
    await saveRules(next);
    await load();
    setMessage('规则已保存');
  };

  const saveRule = async (value: string) => {
    if (!editing) return;
    const next = [...rules];
    if (editing.index === null) {
      next.push(value);
    } else {
      next[editing.index] = value;
    }
    await persist(next);
    setEditing(null);
  };

  const move = async (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    [next[index], next[target]] = [next[target], next[index]];
    await persist(next);
  };

  const confirmDelete = async () => {
    if (deleting === null) return;
    await persist(rules.filter((_, index) => index !== deleting));
    setDeleting(null);
  };

  return (
    <section className="page">
      <div className="card">
        <div className="card-head">
          <div className="card-title-row">
            <h2 className="card-title">规则</h2>
            <span className="chip chip-muted">{view ? `${view.ruleCount}` : '—'}</span>
          </div>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => setEditing({ index: null, value: 'DOMAIN-SUFFIX,example.com,DIRECT' })}
          >
            <Plus size={15} />
            新增规则
          </button>
        </div>

        {error ? <p className="notice notice-info">{error}</p> : null}
        {message ? <p className="notice notice-ok">{message}</p> : null}

        {rules.length ? (
          <div className="data-list">
            {rules.map((rule, index) => (
              <div className="data-row" key={`rule-${index}`}>
                <span className="data-index">{String(index + 1).padStart(2, '0')}</span>
                <div className="data-main">
                  <code>{rule}</code>
                </div>
                <div className="inline-actions row-actions">
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => void move(index, -1)}
                    disabled={index === 0}
                    aria-label="上移"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => void move(index, 1)}
                    disabled={index === rules.length - 1}
                    aria-label="下移"
                  >
                    <ChevronDown size={14} />
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => setEditing({ index, value: rule })}
                  >
                    <Pencil size={14} />
                    编辑
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => setDeleting(index)}
                    aria-label="删除规则"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">
            <strong>还没有规则</strong>
          </div>
        )}

        {ruleSets.length ? (
          <div className="data-section">
            <span className="eyebrow">RULE PROVIDERS</span>
            <div className="tag-row">
              {ruleSets.map((name) => (
                <span className="chip chip-muted" key={name}>
                  {name}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {editing ? (
        <YamlEditorDialog
          title={editing.index === null ? '新增规则' : '编辑规则'}
          value={editing.value}
          onSave={saveRule}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {deleting !== null ? (
        <ConfirmDialog
          title="删除规则"
          message="确定删除这条规则？"
          confirmLabel="删除"
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </section>
  );
}
