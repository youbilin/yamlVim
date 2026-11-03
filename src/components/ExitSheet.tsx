import { useState } from 'react';
import { Check, Users } from 'lucide-react';

import { errorMessage } from '../api';
import type { RuleCatalogItem } from '../api';
import { CATALOG_BY_ID } from '../data/rule-catalog';
import { ALL_COMBOS } from '../data/rule-combos';
import { Select } from './Select';
import { SideSheet } from './SideSheet';
import { toast } from '../store/toast';

const GROUP_TYPES = [
  { value: 'select', label: '手动选择' },
  { value: 'url-test', label: '自动测速' },
  { value: 'fallback', label: '故障转移' },
  { value: 'load-balance', label: '负载均衡' },
];

interface ExitSheetProps {
  originalName: string | null;
  initialYaml: string;
  nodes: string[];
  onSave: (
    originalName: string | null,
    yaml: string,
    ruleSets?: RuleCatalogItem[],
    target?: string,
  ) => Promise<void>;
  onClose: () => void;
}

function template(type: string): string {
  const lines = [`name: ${type === 'select' ? 'Select' : 'Auto'}`, `type: ${type}`];
  lines.push('proxies:', '  - DIRECT');
  if (type !== 'select') {
    lines.push('url: https://www.gstatic.com/generate_204', 'interval: 300');
  }
  return lines.join(String.fromCharCode(10)) + String.fromCharCode(10);
}

export function ExitSheet({ originalName, initialYaml, nodes, onSave, onClose }: ExitSheetProps) {
  const [tab, setTab] = useState<'generate' | 'manual'>(originalName ? 'manual' : 'generate');
  const [name, setName] = useState('');
  const [type, setType] = useState('select');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedRuleSets, setSelectedRuleSets] = useState<Set<string>>(new Set());
  const [yaml, setYaml] = useState(initialYaml);
  const [busy, setBusy] = useState(false);

  const toggle = (node: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(node)) next.delete(node);
      else next.add(node);
      return next;
    });
  };

  const allSelected = nodes.length > 0 && nodes.every((node) => selected.has(node));

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(nodes));
  };

  const toggleCombo = (comboId: string) => {
    const combo = ALL_COMBOS.find((item) => item.id === comboId);
    if (!combo) return;
    setSelectedRuleSets((current) => {
      const next = new Set(current);
      const allSelected = combo.entries.every((id) => next.has(id));
      for (const id of combo.entries) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const selectedRuleSetItems: RuleCatalogItem[] = [...selectedRuleSets]
    .map((id) => CATALOG_BY_ID.get(id))
    .filter((entry) => Boolean(entry))
    .map((entry) => ({
      slug: entry!.slug,
      providerName: entry!.providerName,
      kind: entry!.kind,
      behavior: entry!.behavior,
      url: entry!.url,
      format: entry!.format,
      popular: entry!.popular,
    }));

  const generateYaml = () => {
    const lines = [`name: ${name.trim()}`, `type: ${type}`, 'proxies:'];
    for (const node of selected) lines.push(`  - ${node}`);
    if (type !== 'select') {
      lines.push('url: https://www.gstatic.com/generate_204', 'interval: 300');
    }
    return lines.join(String.fromCharCode(10)) + String.fromCharCode(10);
  };

  const saveGenerated = async () => {
    if (!name.trim()) {
      toast.error('请填写策略组名称');
      return;
    }
    if (!selected.size) {
      toast.error('请选择节点');
      return;
    }
    setBusy(true);
    try {
      await onSave(null, generateYaml(), selectedRuleSetItems, name.trim());
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const saveManual = async () => {
    if (!yaml.trim()) {
      toast.error('请填写策略组 YAML');
      return;
    }
    setBusy(true);
    try {
      await onSave(originalName, yaml);
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SideSheet title={originalName ? `编辑策略组 · ${originalName}` : '新增策略组'} onClose={onClose}>
      {!originalName ? (
        <div className="sheet-tabs">
          <button
            className={tab === 'generate' ? 'sheet-tab active' : 'sheet-tab'}
            type="button"
            onClick={() => setTab('generate')}
          >
            <Users size={14} />
            从节点生成
          </button>
          <button
            className={tab === 'manual' ? 'sheet-tab active' : 'sheet-tab'}
            type="button"
            onClick={() => setTab('manual')}
          >
            手动
          </button>
        </div>
      ) : null}

      {tab === 'generate' ? (
        <div className="sheet-section">
          <div className="form-grid two">
            <label className="field">
              <span>名称</span>
              <input
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：Auto"
              />
            </label>
            <label className="field">
              <span>类型</span>
              <Select
                value={type}
                options={GROUP_TYPES}
                onChange={setType}
                ariaLabel="策略组类型"
              />
            </label>
          </div>
          <div className="bulk-bar">
            <button className="btn btn-ghost" type="button" onClick={toggleAll}>
              {allSelected ? '取消全选' : '全选'}
            </button>
            <span className="hint">{selected.size} / {nodes.length}</span>
          </div>
          <div className="preset-list">
            {nodes.map((node) => (
              <button
                type="button"
                key={node}
                className={`preset-row ${selected.has(node) ? 'selected' : ''}`}
                onClick={() => toggle(node)}
              >
                <span className="preset-check">
                  {selected.has(node) ? <Check size={12} /> : null}
                </span>
                <span className="preset-main">
                  <strong>{node}</strong>
                </span>
              </button>
            ))}
          </div>
          <div className="sheet-subtitle">推荐规则集组合</div>
          <div className="preset-list combo-pick-list">
            {ALL_COMBOS.map((combo) => {
              const active = combo.entries.every((id) => selectedRuleSets.has(id));
              return (
                <button
                  type="button"
                  key={combo.id}
                  className={active ? 'preset-row selected' : 'preset-row'}
                  onClick={() => toggleCombo(combo.id)}
                >
                  <span className="preset-check">{active ? <Check size={12} /> : null}</span>
                  <span className="preset-main">
                    <strong>{combo.nameZh}</strong>
                    <span>{combo.description}</span>
                  </span>
                  <span className="chip chip-muted">{combo.entryCount}</span>
                </button>
              );
            })}
          </div>
          <span className="hint">已选 {selectedRuleSets.size} 个规则集</span>
          <div className="sheet-actions">
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => void saveGenerated()}
              disabled={busy}
            >
              {selectedRuleSets.size ? '创建策略组并导入规则' : '创建策略组'}
            </button>
          </div>
        </div>
      ) : null}

      {tab === 'manual' ? (
        <div className="sheet-section">
          <div className="inline-actions">
            {GROUP_TYPES.map((group) => (
              <button
                key={group.value}
                className="btn btn-ghost"
                type="button"
                onClick={() => setYaml(template(group.value))}
              >
                {group.label}
              </button>
            ))}
          </div>
          <label className="field">
            <span>策略组 YAML</span>
            <textarea
              className="textarea mono node-editor"
              value={yaml}
              onChange={(event) => setYaml(event.target.value)}
              rows={14}
              spellCheck={false}
            />
          </label>
          <div className="sheet-actions">
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => void saveManual()}
              disabled={busy}
            >
              {originalName ? '保存策略组' : '创建策略组'}
            </button>
          </div>
        </div>
      ) : null}
    </SideSheet>
  );
}
