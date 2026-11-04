import { useEffect, useState } from 'react';
import { LayoutTemplate, Pencil, Plus, Trash2 } from 'lucide-react';

import {
  addRuleSets,
  applyGroupTemplate,
  deleteExit,
  errorMessage,
  getExitYaml,
  saveExitYaml,
} from '../api';
import type { RuleCatalogItem } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ExitSheet } from '../components/ExitSheet';
import { buildGroupTemplate } from '../data/group-template';
import { asArray, asRecord, asText } from '../lib/workspace';
import { toast } from '../store/toast';
import { useWorkspaceData } from '../store/workspace';

interface EditingExit {
  originalName: string | null;
  yaml: string;
}

export function ExitsPage() {
  const view = useWorkspaceData((state) => state.view);
  const load = useWorkspaceData((state) => state.load);
  const [editing, setEditing] = useState<EditingExit | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const exits = view?.exits ?? [];
  const nodeNames = (view?.nodes ?? [])
    .map((node) => asText(asRecord(node).name))
    .filter((value): value is string => Boolean(value));

  const openEdit = async (name: string) => {
    try {
      const yaml = await getExitYaml(name);
      setEditing({ originalName: name, yaml });
    } catch (reason) {
      toast.error(errorMessage(reason));
    }
  };

  const saveExit = async (
    originalName: string | null,
    yaml: string,
    ruleSets?: RuleCatalogItem[],
    target?: string,
  ) => {
    await saveExitYaml(originalName, yaml);
    if (ruleSets?.length && target) {
      await addRuleSets(ruleSets, target);
    }
    await load();
    setEditing(null);
    toast.success(
      ruleSets?.length ? `已创建策略组并导入 ${ruleSets.length} 个规则集` : '出口已保存',
    );
  };

  const applyTemplate = async () => {
    if (templateBusy) return;
    if (!nodeNames.length) {
      toast.error('请先导入节点');
      setTemplateOpen(false);
      return;
    }
    setTemplateBusy(true);
    try {
      const template = buildGroupTemplate(nodeNames);
      await applyGroupTemplate(
        template.groups,
        template.providers,
        template.rules,
        template.matchTarget,
      );
      await load();
      setTemplateOpen(false);
      toast.success(`策略组模板已应用 · ${template.groups.length} 个策略组`);
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setTemplateBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteExit(deleting);
      await load();
      setDeleting(null);
      toast.success('出口已删除');
    } catch (reason) {
      toast.error(errorMessage(reason));
    }
  };

  return (
    <section className="page">
      <div className="card">
        <div className="card-head">
          <div className="card-title-row">
            <span className="chip chip-muted">{view ? `${view.exitCount} 个出口` : '—'}</span>
          </div>
          <div className="inline-actions">
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => setTemplateOpen(true)}
              disabled={!nodeNames.length || templateBusy}
            >
              <LayoutTemplate size={15} />
              应用模板
            </button>
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => setEditing({ originalName: null, yaml: '' })}
            >
              <Plus size={15} />
              新增策略组
            </button>
          </div>
        </div>

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
        <ExitSheet
          originalName={editing.originalName}
          initialYaml={editing.yaml}
          nodes={nodeNames}
          onSave={saveExit}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {templateOpen ? (
        <ConfirmDialog
          title="应用策略组模板"
          message={[
            '将按示例配置创建或覆盖 14 个策略组，并导入 22 个规则集和 MATCH 兜底规则。',
            '现有同名策略组与这些规则集的规则会被替换，其他规则保留。',
          ].join('\n\n')}
          confirmLabel={templateBusy ? '应用中…' : '应用模板'}
          onConfirm={applyTemplate}
          onClose={() => {
            if (!templateBusy) setTemplateOpen(false);
          }}
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
